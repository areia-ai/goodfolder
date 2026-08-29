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
    if (presignOn && presignS3) {
      // Direct-to-storage: auth lives in the URL signature.
      const href = await presign(op, key);
      const actions =
        op === "upload" ? { upload: { href } } : { download: { href } };
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
    await s3.send(
      new PutObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: keyFor(scope.projectId, oid),
        Body: createReadStream(tmpPath),
        ContentLength: size,
      }),
    );
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
