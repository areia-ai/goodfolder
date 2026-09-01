import { serve } from "@hono/node-server";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import {
  tokenFromAuthHeader,
  GetObjectCommand,
  getSignedUrl,
  HeadObjectCommand,
  accountEntitlement,
  loadBillingConfig,
  loadConfig,
  makeS3,
  openDb,
  PutObjectCommand,
  resolveScope,
  type ServerConfig,
  type TokenScope,
} from "@goodfolder/serverlib";

/**
 * GoodFolder LFS endpoint — GoodFolder-owned from day one (the proposal's
 * margin/quota/abuse-control path).
 *
 * Two transfer modes:
 * - PRESIGN=1: batch returns presigned URLs; client bytes go DIRECTLY to
 *   object storage (R2 in prod). Auth travels inside the URL signature.
 * - default: stream-through via /lfs/storage/* (dev MinIO behind tunnels).
 */

const cfg = loadConfig();
const sql = openDb(cfg.databaseUrl);
const s3 = makeS3(cfg);
const billingConfig = loadBillingConfig(process.env, false);
const CHALLENGE_CAMPAIGN = "webmcp-2026";
const challengeCode = process.env.CHALLENGE_ACCESS_CODE?.trim() ?? "";
const challengeExpiresAt = process.env.CHALLENGE_ACCESS_EXPIRES_AT?.trim() ?? "";
const challengeStaffEmails = new Set(
  (process.env.CHALLENGE_ACCESS_STAFF_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean),
);
const challengeEnabled = Boolean(challengeCode || challengeExpiresAt || challengeStaffEmails.size);
if (challengeEnabled && (!challengeCode || !challengeExpiresAt || Number.isNaN(Date.parse(challengeExpiresAt)))) {
  throw new Error("CHALLENGE_ACCESS_CODE and CHALLENGE_ACCESS_EXPIRES_AT are both required when challenge access is enabled");
}

const presignOn = process.env.PRESIGN === "1";
const presignS3: ReturnType<typeof makeS3> | null = presignOn
  ? makeS3({
      ...cfg,
      s3Endpoint: process.env.PRESIGN_PUBLIC_ENDPOINT ?? cfg.s3Endpoint,
    } as ServerConfig)
  : null;

async function presign(
  op: "upload" | "download",
  key: string,
): Promise<string> {
  const cmd =
    op === "upload"
      ? new PutObjectCommand({ Bucket: cfg.s3Bucket, Key: key })
      : new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: key });
  return getSignedUrl(presignS3!, cmd, { expiresIn: 3600 });
}

const OID_RE = /^[a-f0-9]{64}$/;
const keyFor = (projectId: string, oid: string) => `${projectId}/${oid}`;
const publicOrigin = () =>
  process.env.PUBLIC_LFS_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 4101}`;

async function challengeAccessDenied(scope: TokenScope, db = sql): Promise<{ code: number; message: string } | null> {
  if (!challengeEnabled) return null;
  const account = await db`SELECT email FROM accounts WHERE id = ${scope.ownerAccountId} LIMIT 1`;
  if (challengeStaffEmails.has(String(account[0]?.email ?? "").toLowerCase())) return null;
  const grant = await db`SELECT expires_at AS "expiresAt" FROM campaign_access_redemptions WHERE account_id = ${scope.ownerAccountId} AND campaign = ${CHALLENGE_CAMPAIGN} LIMIT 1`;
  if (grant[0] && new Date(String(grant[0].expiresAt)).getTime() > Date.now()) return null;
  if (grant[0] && billingConfig.mode === "stripe" && (await accountEntitlement(db, billingConfig, scope.ownerAccountId)).canWrite) return null;
  return { code: grant[0] ? 403 : 402, message: grant[0] ? "WebMCP Challenge access ended; this account is read-only." : "Redeem the WebMCP Challenge code before uploading." };
}

async function reserveUpload(scope: TokenScope, oid: string, declaredBytes: number): Promise<"reserved" | "confirmed" | { code: number; message: string }> {
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) return { code: 400, message: "invalid object size" };
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${scope.ownerAccountId}))`;
    const challengeDenied = await challengeAccessDenied(scope, tx as unknown as typeof sql);
    if (challengeDenied) return challengeDenied;
    const existing = await tx`
      SELECT state, confirmed_bytes AS "confirmedBytes" FROM stored_objects
      WHERE project_id = ${scope.projectId} AND oid = ${oid} LIMIT 1`;
    if (existing[0]?.state === "confirmed" && Number(existing[0].confirmedBytes) === declaredBytes) return "confirmed" as const;
    const entitlement = await accountEntitlement(tx as unknown as typeof sql, billingConfig, scope.ownerAccountId);
    if (!entitlement.canWrite) {
      return {
        code: entitlement.reason === "quota-exceeded" ? 409 : entitlement.reason === "subscription-required" ? 402 : 403,
        message: entitlement.reason === "quota-exceeded" ? "protected-data limit reached" : entitlement.reason === "read-only" ? "account is read-only" : "hosted access required",
      };
    }
    const remaining = entitlement.authorizedBytes === null
      ? Number.POSITIVE_INFINITY
      : entitlement.authorizedBytes - entitlement.usageBytes - entitlement.reservedBytes;
    if (declaredBytes > remaining) return { code: 409, message: "object exceeds remaining protected-data allowance" };
    await tx`
      INSERT INTO stored_objects (project_id, oid, declared_bytes, state, reservation_expires_at)
      VALUES (${scope.projectId}, ${oid}, ${declaredBytes}, 'reserved', now() + interval '1 hour')
      ON CONFLICT (project_id, oid) DO UPDATE SET declared_bytes = EXCLUDED.declared_bytes,
        state = 'reserved', confirmed_bytes = NULL, reservation_expires_at = EXCLUDED.reservation_expires_at,
        verified_at = NULL, updated_at = now()`;
    return "reserved" as const;
  });
}

