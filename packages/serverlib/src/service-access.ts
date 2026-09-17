import { randomUUID } from "node:crypto";
import { hashToken, type TokenScope } from "./auth.ts";
import type { Sql } from "./config.ts";

/**
 * Scoped credentials for third-party services (2026-09-17).
 *
 * A service credential is not a computer and not a folder: it is a named,
 * revocable key a person approved, carrying a short list of scopes and
 * optionally bound to one folder. It can never manage the account — nothing
 * here reaches billing, invitations, folder creation or deletion.
 *
 * Git transport is the exception to the account/scope split, because a
 * hosted assistant needs an ordinary remote to work against. A credential
 * that carries `git:read`/`git:write` and passes the folder check is
 * resolved into the same TokenScope a folder's own credential produces,
 * with a device row created on first use so saves are attributed to the
 * service by name and the usage pass counts them like any other.
 */

export const SERVICE_SCOPES = [
  "read:folders",
  "read:files",
  "write:proposals",
  "git:read",
  "git:write",
] as const;

export type ServiceScope = (typeof SERVICE_SCOPES)[number];

/** What each scope lets a service do, in the words of the approval page. */
export const SERVICE_SCOPE_LABELS: ReadonlyArray<{ scope: ServiceScope; label: string }> = [
  { scope: "read:folders", label: "See folders and their history" },
  { scope: "read:files", label: "Read files" },
  { scope: "write:proposals", label: "Prepare change proposals and comments" },
  { scope: "git:read", label: "Copy a folder's contents to another computer" },
  { scope: "git:write", label: "Send changed files back to the folder" },
];

export function isServiceScope(value: unknown): value is ServiceScope {
  return typeof value === "string" && (SERVICE_SCOPES as readonly string[]).includes(value);
}

/**
 * A scope list from a request body. Unknown names are refused whole rather
 * than dropped: a client that asked for something it will not get should
 * hear so before a person approves anything.
 */
export function parseServiceScopes(value: unknown): ServiceScope[] | null {
  if (!Array.isArray(value)) return null;
  const scopes: ServiceScope[] = [];
  for (const item of value) {
    if (!isServiceScope(item)) return null;
    if (!scopes.includes(item)) scopes.push(item);
  }
  if (scopes.length === 0) return null;
  return SERVICE_SCOPES.filter((scope) => scopes.includes(scope));
}

/**
 * The whole authorization rule, in one place: does this credential carry
 * the scope the route needs, and is the route's folder inside what the
 * person bound the credential to?
 */
export function serviceAllows(
  credential: { scopes: readonly ServiceScope[]; projectId: string | null },
  scope: ServiceScope,
  projectId?: string | null,
): boolean {
  if (!credential.scopes.includes(scope)) return false;
  if (credential.projectId && projectId && credential.projectId !== projectId) return false;
  return true;
}

export interface ServiceCredential {
  credentialId: string;
  accountId: string;
  email: string;
  name: string;
  scopes: ServiceScope[];
  /** The one folder this key was bound to, or null for every folder. */
  projectId: string | null;
  createdAt?: string;
}

function credentialFromRow(row: Record<string, unknown>): ServiceCredential {
  return {
    credentialId: String(row.credentialId),
    accountId: String(row.accountId),
    email: String(row.email),
    name: String(row.name),
    scopes: parseServiceScopes(row.scopes) ?? [],
    projectId: row.projectId ? String(row.projectId) : null,
  };
}

/** Resolve any service credential by its bearer value, revoked ones aside. */
export async function resolveServiceCredential(
  sql: Sql,
  rawToken: string,
): Promise<ServiceCredential | null> {
  const rows = await sql`
    SELECT sc.id AS "credentialId", sc.account_id AS "accountId", a.email,
           sc.name, sc.scopes, sc.project_id AS "projectId"
    FROM service_credentials sc JOIN accounts a ON a.id = sc.account_id
    WHERE sc.token_hash = ${hashToken(rawToken)} AND sc.revoked_at IS NULL
    LIMIT 1`;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  void sql`UPDATE service_credentials SET last_used_at = now()
    WHERE id = ${String(row.credentialId)}`.catch(() => {});
  return credentialFromRow(row);
}

/**
 * The TokenScope shape the rest of the system already understands, for a
 * service credential acting on one folder it is allowed to reach. Creates
 * the per-(credential, folder) device row on first use so saves are
 * attributed and counted like any other device's.
 */
export async function resolveServiceScope(
  sql: Sql,
  rawToken: string,
  projectId: string,
): Promise<TokenScope | null> {
  const rows = await sql`
    SELECT sc.id AS "credentialId", sc.account_id AS "accountId", a.email,
           sc.name, sc.scopes, sc.project_id AS "boundProjectId", p.account_id AS "projectOwnerId"
    FROM service_credentials sc
    JOIN accounts a ON a.id = sc.account_id
    JOIN projects p ON p.id = ${projectId}
    WHERE sc.token_hash = ${hashToken(rawToken)} AND sc.revoked_at IS NULL
    LIMIT 1`;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  if (String(row.projectOwnerId) !== String(row.accountId)) return null;
  const bound = row.boundProjectId ? String(row.boundProjectId) : null;
  if (bound && bound !== projectId) return null;
  const credentialId = String(row.credentialId);
  const deviceId = await ensureServiceDevice(sql, {
    credentialId,
    projectId,
    name: String(row.name),
  });
  void sql`UPDATE service_credentials SET last_used_at = now() WHERE id = ${credentialId}`.catch(() => {});
  return {
    deviceId,
    projectId,
    ownerAccountId: String(row.accountId),
    deviceKind: "agent",
    service: {
      credentialId,
      name: String(row.name),
      scopes: parseServiceScopes(row.scopes) ?? [],
    },
  };
}

/** One device row per service credential per folder, created on first use. */
export async function ensureServiceDevice(
  sql: Sql,
  input: { credentialId: string; projectId: string; name: string },
): Promise<string> {
  const existing = await sql`
    SELECT device_id AS "deviceId" FROM service_credential_devices
    WHERE credential_id = ${input.credentialId} AND project_id = ${input.projectId}
    LIMIT 1`;
  if (existing[0]?.deviceId) return String(existing[0].deviceId);
  const deviceId = randomUUID();
  await sql`
    INSERT INTO devices (id, project_id, name, kind)
    VALUES (${deviceId}, ${input.projectId}, ${input.name.slice(0, 60)}, 'agent')`;
  const mapped = await sql`
    INSERT INTO service_credential_devices (credential_id, project_id, device_id)
    VALUES (${input.credentialId}, ${input.projectId}, ${deviceId})
    ON CONFLICT (credential_id, project_id) DO NOTHING
    RETURNING device_id AS "deviceId"`;
  if (mapped.length) return deviceId;
  // A concurrent first use won the race; its device is the one on record.
  await sql`DELETE FROM devices WHERE id = ${deviceId}`;
  const raced = await sql`
    SELECT device_id AS "deviceId" FROM service_credential_devices
    WHERE credential_id = ${input.credentialId} AND project_id = ${input.projectId}
    LIMIT 1`;
  if (raced[0]?.deviceId) return String(raced[0].deviceId);
  throw new Error("could not anchor the service credential to a device");
}
