import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as dns } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import type { Sql } from "@goodfolder/serverlib";

/** The shape postgres.js accepts for a jsonb parameter, borrowed from it. */
type JsonParameter = Parameters<Sql["json"]>[0];
const asJson = (value: unknown): JsonParameter => value as JsonParameter;

/**
 * Outbound webhooks (2026-09-17).
 *
 * A signed POST to an address the person chose, retried on a schedule that
 * backs off, with every attempt kept as a delivery row so the dashboard can
 * say what happened rather than "it should have worked". Events are emitted
 * from the places that already changed state — never by polling.
 */

export const WEBHOOK_EVENTS = [
  "save.created",
  "save.requested",
  "save.flagged",
  "push.refused",
  "proposal.created",
  "proposal.reviewed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** `save.requested` is reserved: no emitter yet, documented as coming. */
export const WEBHOOK_EVENT_LABELS: ReadonlyArray<{ event: WebhookEvent; label: string }> = [
  { event: "save.created", label: "A save was recorded" },
  { event: "save.requested", label: "A save was asked for (not sent yet)" },
  { event: "save.flagged", label: "A save added files the leave-out rules would have kept out" },
  { event: "push.refused", label: "A save was refused because it added files the leave-out rules keep out" },
  { event: "proposal.created", label: "A change proposal was prepared" },
  { event: "proposal.reviewed", label: "A change proposal was accepted or turned down" },
];

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** A list from a request body; unknown names are refused whole. */
export function parseWebhookEvents(value: unknown): WebhookEvent[] | null {
  if (!Array.isArray(value)) return null;
  const picked: WebhookEvent[] = [];
  for (const item of value) {
    if (!isWebhookEvent(item)) return null;
    if (!picked.includes(item)) picked.push(item);
  }
  if (picked.length === 0) return null;
  return WEBHOOK_EVENTS.filter((event) => picked.includes(event));
}

/**
 * Where a webhook may point.
 *
 * The control plane shares a private network with the database, the folder
 * store and the object store, so an address like `http://goodfolder-postgres`
 * would turn a webhook into a probe of the deployment. Refusing loopback,
 * link-local and private ranges by name and by literal address costs nothing
 * for a real endpoint, which is always a public address.
 */
const PRIVATE_ADDRESS_MESSAGE =
  "That address points back inside the server. Use an address the public internet can reach.";

export function webhookUrlAllowed(raw: unknown): { ok: true; url: string } | { ok: false; message: string } {
  if (typeof raw !== "string") return { ok: false, message: "Give the address to send events to." };
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return { ok: false, message: "That address is missing or too long." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: "That isn't a valid address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, message: "The address must start with https:// (http:// is accepted for a self-hosted install that speaks it)." };
  }
  if (url.username || url.password) {
    return { ok: false, message: "Remove the sign-in details from the address; the signature is the proof it came from GoodFolder." };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, message: PRIVATE_ADDRESS_MESSAGE };
  }
  if (isPrivateAddress(host)) {
    return { ok: false, message: PRIVATE_ADDRESS_MESSAGE };
  }
  // A single-label name ("goodfolder-postgres", "metadata") is a name the
  // private network resolves; a public endpoint always has a dot.
  if (!host.includes(".") && !host.includes(":")) {
    return { ok: false, message: PRIVATE_ADDRESS_MESSAGE };
  }
  return { ok: true, url: url.toString() };
}

/**
 * Ranges a webhook may never point at. IPv4-mapped IPv6 literals like
 * `::ffff:127.0.0.1` are checked against the IPv4 rules by BlockList itself.
 */
const PRIVATE_NETS = new BlockList();
for (const [range, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  PRIVATE_NETS.addSubnet(range, prefix, "ipv4");
}
for (const [range, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fe80::", 10],
  ["fc00::", 7],
  ["64:ff9b::", 96], // NAT64
  ["2002::", 16], // 6to4
] as const) {
  PRIVATE_NETS.addSubnet(range, prefix, "ipv6");
}

export function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(h);
  if (family === 0) {
    // A malformed dotted quad (an octet over 255) is refused rather than let through.
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
  }
  return PRIVATE_NETS.check(h, family === 4 ? "ipv4" : "ipv6");
}

