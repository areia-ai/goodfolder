import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sql } from "@goodfolder/serverlib";
import {
  WEBHOOK_EVENTS,
  WEBHOOK_MAX_ATTEMPTS,
  attemptDelivery,
  emitWebhookEvent,
  parseWebhookEvents,
  signWebhook,
  verifyWebhookSignature,
  webhookRetryDelayMs,
  webhookTargetAllowed,
  webhookUrlAllowed,
} from "./webhooks.ts";
import type { WebhookLookup } from "./webhooks.ts";

/** A resolver that always answers with one public address. */
const publicLookup: WebhookLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function fakeSql(rows: { endpoints?: Array<Record<string, unknown>> } = {}) {
  const queries: { text: string; values: unknown[] }[] = [];
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    if (text.startsWith("SELECT id, events FROM webhook_endpoints")) return rows.endpoints ?? [];
    return [];
  };
  const tagged = query as unknown as Sql;
  tagged.json = ((value: unknown) => value) as Sql["json"];
  return { sql: tagged, queries };
}

test("a webhook address must be a public http or https address", () => {
  assert.equal(webhookUrlAllowed("https://hooks.example.com/goodfolder").ok, true);
  assert.equal(webhookUrlAllowed("http://127.0.0.1:9999/hook").ok, false);
  assert.equal(webhookUrlAllowed("http://localhost/hook").ok, false);
  assert.equal(webhookUrlAllowed("https://goodfolder-postgres/hook").ok, false);
  assert.equal(webhookUrlAllowed("https://service.internal/hook").ok, false);
  assert.equal(webhookUrlAllowed("https://10.0.0.5/hook").ok, false);
  assert.equal(webhookUrlAllowed("https://172.20.1.1/hook").ok, false);
  assert.equal(webhookUrlAllowed("https://192.168.1.10/hook").ok, false);
  assert.equal(webhookUrlAllowed("https://169.254.169.254/latest/meta-data").ok, false);
  assert.equal(webhookUrlAllowed("https://[::1]/hook").ok, false);
  assert.equal(webhookUrlAllowed("https://user:pass@example.com/hook").ok, false);
  assert.equal(webhookUrlAllowed("ftp://example.com/hook").ok, false);
  assert.equal(webhookUrlAllowed("not a url").ok, false);
  assert.equal(webhookUrlAllowed("").ok, false);
  // An inside address smuggled through IPv6 notation is refused too.
  assert.equal(webhookUrlAllowed("http://[::ffff:127.0.0.1]/x").ok, false);
  assert.equal(webhookUrlAllowed("http://[::ffff:10.0.0.1]/x").ok, false);
  assert.equal(webhookUrlAllowed("http://[64:ff9b::7f00:1]/x").ok, false);
  assert.equal(webhookUrlAllowed("http://[2002:7f00:1::]/x").ok, false);
  assert.equal(webhookUrlAllowed("http://0.0.0.0/x").ok, false);
  assert.equal(webhookUrlAllowed("http://100.64.0.1/x").ok, false);
  // A public address that merely starts like a private one still passes.
  assert.equal(webhookUrlAllowed("https://172.32.0.1/hook").ok, true);
});

test("a webhook target is refused when the name resolves inside", async () => {
  assert.equal((await webhookTargetAllowed("https://hooks.example.com/x", publicLookup)).ok, true);
  const privateLookup: WebhookLookup = async () => [{ address: "10.1.2.3", family: 4 }];
  const refused = await webhookTargetAllowed("https://hooks.example.com/x", privateLookup);
  assert.equal(refused.ok, false);
  // One private answer among public ones refuses the whole name.
  const mixedLookup: WebhookLookup = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.1.2.3", family: 4 },
  ];
  assert.equal((await webhookTargetAllowed("https://hooks.example.com/x", mixedLookup)).ok, false);
  const v6Lookup: WebhookLookup = async () => [{ address: "fd12::1", family: 6 }];
  assert.equal((await webhookTargetAllowed("https://hooks.example.com/x", v6Lookup)).ok, false);
  const deadLookup: WebhookLookup = async () => {
    throw new Error("ENOTFOUND");
  };
  const dead = await webhookTargetAllowed("https://hooks.example.com/x", deadLookup);
  assert.equal(dead.ok, false);
  assert.equal(dead.ok ? "" : dead.message, "That address could not be looked up. Check it and try again.");
  // A public literal never needs the resolver.
  assert.equal((await webhookTargetAllowed("https://93.184.216.34/x", deadLookup)).ok, true);
});

test("event lists refuse unknown names instead of dropping them", () => {
  assert.deepEqual(parseWebhookEvents(["save.created", "proposal.reviewed"]), ["save.created", "proposal.reviewed"]);
  assert.deepEqual(parseWebhookEvents(["proposal.created", "save.created", "proposal.created"]), ["save.created", "proposal.created"]);
  assert.equal(parseWebhookEvents(["save.created", "folder.deleted"]), null);
  assert.equal(parseWebhookEvents([]), null);
  assert.equal(parseWebhookEvents("save.created"), null);
  assert.deepEqual([...WEBHOOK_EVENTS], ["save.created", "save.requested", "save.flagged", "push.refused", "proposal.created", "proposal.reviewed"]);
});