async function confirmObject(scope: TokenScope, oid: string, actualBytes: number): Promise<void> {
  await sql`
    INSERT INTO stored_objects (project_id, oid, declared_bytes, confirmed_bytes, state, verified_at)
    VALUES (${scope.projectId}, ${oid}, ${actualBytes}, ${actualBytes}, 'confirmed', now())
    ON CONFLICT (project_id, oid) DO UPDATE SET confirmed_bytes = EXCLUDED.confirmed_bytes,
      declared_bytes = EXCLUDED.declared_bytes, state = 'confirmed', verified_at = now(),
      reservation_expires_at = NULL, updated_at = now()`;
  const totals = await sql`
    SELECT COALESCE((SELECT SUM(repository_bytes) FROM projects WHERE account_id = ${scope.ownerAccountId}), 0)::bigint AS "repositoryBytes",
           COALESCE((SELECT SUM(o.confirmed_bytes) FROM stored_objects o JOIN projects p ON p.id = o.project_id WHERE p.account_id = ${scope.ownerAccountId} AND o.state = 'confirmed'), 0)::bigint AS "objectBytes"`;
  const repositoryBytes = Number(totals[0]?.repositoryBytes ?? 0);
  const objectBytes = Number(totals[0]?.objectBytes ?? 0);
  const last = await sql`SELECT total_bytes AS "totalBytes" FROM usage_samples WHERE account_id = ${scope.ownerAccountId} ORDER BY recorded_at DESC LIMIT 1`;
  if (Number(last[0]?.totalBytes ?? -1) !== repositoryBytes + objectBytes) {
    await sql`
      INSERT INTO usage_samples (account_id, repository_bytes, object_bytes, total_bytes, source)
      VALUES (${scope.ownerAccountId}, ${repositoryBytes}, ${objectBytes}, ${repositoryBytes + objectBytes}, 'object-verified')`;
  }
}

const app = new Hono<{ Variables: { scope: TokenScope } }>();

app.get("/healthz", (c) => c.json({ ok: true }));

app.use("*", async (c, next) => {
  if (c.req.path === "/healthz") return next();
  const raw = tokenFromAuthHeader(c.req.header("Authorization"));
  const scope = raw ? await resolveScope(sql, raw) : null;
  if (!scope) {
    // RFC-required challenge so stock git-lfs clients offer credentials.
    c.header("WWW-Authenticate", 'Basic realm="GoodFolder"');
    return c.json(
      { error: { code: "unauthorized", message: "bad token" } },
      401,
    );
  }
  c.set("scope", scope);
  await next();
});

