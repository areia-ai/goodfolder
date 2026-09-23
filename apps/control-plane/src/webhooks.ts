import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
    return { ok: false, message: "That address points back inside the server. Use an address the public internet can reach." };
  }
  if (isPrivateAddress(host)) {
    return { ok: false, message: "That address points back inside the server. Use an address the public internet can reach." };
  }
  // A single-label name ("goodfolder-postgres", "metadata") is a name the
  // private network resolves; a public endpoint always has a dot.
  if (!host.includes(".") && !host.includes(":")) {
    return { ok: false, message: "That address points back inside the server. Use an address the public internet can reach." };
  }
  return { ok: true, url: url.toString() };
}

export function isPrivateAddress(host: string): boolean {
  if (host.includes(":")) {
    // IPv6: loopback, link-local, unique-local, unspecified.
    const h = host.toLowerCase();
    return h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd");
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
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

/**
 * One attempt at one delivery. A 2xx is delivered; anything else, or a
 * network failure, leaves it pending until the schedule runs out.
 */
export async function attemptDelivery(
  sql: Sql,
  row: WebhookDeliveryRow,
  fetchImpl: typeof fetch = fetch,
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
  let status: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetchImpl(row.url, {
      method: "POST",
      headers,
      body,
      // A redirect could send the signed body somewhere else entirely.
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    if (!res.ok) error = `The endpoint answered ${res.status}.`;
  } catch (e) {
    error = e instanceof Error ? (e.name === "TimeoutError" ? "The endpoint did not answer in time." : e.message) : "The endpoint could not be reached.";
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
  fetchImpl: typeof fetch = fetch,
  limit = 20,
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
    }, fetchImpl);
    if (outcome === "delivered") sent += 1;
  }
  return sent;
}
