/**
 * The transport proxy and the push gate together. Auth uses the folder
 * credential; the transport service gets its own credentials and never
 * sees the folder's. Everything the proxy needs is injected in the env so
 * the same code runs in tests against a `git http-backend` upstream.
 */

import { createReadStream } from "node:fs";
import { open as openFile, unlink } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { Readable, Transform } from "node:stream";
import { createGunzip } from "node:zlib";
import {
  RepositoryAdapter,
  resolveScope,
  tokenFromAuthHeader,
  type Sql,
  type ServerConfig,
  type TokenScope,
} from "@goodfolder/serverlib";
import type { HostedBilling } from "../hosted-billing.ts";
import { transportRoute } from "../transport.ts";
import { emitWebhookEvent } from "../webhooks.ts";
import { asJson, screenLandedPush, type RemoteDeps } from "../remote.ts";
import { advertiseNoThin, progress, PushGateError } from "./pktline.ts";
import {
  band,
  decidePush,
  fileSize,
  FLUSH,
  newSpoolPath,
  pktLine,
  refusalReportStatus,
  refusalText,
  spoolBody,
  upstreamFailureStatus,
  type GateMode,
  type PushRefusal,
  SlotLimiter,
} from "./gate.ts";
import { parseReceivePackBody } from "./inspect.ts";

/** Pushes above this are parsed one at a time (see `heavy`). */
const HEAVY_PUSH_BYTES = 64 * 1024 * 1024;

export interface GitProxyEnv {
  sql: Sql;
  repos: RepositoryAdapter;
  billing: HostedBilling;
  cfg: ServerConfig;
  remoteDeps: RemoteDeps;
  fetchImpl?: typeof fetch;
  writeAccessError?: (accountId: string) => Promise<{ code: string; message: string; status: number } | null>;
  gate?: {
    mode: GateMode;
    maxBytes: number;
    spoolDir: string;
    limiter: SlotLimiter;
    /** Settles once the startup spool sweep is done; pushes wait on it. */
    ready?: Promise<void>;
  } | undefined;
}

/**
 * Transport proxy. Auth uses the folder credential; the transport service
 * gets its own credentials and never sees the folder's.
 */