// LFS Batch API (https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md)
app.post("/lfs/:projectId/objects/batch", async (c) => {
  const scope = c.get("scope") as TokenScope;
  if (c.req.param("projectId") !== scope.projectId) {
    return c.json(
      { error: { code: "project-scope", message: "token not valid for this project" } },
      403,
    );
  }
  const body = await c.req.json<{
    operation?: "upload" | "download";
    objects?: { oid?: string; size?: number }[];
  }>();
  const op = body.operation === "download" ? "download" : "upload";
  const objects = [];
  for (const o of body.objects ?? []) {
    if (!o.oid || !OID_RE.test(o.oid)) continue;
    const base = {
      oid: o.oid,
      size: o.size ?? 0,
      authenticated: true,
    };
    const key = keyFor(scope.projectId, o.oid);
    if (op === "upload") {
      const reservation = await reserveUpload(scope, o.oid, Number(o.size ?? 0));
      if (reservation === "confirmed") {
        objects.push({ ...base, actions: {} });
        continue;
      }
      if (typeof reservation === "object") {
        objects.push({ ...base, error: reservation });
        continue;
      }
    }
    if (presignOn && presignS3) {
      // Direct-to-storage: auth lives in the URL signature.
      const href = await presign(op, key);
      const actions = op === "upload"
        ? {
            upload: { href },
            verify: {
              href: `${publicOrigin()}/lfs/verify`,
              header: { Authorization: c.req.header("Authorization") ?? "" },
            },
          }
        : { download: { href } };
      objects.push({ ...base, actions });
      continue;
    }
    // Stream-through fallback (dev MinIO behind tunnels)
    const tok = c.req.header("x-gf-token") ?? "";
    const host =
      c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "127.0.0.1:4100";
    const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
    const origin = `${proto}://x:${tok}@${host}`;
    const href = `${origin}/lfs/storage/${o.oid}`;
    objects.push({
      ...base,
      actions:
        op === "upload"
          ? { upload: { href }, verify: { href: `${origin}/lfs/verify` } }
          : { download: { href } },
    });
  }
  return c.json({ transfer: "basic", objects });
});

// LFS verify: confirm the uploaded object really landed.
app.post("/lfs/verify", async (c) => {
  const scope = c.get("scope") as TokenScope;
  const b = await c.req.json<{ oid?: string; size?: number }>();
  if (!b.oid || !OID_RE.test(b.oid)) return c.text("bad oid", 400);
  try {
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: keyFor(scope.projectId, b.oid),
      }),
    );
    if (b.size !== undefined && head.ContentLength !== undefined && head.ContentLength !== b.size) {
      return c.text("size mismatch", 400);
    }
    await confirmObject(scope, b.oid, Number(head.ContentLength ?? b.size ?? 0));
    return new Response(null, { status: 200 });
  } catch {
    return c.text("object not found", 404);
  }
});

// Stream-through storage — authorized, then proxied to S3.
app.put("/lfs/storage/:oid", async (c) => {
  const scope = c.get("scope") as TokenScope;
  const oid = c.req.param("oid");
  if (!OID_RE.test(oid)) return c.text("bad oid", 400);
  const stream = c.req.raw.body;
  if (!stream) return c.text("body required", 400);
  // Spool to disk: chunked uploads have no length up front, and the S3 SDK
  // needs a known-length body. Temp file keeps size unbounded by memory.
  const dir = await mkdtemp(join(tmpdir(), "gf-lfs-"));
  const tmpPath = join(dir, "object");
  try {
    const handle = await open(tmpPath, "w");
    await pipeline(
      Readable.fromWeb(stream as import("node:stream/web").ReadableStream),
      handle.createWriteStream(),
    );
    await handle.close();
    const { size } = await stat(tmpPath);
    const reservation = await sql`
      SELECT declared_bytes AS "declaredBytes" FROM stored_objects
      WHERE project_id = ${scope.projectId} AND oid = ${oid} AND state = 'reserved'
        AND reservation_expires_at > now() LIMIT 1`;
    if (!reservation.length || Number(reservation[0]!.declaredBytes) !== size) {
      return c.text("valid upload reservation required", 409);
    }
    await s3.send(
      new PutObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: keyFor(scope.projectId, oid),
        Body: createReadStream(tmpPath),
        ContentLength: size,
      }),
    );
    await confirmObject(scope, oid, size);
  } catch (e) {
    console.error("lfs put failed:", e);
    return c.text("storage error", 500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return new Response(null, { status: 200 });
});

app.get("/lfs/storage/:oid", async (c) => {
  const scope = c.get("scope") as TokenScope;
  const oid = c.req.param("oid");
  if (!OID_RE.test(oid)) return c.text("bad oid", 400);
  try {
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: keyFor(scope.projectId, oid),
      }),
    );
    if (!obj.Body) return c.text("missing body", 500);
    return new Response(obj.Body.transformToWebStream(), {
      headers: {
        "content-type": "application/octet-stream",
        ...(obj.ContentLength
          ? { "content-length": String(obj.ContentLength) }
          : {}),
      },
    });
  } catch {
    return c.text("not found", 404);
  }
});

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4101) }, () => {
  console.log(`lfs endpoint listening on :${process.env.PORT ?? 4101}`);
});
