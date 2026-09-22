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
  webhookUrlAllowed,
} from "./webhooks.ts";

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
  // A public address that merely starts like a private one still passes.
  assert.equal(webhookUrlAllowed("https://172.32.0.1/hook").ok, true);
});

test("event lists refuse unknown names instead of dropping them", () => {
  assert.deepEqual(parseWebhookEvents(["save.created", "proposal.reviewed"]), ["save.created", "proposal.reviewed"]);
  assert.deepEqual(parseWebhookEvents(["proposal.created", "save.created", "proposal.created"]), ["save.created", "proposal.created"]);
  assert.equal(parseWebhookEvents(["save.created", "folder.deleted"]), null);
  assert.equal(parseWebhookEvents([]), null);
  assert.equal(parseWebhookEvents("save.created"), null);
  assert.deepEqual([...WEBHOOK_EVENTS], ["save.created", "save.requested", "save.flagged", "proposal.created", "proposal.reviewed"]);
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
  }, okFetch);
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
  }, failing);
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
  }, failing);
  assert.equal(last, "failed");
  assert.equal(queries.some((query) => query.text.startsWith("UPDATE webhook_deliveries SET status = 'failed'")), true);
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
  }, deadFetch);
  assert.equal(outcome, "pending");
  const update = queries.find((query) => query.text.includes("next_attempt_at"));
  assert.equal(update?.values.includes("connection refused"), true);
});