export function createGitProxy(env: GitProxyEnv) {
  const { sql, repos, billing, cfg, remoteDeps } = env;
  const fetchImpl = env.fetchImpl ?? fetch;
  /** One large push parsed at a time; small ones are not held behind it. */
  const heavy = new SlotLimiter(1);
  const gate = env.gate;

  async function gitProxy(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  const deny = (code: number, msg: string, errorCode?: string) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    // RFC-required challenge: stock git clients only offer credentials
    // after seeing this on a 401.
    if (code === 401) headers["www-authenticate"] = 'Basic realm="GoodFolder"';
    res.writeHead(code, headers);
    res.end(JSON.stringify({ error: { code: errorCode ?? (code === 403 ? "project-scope" : "unauthorized"), message: msg } }));
  };

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  // Path shape: /git/<projectId>/<one of the three smart HTTP endpoints>.
  // Anything else never reaches the repository service (transport.ts).
  const route = transportRoute(url);
  if (!route) return deny(404, "malformed git path");

  const raw = tokenFromAuthHeader(req.headers.authorization);
  const scope = raw ? await resolveScope(sql, raw, route.projectId) : null;
  if (!scope) return deny(401, "unauthorized");
  if (route.projectId !== scope.projectId) return deny(403, "token not valid for this project");

  const isWrite = route.isWrite;
  // A scoped service credential reaches the transport only through the
  // scope it was approved for; a folder's own credential is unchanged.
  if (scope.service) {
    const needed = isWrite ? "git:write" : "git:read";
    if (!scope.service.scopes.includes(needed)) {
      return deny(403, "This access key was not approved for that action.", "scope");
    }
  }
  let remainingBytes = Number.POSITIVE_INFINITY;
  if (isWrite) {
    const denied = await (env.writeAccessError ?? (async () => null))(scope.ownerAccountId);
    if (denied) return deny(denied.status, denied.message, denied.code);
    const entitlement = await billing.entitlement(scope.ownerAccountId);
    if (!entitlement.canWrite) {
      const code = entitlement.reason ?? "subscription-required";
      const message = code === "quota-exceeded"
        ? "Protected-data limit reached; existing files and earlier versions remain available."
        : code === "read-only"
          ? "This account is in read and export mode."
          : "Hosted access is required before saving.";
      return deny(code === "quota-exceeded" ? 409 : code === "subscription-required" ? 402 : 403, message, code);
    }
    if (entitlement.authorizedBytes !== null) {
      remainingBytes = Math.max(0, entitlement.authorizedBytes - entitlement.usageBytes - entitlement.reservedBytes);
      const declared = Number(req.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > remainingBytes) {
        return deny(413, "This save is larger than the remaining protected-data allowance.", "quota-exceeded");
      }
    }
  }

  // For the write that actually lands objects, remember where the folder
  // stood first. After the answer has been relayed we look again — a push
  // that is never recorded as a save still raises save.flagged. A failed
  // read here just means the screen diffs from empty; it must never fail
  // the push itself.
  const headBefore =
    isWrite && route.subpath === "/git-receive-pack"
      ? await repos.head(route.projectId).catch(() => null)
      : undefined;

  const upstream = `${cfg.giteaInternalUrl}/${cfg.giteaAdminUser}/${route.projectId}.git${route.subpath}${url.search}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    const key = k.toLowerCase();
    // Node's fetch owns framing for the streamed request body. Forwarding the
    // incoming chunked header makes undici reject the request before it ever
    // reaches the repository service (`UND_ERR_INVALID_ARG`). Keep an explicit
    // content length when the client supplied one, but never forward transfer
    // encoding itself.
    if (key === "authorization" || key === "host" || key === "connection" || key === "expect" || key === "transfer-encoding" || key.startsWith("proxy-")) continue;
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  headers.set("Authorization", `Basic ${Buffer.from(`${cfg.giteaAdminUser}:${cfg.giteaAdminPassword}`).toString("base64")}`);

  const method = req.method ?? "GET";

  // A push the gate watches: quarantine the body, check what it lands,
  // then answer or forward. `off` keeps the plain stream below.
  if (
    gate && gate.mode !== "off" &&
    isWrite && method === "POST" && route.subpath === "/git-receive-pack"
  ) {
    return gatedReceivePack({ req, res, route, scope, upstream, headers, remainingBytes, headBefore });
  }

  let upstreamRes: Response;
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
  };
  if (!["GET", "HEAD"].includes(method)) {
    if (isWrite && Number.isFinite(remainingBytes)) {
      let received = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          received += Buffer.byteLength(chunk);
          if (received > remainingBytes) return callback(new Error("quota-exceeded"));
          callback(null, chunk);
        },
      });
      req.pipe(meter);
      init.body = meter as unknown as import("node:stream/web").ReadableStream;
    } else {
      init.body = req as unknown as import("node:stream/web").ReadableStream;
    }
    init.duplex = "half";
  }
  try {
    upstreamRes = await fetchImpl(upstream, init);
  } catch (e) {
    if ((e as Error).message.includes("quota-exceeded")) {
      return deny(413, "This save is larger than the remaining protected-data allowance.", "quota-exceeded");
    }
    console.error("transport upstream request failed:", e);
    return deny(502, "repository service unreachable");
  }

  const outHeaders: Record<string, string> = {};
  upstreamRes.headers.forEach((v, k) => {
    if (!["transfer-encoding", "content-encoding", "content-length"].includes(k)) outHeaders[k] = v;
  });

  // A receive-pack advertisement gets `no-thin` woven into its capability
  // list so the packs the gate later inspects arrive self-contained.
  const advertise =
    gate && gate.mode !== "off" &&
    route.subpath === "/info/refs" &&
    url.searchParams.get("service") === "git-receive-pack" &&
    upstreamRes.status === 200;
  if (advertise) {
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    const rewritten = advertiseNoThin(buf);
    outHeaders["content-length"] = String(rewritten.length);
    res.writeHead(upstreamRes.status, outHeaders);
    res.end(rewritten);
    return;
  }

  res.writeHead(upstreamRes.status, outHeaders);
  if (headBefore !== undefined && upstreamRes.status >= 200 && upstreamRes.status < 300) {
    res.once("finish", () => {
      void screenLandedPush(remoteDeps, {
        projectId: route.projectId,
        accountId: scope.ownerAccountId,
        before: headBefore,
        actor: scope.service?.name ?? "folder",
        gate: gate?.mode ?? "off",
      });
    });
  }
  relay(upstreamRes, res);
  }

  interface GatedPush {
    req: import("node:http").IncomingMessage;
    res: import("node:http").ServerResponse;
    route: NonNullable<ReturnType<typeof transportRoute>>;
    scope: TokenScope;
    upstream: string;
    headers: Headers;
    remainingBytes: number;
    headBefore: string | null | undefined;
  }

  /**
   * The gated receive-pack path: spool the body, check what it lands, then
   * answer the client ourselves or hand Gitea the untouched bytes.
   */
  async function gatedReceivePack(ctx: GatedPush): Promise<void> {
    const { req, res, route, scope, upstream, headers, remainingBytes, headBefore } = ctx;
    const g = gate!;
    // A push arriving during startup must wait for the sweep, or its own
    // spool file could be swept out from under it.
    await g.ready?.catch(() => {});
    const release = await g.limiter.acquire();
    const spoolPath = await newSpoolPath(g.spoolDir).catch(() => null);
    if (!spoolPath) {
      release();
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "server", message: "The save could not be prepared for checking." } }));
      return;
    }
    // The spool is removed in the `finally` below — accept, refuse, error or
    // client abort all pass through it. (A "close" listener on req would
    // race: the request stream closes as soon as the body is consumed, while
    // the decision still needs the file.)
    const cleanup = () => void unlink(spoolPath).catch(() => {});
    try {
      const declared = Number(req.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > g.maxBytes) {
        return refusePlain(res, "too-large", "This save is too large to check in one go. Save it in parts.", 413);
      }

      let received = 0;
      const meter = Number.isFinite(remainingBytes)
        ? new Transform({
            transform(chunk, _encoding, callback) {
              received += Buffer.byteLength(chunk);
              if (received > remainingBytes) return callback(new Error("quota-exceeded"));
              callback(null, chunk);
            },
          })
        : null;

      try {
        await spoolBody(req, spoolPath, meter ? [meter] : [], g.maxBytes);
      } catch (error) {
        if (error instanceof PushGateError && error.code === "too-large") {
          return refusePlain(res, "too-large", "This save is too large to check in one go. Save it in parts.", 413);
        }
        if ((error as Error).message === "quota-exceeded") {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "quota-exceeded", message: "This save is larger than the remaining protected-data allowance." } }));
          return;
        }
        if (req.destroyed || res.destroyed) return; // client went away — the spool is swept
        console.error("push gate spool failed:", error);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "server", message: "The save could not be prepared for checking." } }));
        return;
      }

      // What the client asked of the answer — read from the spool's head
      // before the full inspection so keepalives can start.
      const caps = await peekCapabilities(spoolPath, req.headers["content-encoding"] === "gzip");
      const sideband = caps?.capabilities.some((c) => c === "side-band" || c === "side-band-64k") ?? false;
      const wantStatus = caps?.capabilities.some((c) => c === "report-status" || c === "report-status-v2") ?? false;
      let keepalive: ReturnType<typeof setInterval> | null = null;
      if (sideband) {
        res.writeHead(200, { "content-type": "application/x-git-receive-pack-result" });
        res.write(progress("GoodFolder is checking this save…\n"));
        keepalive = setInterval(() => {
          res.write(progress("GoodFolder is checking this save…\n"));
        }, 5000);
        keepalive.unref?.();
      }

      let decision;
      let unreadable: PushGateError | null = null;
      // A large push is checked alone: parsing costs memory in proportion
      // to the objects it carries, and two at once could crowd the process.
      const releaseHeavy = (await fileSize(spoolPath)) > HEAVY_PUSH_BYTES ? await heavy.acquire() : null;
      try {
        decision = await decidePush(remoteDeps, route.projectId, spoolPath, {
          gzip: req.headers["content-encoding"] === "gzip",
          isDevice: !scope.service,
        });
      } catch (error) {
        console.error("push gate unreadable:", error);
        unreadable = error instanceof PushGateError ? error : new PushGateError("unreadable", String(error));
      } finally {
        releaseHeavy?.();
        if (keepalive) clearInterval(keepalive);
      }

      const actor = await actorFor(scope);
      const refs = decision?.refs ?? caps?.commands ?? [];

      const refusal: PushRefusal | null =
        decision?.refusal ??
        (unreadable
          ? { code: "unreadable", refusalId: crypto.randomUUID(), paths: [], total: 0 }
          : null);

      if (refusal && g.mode === "enforce") {
        console.error(`PUSH REFUSED [${refusal.code}] project ${route.projectId} by ${actor}: ${refusal.total} file(s) left out — nothing landed. refusalId=${refusal.refusalId}`);
        await auditPushRefusal(route, scope, actor, refusal, refs, decision?.packBytes ?? 0, "enforce");
        if (sideband) {
          for (const line of refusalText(refusal).split("\n").filter(Boolean)) {
            res.write(progress(line + "\n"));
          }
          if (wantStatus) {
            const status = refs.length
              ? refusalReportStatus(refs, refusal.code)
              : [pktLine(`unpack error ${refusal.code}`), FLUSH];
            res.write(band(1, Buffer.concat(status)));
          }
          res.write(FLUSH);
          res.end();
          return;
        }
        return refusePlain(res, refusal.code, refusalText(refusal), 403, refusal);
      }
      if (refusal && g.mode === "observe") {
        console.error(`PUSH WOULD REFUSE [${refusal.code}] project ${route.projectId} by ${actor}: ${refusal.total} file(s) — forwarding anyway. refusalId=${refusal.refusalId}`);
        await auditPushRefusal(route, scope, actor, refusal, refs, decision?.packBytes ?? 0, "observe");
      }
      if (unreadable && g.mode === "observe") {
        console.error(`push gate could not read a push for project ${route.projectId}: ${unreadable.message} — forwarding anyway (observe)`);
      }
      if (decision?.includedOnPurpose.length) {
        await auditIncluded(route, scope, actor, decision.includedOnPurpose);
      }

      // Forwarded: the same bytes the client sent, with the same headers.
      const size = await fileSize(spoolPath);
      headers.set("content-length", String(size));
      let upstreamRes: Response;
      try {
        // fetch/undici pulls a stream body as fast as it can and buffers it
        // all — a whole save in memory. The default forwarder writes the
        // spool file through http.request, respecting drain, so the body
        // never piles up in buffers. (fetchImpl stays injectable for tests.)
        upstreamRes = env.fetchImpl
          ? await fetchImpl(upstream, {
              method: "POST",
              headers,
              body: (() => {
                const s = createReadStream(spoolPath);
                s.on("error", () => {});
                return s as unknown as import("node:stream/web").ReadableStream;
              })(),
              duplex: "half",
            } as RequestInit & { duplex: "half" })
          : await postFileUpstream(upstream, headers, spoolPath);
      } catch (e) {
        console.error("transport upstream request failed:", e);
        if (sideband) {
          if (wantStatus) res.write(band(1, Buffer.concat(upstreamFailureStatus(refs))));
          res.write(FLUSH);
          res.end();
          return;
        }
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "unreachable", message: "repository service unreachable" } }));
        return;
      }

      if (sideband) {
        if (upstreamRes.status >= 200 && upstreamRes.status < 300) {
          relay(upstreamRes, res);
        } else {
          console.error(`push gate: upstream answered ${upstreamRes.status} after headers sent; reporting ng`);
          upstreamRes.body?.cancel().catch(() => {});
          if (wantStatus) res.write(band(1, Buffer.concat(upstreamFailureStatus(refs))));
          res.write(FLUSH);
          res.end();
        }
      } else {
        const outHeaders: Record<string, string> = {};
        upstreamRes.headers.forEach((v, k) => {
          if (!["transfer-encoding", "content-encoding", "content-length"].includes(k)) outHeaders[k] = v;
        });
        res.writeHead(upstreamRes.status, outHeaders);
        relay(upstreamRes, res);
      }
      if (upstreamRes.status >= 200 && upstreamRes.status < 300) {
        const wasRefusalId = refusal ? refusal.refusalId : null;
        const included = decision?.includedOnPurpose ?? [];
        res.once("finish", () => {
          void screenLandedPush(remoteDeps, {
            projectId: route.projectId,
            accountId: scope.ownerAccountId,
            before: headBefore ?? null,
            actor: scope.service?.name ?? "folder",
            gate: g.mode,
            refusalId: wasRefusalId,
            includedOnPurpose: included,
          });
        });
      }
    } finally {
      release();
      cleanup();
    }
  }

  /** The refusal a non-sideband client gets: HTTP 403 carrying the JSON. */
  function refusePlain(
    res: import("node:http").ServerResponse,
    code: string,
    message: string,
    status: number,
    refusal?: PushRefusal,
  ): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: {
        code,
        message,
        ...(refusal
          ? {
              refusal: {
                refusalId: refusal.refusalId,
                paths: refusal.paths,
                total: refusal.total,
              },
            }
          : {}),
      },
    }));
  }

  /** Read just the pkt-line head of a spooled push for its capabilities. */
  async function peekCapabilities(
    spoolPath: string,
    gzip: boolean,
  ): Promise<{ commands: { ref: string; oldId: string; newId: string }[]; capabilities: string[] } | null> {
    try {
      let head: Buffer;
      if (gzip) {
        head = await gunzipHead(spoolPath, 1 << 16);
      } else {
        const fh = await openFile(spoolPath, "r");
        const buf = Buffer.alloc(1 << 16);
        let bytesRead: number;
        try {
          ({ bytesRead } = await fh.read(buf, 0, buf.length, 0));
        } finally {
          await fh.close();
        }
        head = buf.subarray(0, bytesRead);
      }
      const parsed = parseReceivePackBody(head, false);
      return { commands: parsed.commands, capabilities: parsed.capabilities };
    } catch {
      return null;
    }
  }

  /** `device id (name)` or `service key id (name)` for audit rows. */
  async function actorFor(scope: TokenScope): Promise<string> {
    if (scope.service) return `${scope.service.credentialId} (${scope.service.name})`;
    const rows = await sql`SELECT name FROM devices WHERE id = ${scope.deviceId}`.catch(() => []);
    const name = (rows as { name?: string }[])[0]?.name;
    return name ? `${scope.deviceId} (${name})` : scope.deviceId;
  }

  async function auditPushRefusal(
    route: { projectId: string },
    scope: TokenScope,
    actor: string,
    refusal: PushRefusal,
    refs: readonly { ref: string; oldId: string; newId: string }[],
    packBytes: number,
    mode: GateMode,
  ): Promise<void> {
    const event = mode === "observe" ? "push.would-refuse" : "push.refused";
    try {
      await sql`
        INSERT INTO audit_log (actor, action, detail)
        VALUES (${actor}, ${event}, ${sql.json(asJson({
          refusalId: refusal.refusalId,
          projectId: route.projectId,
          actor,
          refs: refs.map((r) => ({ ref: r.ref, old: r.oldId, new: r.newId })),
          paths: refusal.paths.map(({ path, kind, pattern }) => ({ path, kind, pattern })),
          total: refusal.total,
          packBytes,
          mode,
        }))})`;
    } catch (error) {
      console.error(`${event} audit insert failed:`, error);
    }
    if (event !== "push.refused") return;
    void emitWebhookEvent(sql, {
      accountId: scope.ownerAccountId,
      projectId: route.projectId,
      event: "push.refused",
      data: {
        refusalId: refusal.refusalId,
        refs: refs.map((r) => ({ ref: r.ref, old: r.oldId, new: r.newId })),
        paths: refusal.paths.map(({ path, kind, pattern }) => ({ path, kind, pattern })),
        total: refusal.total,
      },
    });
  }

  async function auditIncluded(
    route: { projectId: string },
    scope: TokenScope,
    actor: string,
    paths: readonly string[],
  ): Promise<void> {
    try {
      await sql`
        INSERT INTO audit_log (actor, action, detail)
        VALUES (${actor}, 'push.included-on-purpose',
                ${sql.json(asJson({ projectId: route.projectId, actor, paths }))})`;
    } catch (error) {
      console.error("push.included-on-purpose audit insert failed:", error);
    }
  }

  return gitProxy;
}

/**
 * POST the spooled body upstream with a bounded buffer: writes pause on
 * backpressure, so memory stays flat no matter how large the save is.
 * The answer arrives as a Response so the caller's relay code is unchanged.
 */
function postFileUpstream(upstream: string, headers: Headers, spoolPath: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const u = new URL(upstream);
    const req = httpRequest({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: "POST",
      headers: Object.fromEntries(headers.entries()),
    });
    req.on("response", (up) => {
      const out = new Headers();
      for (const [k, v] of Object.entries(up.headers)) {
        if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
      resolve(
        new Response(Readable.toWeb(up) as ReadableStream, {
          status: up.statusCode && up.statusCode >= 200 ? up.statusCode : 502,
          headers: out,
        }),
      );
    });
    req.on("error", reject);
    const src = createReadStream(spoolPath);
    src.on("data", (chunk) => {
      if (!req.write(chunk)) src.pause();
    });
    req.on("drain", () => src.resume());
    src.on("end", () => req.end());
    src.on("error", () => req.destroy());
  });
}

/** Inflate just the head of a gzipped spool — enough for the pkt-line head. */
async function gunzipHead(path: string, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  const stream = createReadStream(path).pipe(createGunzip());
  try {
    for await (const c of stream) {
      chunks.push(c as Buffer);
      n += (c as Buffer).length;
      if (n >= cap) break;
    }
  } catch {
    /* a truncated gzip still yields whatever head it had */
  }
  return Buffer.concat(chunks);
}
/**
 * Stream an upstream answer to the client, and stop reading upstream the
 * moment the client goes away — a half-downloaded history should not keep
 * the repository service busy for someone who is no longer there.
 */
export function relay(upstreamRes: Response, res: import("node:http").ServerResponse): void {
  if (!upstreamRes.body) {
    res.end();
    return;
  }
  const reader = upstreamRes.body.getReader();
  let gone = false;
  res.once("close", () => {
    gone = true;
    void reader.cancel().catch(() => {});
  });
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || gone) break;
        if (!res.write(value)) await new Promise<void>((r) => res.once("drain", r));
      }
    } catch {
      /* upstream closed or client cancelled — either way there is nothing left to send */
    } finally {
      res.end();
    }
  })();
}