/** The resolver signature the delivery path and the route check share. */
export type WebhookLookup = (
  host: string,
  opts: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

/**
 * webhookUrlAllowed plus the one check a name needs that a literal never
 * does: what it resolves to. A name that answers with a private address is
 * refused the same way a private literal is.
 */
export async function webhookTargetAllowed(
  raw: unknown,
  lookup: WebhookLookup = dns.lookup,
): Promise<{ ok: true; url: string; addresses: string[] } | { ok: false; message: string }> {
  const checked = webhookUrlAllowed(raw);
  if (!checked.ok) return checked;
  const host = new URL(checked.url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host)) return { ok: true, url: checked.url, addresses: [host] };
  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    return { ok: false, message: "That address could not be looked up. Check it and try again." };
  }
  if (resolved.length === 0) {
    return { ok: false, message: "That address could not be looked up. Check it and try again." };
  }
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    return { ok: false, message: PRIVATE_ADDRESS_MESSAGE };
  }
  return { ok: true, url: checked.url, addresses: resolved.map((entry) => entry.address) };
}

/** Seconds since the epoch, as sent and signed. */
export type WebhookTimestamp = string;

export function signWebhook(secret: string, timestamp: WebhookTimestamp, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** The check an endpoint runs; exported so the example can show it honestly. */
export function verifyWebhookSignature(
  secret: string,
  timestamp: WebhookTimestamp,
  body: string,
  header: string | null | undefined,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** How long to wait after a failed attempt, by number of attempts made. */
export const WEBHOOK_MAX_ATTEMPTS = 5;
export function webhookRetryDelayMs(attemptsMade: number): number {
  const schedule = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
  return schedule[Math.min(Math.max(attemptsMade, 1), schedule.length) - 1]!;
}

export interface WebhookDeliveryRow {
  id: string;
  endpointId: string;
  url: string;
  secret: string;
  attempts: number;
  event: string;
  payload: unknown;
}

export function newWebhookSecret(): string {
  return `gfwh_${randomBytes(24).toString("base64url")}`;
}

export function webhookPayload(input: {
  event: string;
  accountId: string;
  projectId?: string | null;
  data: unknown;
}): Record<string, unknown> {
  return {
    event: input.event,
    sentAt: new Date().toISOString(),
    accountId: input.accountId,
    folderId: input.projectId ?? null,
    data: input.data,
  };
}

/**
 * Queue one event for every endpoint on the account that asked for it: the
 * account-wide ones and, when the event names a folder, the endpoints bound
 * to that folder.
 */
export async function emitWebhookEvent(
  sql: Sql,
  input: { accountId: string; projectId?: string | null; event: WebhookEvent; data: unknown },
): Promise<void> {
  const endpoints = await sql`
    SELECT id, events FROM webhook_endpoints
    WHERE account_id = ${input.accountId} AND active = true
      AND (project_id IS NULL OR project_id = ${input.projectId ?? null})`;
  const payload = webhookPayload(input);
  for (const endpoint of endpoints) {
    const events = Array.isArray(endpoint.events) ? (endpoint.events as string[]) : [];
    if (!events.includes(input.event)) continue;
    await sql`
      INSERT INTO webhook_deliveries (id, endpoint_id, event, project_id, payload)
      VALUES (${randomUUID()}, ${String(endpoint.id)}, ${input.event},
              ${input.projectId ?? null}, ${sql.json(asJson(payload))})`;
  }
}

/** Queue a made-up event for one endpoint, so a person can see the whole path. */
export async function queueTestDelivery(sql: Sql, endpointId: string): Promise<string | null> {
  const rows = await sql`
    SELECT id, account_id AS "accountId", project_id AS "projectId"
    FROM webhook_endpoints WHERE id = ${endpointId} LIMIT 1`;
  const endpoint = rows[0];
  if (!endpoint) return null;
  const id = randomUUID();
  const payload = webhookPayload({
    event: "test",
    accountId: String(endpoint.accountId),
    projectId: endpoint.projectId ? String(endpoint.projectId) : null,
    data: { message: "This is a test event from GoodFolder." },
  });
  await sql`
    INSERT INTO webhook_deliveries (id, endpoint_id, event, project_id, payload)
    VALUES (${id}, ${endpointId}, 'test', ${endpoint.projectId ?? null}, ${sql.json(asJson(payload))})`;
  return id;
}

/** The send half of a delivery attempt; test stubs return Response, which fits. */
export type WebhookSend = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/**
 * A send whose connect goes only to the addresses the check just approved:
 * the lookup is answered from `addresses`, never from DNS again, while the
 * URL — and so the Host header and TLS name — keeps the registered name.
 */
export function pinnedSend(addresses: string[]): WebhookSend {
  const lookup = (
    _host: string,
    opts: { all?: boolean | undefined },
    cb: (err: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void,
  ) => {
    if (opts.all) {
      cb(null, addresses.map((address) => ({ address, family: isIP(address) })));
    } else {
      cb(null, addresses[0]!, isIP(addresses[0]!));
    }
  };
  return (url, init) =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      const request = target.protocol === "https:" ? httpsRequest : httpRequest;
      const req = request(
        target,
        { method: init.method, headers: init.headers, lookup, signal: init.signal },
        (res) => {
          res.on("error", reject);
          res.resume(); // the body is not needed; drain so the socket frees
          res.on("end", () =>
            resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300, status: res.statusCode ?? 0 }));
        },
      );
      req.on("error", reject);
      req.end(init.body);
    });
}

