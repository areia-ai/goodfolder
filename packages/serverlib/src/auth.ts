import { createHash, randomBytes } from "node:crypto";
import type { Sql } from "./config.ts";

/**
 * v0 auth — bearer tokens bound to exactly one device + one project.
 * The token scope IS the authorization boundary; nothing downstream trusts
 * anything else. Replaces Gitea's (absent) per-project transport auth.
 */

export interface TokenScope {
  deviceId: string;
  projectId: string;
  deviceKind: "user" | "agent";
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

export function bearerFrom(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}

/**
 * Extract a GoodFolder token from an Authorization header of either scheme:
 * `Bearer <token>` (our CLI/API) or `Basic base64(<user>:<token>)` (what
 * stock git clients send when credentials appear in the remote URL).
 */
export function tokenFromAuthHeader(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (bearer) return bearer[1]!;
  const basic = /^Basic\s+(.+)$/i.exec(trimmed);
  if (basic) {
    try {
      const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      return idx >= 0 ? decoded.slice(idx + 1) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Resolve a bearer token to its scope. Null means unauthorized. */
export async function resolveScope(
  sql: Sql,
  rawToken: string,
): Promise<TokenScope | null> {
  const rows = await sql`
    SELECT d.id AS device_id, d.project_id, d.kind AS device_kind
    FROM transfer_tokens t
    JOIN devices d ON d.id = t.device_id
    WHERE t.token_hash = ${hashToken(rawToken)}
      AND t.expires_at > now()
    LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  return {
    deviceId: String(r.device_id),
    projectId: String(r.project_id),
    deviceKind: r.device_kind === "agent" ? "agent" : "user",
  };
}

// ---------------------------------------------------------------------------
// Two-layer credentials (2026-08-25): project transport tokens (above) and
// account device tokens minted by browser pairing (below). Account tokens
// authorize management actions — creating folders, listing them, minting new
// folder tokens — never direct git transport.
// ---------------------------------------------------------------------------

export interface AccountContext {
  kind: "account";
  accountId: string;
  email: string;
  accountDeviceId: string;
}

export type AuthContext = TokenScope & { kind: "project" } | AccountContext;

/**
 * Resolve any GoodFolder bearer token to its authorization context.
 * Project tokens win first so existing folders keep working unchanged;
 * account device tokens are the fallback.
 */
export async function resolveAuthContext(
  sql: Sql,
  rawToken: string,
): Promise<AuthContext | null> {
  const project = await resolveScope(sql, rawToken);
  if (project) return { ...project, kind: "project" };
  const rows = await sql`
    SELECT d.id AS account_device_id, d.account_id, a.email
    FROM account_devices d
    JOIN accounts a ON a.id = d.account_id
    WHERE d.token_hash = ${hashToken(rawToken)}
      AND d.revoked_at IS NULL
    LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  void sql`UPDATE account_devices SET last_used_at = now()
    WHERE id = ${String(r.account_device_id)}`.catch(() => {});
  return {
    kind: "account",
    accountId: String(r.account_id),
    email: String(r.email),
    accountDeviceId: String(r.account_device_id),
  };
}

/** Random URL-safe secret with a readable prefix, e.g. gfa_, gfs_. */
export function newUrlToken(prefix: string): { raw: string; hash: string } {
  const raw = `${prefix}${randomBytes(24).toString("base64url")}`;
  return { raw, hash: hashToken(raw) };
}