test("the signature covers the timestamp and the body", () => {
  const secret = "gfwh_test";
  const body = JSON.stringify({ event: "save.created", seq: 3 });
  const timestamp = "1758000000";
  const signature = signWebhook(secret, timestamp, body);
  assert.match(signature, /^sha256=[0-9a-f]{64}$/);
  assert.equal(verifyWebhookSignature(secret, timestamp, body, signature), true);
  assert.equal(verifyWebhookSignature(secret, timestamp, body, null), false);
  assert.equal(verifyWebhookSignature(secret, "1758000001", body, signature), false);
  assert.equal(verifyWebhookSignature(secret, timestamp, `${body} `, signature), false);
  assert.equal(verifyWebhookSignature("other", timestamp, body, signature), false);
});

test("retries back off and then stop", () => {
  assert.equal(webhookRetryDelayMs(1), 30_000);
  assert.equal(webhookRetryDelayMs(2), 120_000);
  assert.equal(webhookRetryDelayMs(3), 600_000);
  assert.equal(webhookRetryDelayMs(4), 3_600_000);
  assert.equal(webhookRetryDelayMs(5), 21_600_000);
  assert.equal(WEBHOOK_MAX_ATTEMPTS, 5);
});

test("an event is queued only for endpoints that asked for it", async () => {
  const { sql, queries } = fakeSql({
    endpoints: [
      { id: "endpoint-a", events: ["save.created", "proposal.created"] },
      { id: "endpoint-b", events: ["proposal.reviewed"] },
    ],
  });
  await emitWebhookEvent(sql, {
    accountId: "account-1",
    projectId: "folder-1",
    event: "save.created",
    data: { seq: 4 },
  });
  const inserts = queries.filter((query) => query.text.startsWith("INSERT INTO webhook_deliveries"));
  assert.equal(inserts.length, 1);
  const payload = inserts[0]!.values.find((value) => typeof value === "object" && value !== null && "event" in (value as object)) as Record<string, unknown>;
  assert.equal(payload.event, "save.created");
  assert.equal(payload.folderId, "folder-1");
  assert.equal(payload.accountId, "account-1");
});

test("a delivery reports success once and failure with backoff", async () => {
  const { sql, queries } = fakeSql();
  const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  const first = await attemptDelivery(sql, {
    id: "delivery-1",
    endpointId: "endpoint-a",
    url: "https://hooks.example.com/x",
    secret: "gfwh_test",
    attempts: 0,
    event: "save.created",
    payload: { event: "save.created" },
  }, okFetch, publicLookup);
  assert.equal(first, "delivered");
  assert.equal(queries.some((query) => query.text.startsWith("UPDATE webhook_deliveries SET status = 'delivered'")), true);

  const failing = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const second = await attemptDelivery(sql, {
    id: "delivery-2",
    endpointId: "endpoint-a",
    url: "https://hooks.example.com/x",
    secret: "gfwh_test",
    attempts: 0,
    event: "save.created",
    payload: { event: "save.created" },
  }, failing, publicLookup);
  assert.equal(second, "pending");
  assert.equal(queries.some((query) => query.text.includes("next_attempt_at")), true);

  const last = await attemptDelivery(sql, {
    id: "delivery-3",
    endpointId: "endpoint-a",
    url: "https://hooks.example.com/x",
    secret: "gfwh_test",
    attempts: WEBHOOK_MAX_ATTEMPTS - 1,
    event: "save.created",
    payload: { event: "save.created" },
  }, failing, publicLookup);
  assert.equal(last, "failed");
  assert.equal(queries.some((query) => query.text.startsWith("UPDATE webhook_deliveries SET status = 'failed'")), true);
});

test("a delivery to a name that resolves inside fails without ever calling out", async () => {
  const { sql, queries } = fakeSql();
  let fetchCalls = 0;
  const spyFetch = (async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const insideLookup: WebhookLookup = async () => [{ address: "10.0.0.1", family: 4 }];
  const outcome = await attemptDelivery(sql, {
    id: "delivery-5",
    endpointId: "endpoint-a",
    url: "https://hooks.example.com/x",
    secret: "gfwh_test",
    attempts: 0,
    event: "save.created",
    payload: { event: "save.created" },
  }, spyFetch, insideLookup);
  assert.equal(outcome, "failed");
  assert.equal(fetchCalls, 0);
  assert.equal(queries.some((query) => query.text.startsWith("UPDATE webhook_deliveries SET status = 'failed'")), true);
  assert.equal(queries.some((query) => query.text.startsWith("UPDATE webhook_endpoints SET last_failed_at")), true);
});

test("a network failure is retried, never swallowed", async () => {
  const { sql, queries } = fakeSql();
  const deadFetch = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
  const outcome = await attemptDelivery(sql, {
    id: "delivery-4",
    endpointId: "endpoint-a",
    url: "https://hooks.example.com/x",
    secret: "gfwh_test",
    attempts: 1,
    event: "proposal.created",
    payload: { event: "proposal.created" },
  }, deadFetch, publicLookup);
  assert.equal(outcome, "pending");
  const update = queries.find((query) => query.text.includes("next_attempt_at"));
  assert.equal(update?.values.includes("connection refused"), true);
});
