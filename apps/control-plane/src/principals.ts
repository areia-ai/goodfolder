import { createHash } from "node:crypto";
import type { Context } from "hono";
import {
  resolveAuthContext,
  serviceAllows,
  tokenFromAuthHeader,
  type ServiceScope,
  type Sql,
} from "@goodfolder/serverlib";

/**
 * Who is making a request, and what a scoped service credential may reach.
 *
 * Everything that manages an account — billing, invitations, creating and
 * deleting folders, minting folder credentials, issuing or revoking other
 * credentials — goes through `accountFrom`, which refuses service
 * credentials outright. A route a service may reach names the scope it
 * needs and the folder it is about; `externalCaller` is the only place
 * that decision is made.
 */

export const SESSION_COOKIE = "gf_session";

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export interface AccountCaller {
  kind: "account";
  accountId: string;
  email: string;
  accountDeviceId: string;
}

export interface ServiceCaller {
  kind: "service";
  accountId: string;
  email: string;
  credentialId: string;
  serviceName: string;
  scopes: ServiceScope[];
  /** The folder this key is bound to, or null for every folder. */
  boundProjectId: string | null;
}

export type Caller = AccountCaller | ServiceCaller;

export function makePrincipals(sql: Sql) {
  function sha256(v: string): string {
    return createHash("sha256").update(v).digest("hex");
  }

  async function sessionAccount(
    c: { req: { header: (n: string) => string | undefined } },
  ): Promise<{ accountId: string; email: string } | null> {
    const v = parseCookies(c.req.header("cookie"))[SESSION_COOKIE];
    if (!v || v.length < 20 || !/^[A-Za-z0-9_-]+$/.test(v)) return null;
    const rows = await sql`
      SELECT s.account_id AS "accountId", a.email
      FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ${sha256(v)} AND s.expires_at > now()
      LIMIT 1`;
    const r = rows[0];
    return r ? { accountId: String(r.accountId), email: String(r.email) } : null;
  }

  /**
   * The account behind a browser session or an approved device token.
   * A scoped service credential is deliberately not an account here —
   * returning null keeps every management route out of its reach.
   */
  async function accountFrom(
    c: Context,
  ): Promise<
    | { kind: "account"; accountId: string; email: string; accountDeviceId: string }
    | null
  > {
    const raw = tokenFromAuthHeader(c.req.header("Authorization"));
    if (raw) {
      const ctx = await resolveAuthContext(sql, raw);
      if (ctx && ctx.kind === "account") return ctx;
      return null;
    }
    const session = await sessionAccount(c);
    if (!session) return null;
    return {
      kind: "account",
      accountId: session.accountId,
      email: session.email,
      accountDeviceId: "session",
    };
  }

  /**
   * Who may reach a route that external services are allowed to use. An
   * account (bearer or browser session) passes as before. A service
   * credential passes only when it carries `required` and, when the route
   * names a folder, when that folder is inside its binding.
   */
  async function externalCaller(
    c: Context,
    required: ServiceScope,
    projectId?: string | null,
  ): Promise<Caller | null> {
    const raw = tokenFromAuthHeader(c.req.header("Authorization"));
    if (raw) {
      const ctx = await resolveAuthContext(sql, raw);
      if (!ctx) return null;
      if (ctx.kind === "account") return ctx;
      if (ctx.kind !== "service") return null;
      if (projectId && ctx.projectId && ctx.projectId !== projectId) return null;
      if (!serviceAllows(ctx, required, projectId)) return null;
      void auditServiceUse(sql, ctx, {
        scope: required,
        projectId: projectId ?? null,
        method: c.req.method,
        path: c.req.path,
      });
      return {
        kind: "service",
        accountId: ctx.accountId,
        email: ctx.email,
        credentialId: ctx.credentialId,
        serviceName: ctx.name,
        scopes: ctx.scopes,
        boundProjectId: ctx.projectId,
      };
    }
    const session = await sessionAccount(c);
    if (!session) return null;
    return {
      kind: "account",
      accountId: session.accountId,
      email: session.email,
      accountDeviceId: "session",
    };
  }

  return { sha256, sessionAccount, accountFrom, externalCaller };
}

/**
 * One line per request a service credential made, so the person who
 * approved it can see which key did what. Fire-and-forget: an audit row is
 * never worth failing a request over.
 */
export function auditServiceUse(
  sql: Sql,
  credential: { credentialId: string; name: string; accountId: string },
  detail: { scope: ServiceScope; projectId: string | null; method: string; path: string },
): void {
  void sql`
    INSERT INTO audit_log (actor, action, detail)
    VALUES (${credential.name}, 'service.request', ${sql.json({
      credentialId: credential.credentialId,
      accountId: credential.accountId,
      scope: detail.scope,
      projectId: detail.projectId,
      method: detail.method,
      path: detail.path,
    })})`.catch(() => {});
}