/**
 * One attempt at one delivery. A 2xx is delivered; anything else, or a
 * network failure, leaves it pending until the schedule runs out.
 */
export async function attemptDelivery(
  sql: Sql,
  row: WebhookDeliveryRow,
  fetchImpl?: WebhookSend,
  lookup: WebhookLookup = dns.lookup,
): Promise<"delivered" | "pending" | "failed"> {
  const body = JSON.stringify(row.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "GoodFolder-Webhooks/1.0",
    "x-goodfolder-event": row.event,
    "x-goodfolder-delivery": row.id,
    "x-goodfolder-timestamp": timestamp,
    "x-goodfolder-signature": signWebhook(row.secret, timestamp, body),
  };
  // The destination is re-checked at send time: a name that resolved to a
  // public address at registration can answer with a private one later.
  const target = await webhookTargetAllowed(row.url, lookup);
  if (!target.ok && target.message === PRIVATE_ADDRESS_MESSAGE) {
    const attempts = row.attempts + 1;
    await sql`
      UPDATE webhook_deliveries
      SET status = 'failed', attempts = ${attempts}, response_status = NULL, error = ${target.message}
      WHERE id = ${row.id}`;
    await sql`
      UPDATE webhook_endpoints
      SET last_failed_at = now(), last_error = ${target.message.slice(0, 500)}
      WHERE id = ${row.endpointId}`;
    return "failed";
  }
  let status: number | null = null;
  let error: string | null = null;
  if (!target.ok) {
    error = target.message;
  } else {
    try {
      // The connect is pinned to the addresses the check just approved —
      // request() never follows a redirect, so a 3xx is simply not ok.
      const send = fetchImpl ?? pinnedSend(target.addresses);
      const res = await send(row.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (!res.ok) error = `The endpoint answered ${res.status}.`;
    } catch (e) {
      error = e instanceof Error ? (e.name === "TimeoutError" || e.name === "AbortError" ? "The endpoint did not answer in time." : e.message) : "The endpoint could not be reached.";
    }
  }
  const attempts = row.attempts + 1;
  if (status !== null && status >= 200 && status < 300) {
    await sql`
      UPDATE webhook_deliveries
      SET status = 'delivered', attempts = ${attempts}, response_status = ${status},
          error = NULL, delivered_at = now()
      WHERE id = ${row.id}`;
    await sql`UPDATE webhook_endpoints SET last_delivered_at = now(), last_error = NULL
      WHERE id = ${row.endpointId}`;
    return "delivered";
  }
  if (attempts >= WEBHOOK_MAX_ATTEMPTS) {
    await sql`
      UPDATE webhook_deliveries
      SET status = 'failed', attempts = ${attempts}, response_status = ${status}, error = ${error}
      WHERE id = ${row.id}`;
    await sql`
      UPDATE webhook_endpoints
      SET last_failed_at = now(), last_error = ${(error ?? "The endpoint could not be reached.").slice(0, 500)}
      WHERE id = ${row.endpointId}`;
    return "failed";
  }
  await sql`
    UPDATE webhook_deliveries
    SET status = 'pending', attempts = ${attempts}, response_status = ${status}, error = ${error},
        next_attempt_at = now() + interval '1 millisecond' * ${webhookRetryDelayMs(attempts)}
    WHERE id = ${row.id}`;
  return "pending";
}

/**
 * The delivery worker. Claims a small batch due now and hands each one to
 * the attempt above. Called on an interval by the server; also exported so
 * a self-hosted operator can trigger it by hand while testing.
 */
export async function deliverDueWebhooks(
  sql: Sql,
  fetchImpl?: WebhookSend,
  limit = 20,
  lookup: WebhookLookup = dns.lookup,
): Promise<number> {
  const due = await sql`
    SELECT d.id, d.endpoint_id AS "endpointId", d.attempts, d.payload, d.event,
           e.url, e.secret
    FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
    WHERE d.status = 'pending' AND d.next_attempt_at <= now() AND e.active = true
    ORDER BY d.next_attempt_at ASC
    LIMIT ${limit}`;
  let sent = 0;
  for (const row of due) {
    const outcome = await attemptDelivery(sql, {
      id: String(row.id),
      endpointId: String(row.endpointId),
      url: String(row.url),
      secret: String(row.secret),
      attempts: Number(row.attempts ?? 0),
      event: String(row.event ?? "event"),
      payload: row.payload,
    }, fetchImpl, lookup);
    if (outcome === "delivered") sent += 1;
  }
  return sent;
}
