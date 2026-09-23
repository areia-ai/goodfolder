/**
 * The gate end to end: a real git client pushes through the real proxy
 * path, whose upstream is a bare repository served by `git http-backend`.
 * Everything lives in temporary directories — no real folder is read.
 */

import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";

const tokenHash = (raw: string) => createHash("sha256").update(raw).digest("hex");

const execFileAsync = promisify(execFile);
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { FileChange, RepositoryAdapter, Sql } from "@goodfolder/serverlib";
import type { HostedBilling } from "../hosted-billing.ts";
import { createGitProxy, type GitProxyEnv } from "./proxy.ts";
import { SlotLimiter } from "./gate.ts";
import type { RemoteDeps, TreeEntry } from "../remote.ts";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const TOKEN = "folder-token-1";
const SERVICE_TOKEN = "svc-token-1";
const dirs: string[] = [];
const servers: Server[] = [];

after(() => {
  for (const s of servers) s.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A minimal CGI host for `git http-backend` — the upstream.
// ---------------------------------------------------------------------------

interface Upstream {
  url: string;
  bare: string;
  /** Bodies the upstream received, keyed by "METHOD path?query". */
  bodies: Map<string, Buffer[]>;
  requests: { method: string; path: string; body: Buffer }[];
}

function startUpstream(): Promise<Upstream> {
  const dir = mkdtempSync(join(tmpdir(), "gf-upstream-"));
  dirs.push(dir);
  const bare = join(dir, `${PROJECT}.git`);
  execFileSync("git", ["init", "-q", "--bare", bare]);
  execFileSync("git", ["-C", bare, "config", "http.receivepack", "true"]);
  execFileSync("git", ["-C", bare, "config", "receive.advertisePushOptions", "true"]);
  const requests: { method: string; path: string; body: Buffer }[] = [];
  const bodies = new Map<string, Buffer[]>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const u = new URL(req.url ?? "/", "http://x");
      // Strip the service-account prefix the proxy prepends.
      const pathInfo = u.pathname.replace(/^\/gf-service/, "");
      requests.push({ method: req.method ?? "GET", path: `${u.pathname}${u.search}`, body });
      const key = `${req.method} ${pathInfo}${u.search}`;
      if (!bodies.has(key)) bodies.set(key, []);
      bodies.get(key)!.push(body);
      const child = spawn("git", ["http-backend"], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: dir,
          GIT_HTTP_EXPORT_ALL: "",
          PATH_INFO: pathInfo,
          QUERY_STRING: u.search.slice(1),
          REQUEST_METHOD: req.method ?? "GET",
          CONTENT_TYPE: (req.headers["content-type"] as string) ?? "",
          REMOTE_USER: "gf-service",
        },
      });
      child.stdin.write(body);
      child.stdin.end();
      const out: Buffer[] = [];
      child.stdout.on("data", (c) => out.push(c));
      child.stderr.on("data", () => {});
      child.on("close", () => {
        const raw = Buffer.concat(out);
        let sep = raw.indexOf("\r\n\r\n");
        let sepLen = 4;
        if (sep < 0) {
          sep = raw.indexOf("\n\n");
          sepLen = 2;
        }
        if (sep < 0) {
          res.writeHead(502);
          res.end();
          return;
        }
        const head = raw.subarray(0, sep).toString();
        const payload = raw.subarray(sep + sepLen);
        const headers: Record<string, string> = {};
        let status = 200;
        for (const line of head.split(/\r?\n/)) {
          const i = line.indexOf(":");
          if (i <= 0) continue;
          const name = line.slice(0, i).trim();
          const value = line.slice(i + 1).trim();
          if (/^status$/i.test(name)) status = Number(value.split(" ")[0]) || 200;
          else headers[name] = value;
        }
        res.writeHead(status, headers);
        res.end(payload);
      });
    });
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        bare,
        bodies,
        requests,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Fakes for the proxy's dependencies.
// ---------------------------------------------------------------------------

interface RecordedAudit {
  actor: string;
  action: string;
  detail: unknown;
}

function fakeSql(log: { audits: RecordedAudit[]; deliveries: { event: string; data: unknown }[]; storedObjects: { oid: string }[] }): Sql & { texts: string[] } {
  const texts: string[] = [];
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    texts.push(text);
    if (text.includes("FROM transfer_tokens")) {
      return values.includes(tokenHash(TOKEN))
        ? [{ device_id: "dev-1", project_id: PROJECT, account_id: "acct-1", device_kind: "user" }]
        : [];
    }
    if (text.includes("FROM service_credentials") && text.includes("JOIN projects")) {
      return values.includes(tokenHash(SERVICE_TOKEN))
        ? [{
            credentialId: "svc-1", accountId: "acct-1", email: "svc@x",
            name: "svc key", scopes: ["git:write", "git:read"], boundProjectId: PROJECT,
            projectOwnerId: "acct-1",
          }]
        : [];
    }
    if (text.includes("FROM service_credential_devices")) return [{ deviceId: "svc-dev-1" }];
    if (text.startsWith("SELECT name FROM devices")) return [{ name: "test laptop" }];
    if (text.includes("FROM webhook_endpoints")) {
      return [{ id: "ep-1", events: ["push.refused", "push.would-refuse", "save.flagged"] }];
    }
    if (text.startsWith("INSERT INTO webhook_deliveries")) {
      log.deliveries.push({ event: String(values[2]), data: values[4] });
      return [];
    }
    if (text.includes("FROM account_devices")) return [{ name: "test laptop" }];
    if (text.startsWith("INSERT INTO audit_log")) {
      const action = text.match(/'(push\.[a-z-]+)'/)?.[1] ?? String(values[1]);
      log.audits.push({ actor: String(values[0]), action, detail: values[2] ?? values[1] });
      return [];
    }
    if (text.includes("FROM stored_objects") && text.startsWith("SELECT")) {
      const oid = values.find((v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v));
      return log.storedObjects.some((o) => o.oid === oid) ? [{ oid }] : [];
    }
    if (text.startsWith("DELETE FROM stored_objects")) return [];
    return [];
  };
  const tagged = query as unknown as Sql & { texts: string[] };
  tagged.texts = texts;
  tagged.json = ((v: unknown) => v) as Sql["json"];
  return tagged;
}

/** repos reads the bare upstream directly — the gate's witness. */
function bareRepos(upstream: Upstream): RepositoryAdapter {
  const gitBare = (args: string[]): string | null => {
    try {
      return execFileSync("git", ["-C", upstream.bare, ...args], { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  return {
    head: async () => gitBare(["rev-parse", "--verify", "refs/heads/main"]),
    tree: async (_p: string, ref = "main") => {
      const out = gitBare(["ls-tree", "-r", ref]);
      if (!out) return [];
      return out.split("\n").map((line) => {
        const m = /^(\d+) (blob|tree|commit) ([0-9a-f]{40})\t(.+)$/.exec(line)!;
        return { path: m[4]!, type: m[2]!, sha: m[3]!, size: 0 } as TreeEntry;
      });
    },
    readFile: async (_p: string, path: string, ref = "main") => {
      const out = gitBare(["show", `${ref}:${path}`]);
      if (out === null) return null;
      return { content: Buffer.from(out), sha: "0".repeat(40), size: out.length };
    },
    changeFiles: async (_input: { changes: FileChange[] }) => ({ commitSha: "x" }),
  } as unknown as RepositoryAdapter;
}

function fakeBilling(authorizedBytes: number | null = null, usageBytes = 0): HostedBilling {
  return {
    entitlement: async () => ({
      canWrite: true,
      authorizedBytes,
      usageBytes,
      reservedBytes: 0,
      reason: null,
    }),
  } as unknown as HostedBilling;
}

interface Fixture {
  env: GitProxyEnv;
  sql: Sql & { texts: string[] };
  upstream: Upstream;
  proxyUrl: string;
  spoolDir: string;
  audits: RecordedAudit[];
  deliveries: { event: string; data: unknown }[];
  storedObjects: { oid: string }[];
}

async function fixture(opts: {
  mode?: "enforce" | "observe" | "off";
  maxBytes?: number;
  authorizedBytes?: number | null;
  upstreamStatus?: number;
} = {}): Promise<Fixture> {
  const upstream = await startUpstream();
  const audits: RecordedAudit[] = [];
  const deliveries: { event: string; data: unknown }[] = [];
  const storedObjects: { oid: string }[] = [];
  const sql = fakeSql({ audits, deliveries, storedObjects });
  const repos = bareRepos(upstream);
  const remoteDeps: RemoteDeps = {
    sql,
    repos,
    writeAccessError: async () => null,
    refreshUsage: () => {},
    labelFor: async () => ({ label: "x", source: "agent" }),
  };
  const spoolDir = mkdtempSync(join(tmpdir(), "gf-spool-"));
  dirs.push(spoolDir);
  const env: GitProxyEnv = {
    sql,
    repos,
    billing: fakeBilling(opts.authorizedBytes ?? null),
    cfg: {
      giteaInternalUrl: upstream.url,
      giteaAdminUser: "gf-service",
      giteaAdminPassword: "pw",
      s3Bucket: "test-bucket",
    } as GitProxyEnv["cfg"],
    remoteDeps,
    writeAccessError: async () => null,
    gate: {
      mode: opts.mode ?? "enforce",
      maxBytes: opts.maxBytes ?? 2_147_483_648,
      spoolDir,
      limiter: new SlotLimiter(4),
    },
  };
  if (opts.upstreamStatus !== undefined) {
    const status = opts.upstreamStatus;
    // Fail only the receive-pack POST — the advertisement must still flow so
    // the client actually pushes.
    env.fetchImpl = async (input, init) => {
      if ((init?.method ?? "GET") !== "GET") {
        return new Response("upstream failed", {
          status,
          headers: { "content-type": "text/plain" },
        });
      }
      return fetch(input, init);
    };
  }
  const proxy = createGitProxy(env);
  const server = createServer((req, res) => {
    void proxy(req, res);
  });
  servers.push(server);
  const proxyUrl = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
  return { env, sql, upstream, proxyUrl, spoolDir, audits, deliveries, storedObjects };
}

// ---------------------------------------------------------------------------
// A working clone on the client side.
// ---------------------------------------------------------------------------

function mkWork(fx: Fixture, token = TOKEN) {
  const dir = mkdtempSync(join(tmpdir(), "gf-work-"));
  dirs.push(dir);
  const repo = join(dir, "w");
  execFileSync("git", ["init", "-q", repo]);
  const url = `http://x:${token}@${fx.proxyUrl.replace("http://", "")}/git/${PROJECT}`;
  execFileSync("git", ["-C", repo, "remote", "add", "gf", url]);
  const git = (args: string[]): { code: number; stdout: string; stderr: string } => {
    try {
      // credential.helper= disables the host keychain — the token travels in
      // the remote URL, and a GUI credential prompt would hang the test.
      const stdout = execFileSync("git", ["-C", repo, "-c", "credential.helper=", ...args], {
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      return { code: 0, stdout, stderr: "" };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
    }
  };
  // A push needs the proxy to answer — which means the test's own event loop
  // — so it must never run through a blocking execFileSync.
  const push = async (args: string[] = []): Promise<{ code: number; stdout: string; stderr: string }> => {
    try {
      const { stdout, stderr } = await execFileAsync(
        "git",
        ["-C", repo, "-c", "credential.helper=", "push", "gf", ...args],
        { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      );
      return { code: 0, stdout, stderr };
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string };
      return { code: err.code ?? 1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
    }
  };
  const commitAll = (message: string): string => {
    git(["add", "-A"]);
    git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", message]);
    return git(["rev-parse", "HEAD"]).stdout.trim();
  };
  const write = (path: string, content: string | Buffer) => writeFileSync(join(repo, path), content);
  const upstreamObjectCount = () =>
    Number(
      execFileSync("bash", ["-c", `git -C ${fx.upstream.bare} cat-file --batch-all-objects --batch-check | wc -l`], {
        encoding: "utf8",
      }).trim(),
    );
  const upstreamRefs = () =>
    execFileSync("git", ["-C", fx.upstream.bare, "for-each-ref", "--format=%(refname):%(objectname)"], {
      encoding: "utf8",
    }).trim();
  return { repo, git, push, commitAll, write, upstreamObjectCount, upstreamRefs };
}

const spoolFiles = (dir: string) => readdirSync(dir).filter((f) => f.startsWith("push-"));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("a refused push leaves the upstream byte-identical and prints the refusal", async () => {
  const fx = await fixture();
  const w = mkWork(fx);
  w.write("notes.md", "hello\n");
  w.commitAll("base");
  const push = await w.push(["HEAD:main"]);
  assert.equal(push.code, 0, push.stderr);
  w.write(".env", "TOKEN=secret\n");
  w.commitAll("adds env");
  const objectsBefore = w.upstreamObjectCount();
  const refsBefore = w.upstreamRefs();
  const refused = await w.push(["HEAD:main"]);
  assert.notEqual(refused.code, 0);
  assert.ok(refused.stderr.includes("GoodFolder refused this save"), refused.stderr);
  assert.ok(
    refused.stderr.includes("GoodFolder is checking this save"),
    "side-band keepalive line reached the client: " + refused.stderr,
  );
  assert.ok(refused.stderr.includes(".env"), refused.stderr);
  const marker = refused.stderr.split("\n").find((l) => l.includes("goodfolder-refusal {"));
  assert.ok(marker, refused.stderr);
  const refusal = JSON.parse(marker!.replace(/^.*goodfolder-refusal /, ""));
  assert.equal(refusal.code, "left-out");
  assert.equal(refusal.paths[0].path, ".env");
  // Upstream never saw it: no new objects, no moved refs, no receive-pack body.
  assert.equal(w.upstreamObjectCount(), objectsBefore);
  assert.equal(w.upstreamRefs(), refsBefore);
  const receiveBodies = fx.upstream.requests.filter((r) => r.path.includes("git-receive-pack") && r.method === "POST");
  assert.equal(receiveBodies.length, 1, "only the accepted push reached upstream");
  assert.equal(spoolFiles(fx.spoolDir).length, 0, "spool cleaned");
  const refusedAudit = fx.audits.find((a) => a.action === "push.refused");
  assert.ok(refusedAudit, JSON.stringify(fx.audits));
  assert.ok(
    refusedAudit.actor.includes("test laptop"),
    `audit actor carries the device name: ${refusedAudit.actor}`,
  );
  assert.ok(
    fx.deliveries.some((d) => d.event === "push.refused"),
    JSON.stringify(fx.deliveries),
  );
});

test("an accepted push lands and the forwarded body is the client's own bytes", async () => {
  const fx = await fixture();
  const w = mkWork(fx);
  w.write("file.txt", "content\n");
  w.commitAll("base");
  const push = await w.push(["HEAD:main"]);
  assert.equal(push.code, 0, push.stderr);
  const tip = w.git(["rev-parse", "HEAD"]).stdout.trim();
  assert.equal(
    execFileSync("git", ["-C", fx.upstream.bare, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim(),
    tip,
  );
  assert.equal(spoolFiles(fx.spoolDir).length, 0);
});

test("the advertisement carries no-thin and the client sends a self-contained pack", async () => {
  const fx = await fixture();
  const w = mkWork(fx);
  w.write("big.txt", Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n"));
  w.commitAll("base");
  assert.equal((await w.push(["HEAD:main"])).code, 0);
  w.write("big.txt", readFileSync(join(w.repo, "big.txt")).toString().replace("line 200", "line two hundred"));
  w.commitAll("edit");
  assert.equal((await w.push(["HEAD:main"])).code, 0);
  // The second receive-pack body must unpack standalone — the client obeyed no-thin.
  const bodies = fx.upstream.bodies.get(`POST /${PROJECT}.git/git-receive-pack`);
  assert.ok(bodies && bodies.length >= 2);
  const body = bodies[bodies.length - 1]!;
  const packAt = body.indexOf("PACK");
  const pack = join(fx.upstream.bare, "..", `second-${Date.now()}.pack`);
  writeFileSync(pack, body.subarray(packAt));
  const empty = mkdtempSync(join(tmpdir(), "gf-empty-"));
  dirs.push(empty);
  execFileSync("git", ["init", "-q", "--bare", join(empty, "e.git")]);
  execFileSync("bash", ["-c", `git -C ${join(empty, "e.git")} index-pack --stdin < ${pack}`]);
});

test("over the byte cap answers too-large before upstream is contacted", async () => {
  const fx = await fixture({ maxBytes: 1024 });
  const w = mkWork(fx);
  // Random bytes: the pack must not compress under the cap.
  w.write("big.txt", randomBytes(64 * 1024));
  w.commitAll("big");
  const push = await w.push(["HEAD:main"]);
  assert.notEqual(push.code, 0);
  const receivePosts = fx.upstream.requests.filter((r) => r.method === "POST" && r.path.includes("git-receive-pack"));
  assert.equal(receivePosts.length, 0, "upstream never contacted");
});

test("the quota meter still applies in gate mode", async () => {
  const fx = await fixture({ authorizedBytes: 100 });
  const w = mkWork(fx);
  w.write("file.txt", Buffer.alloc(64 * 1024, 2));
  w.commitAll("over quota");
  const push = await w.push(["HEAD:main"]);
  assert.notEqual(push.code, 0);
  const receivePosts = fx.upstream.requests.filter((r) => r.method === "POST" && r.path.includes("git-receive-pack"));
  assert.equal(receivePosts.length, 0);
});

test("observe mode forwards the push and records the would-refusal", async () => {
  const fx = await fixture({ mode: "observe" });
  const w = mkWork(fx);
  w.write("keep.md", "k\n");
  w.commitAll("base");
  assert.equal((await w.push(["HEAD:main"])).code, 0);
  w.write(".env", "TOKEN=x\n");
  w.commitAll("adds env");
  const push = await w.push(["HEAD:main"]);
  assert.equal(push.code, 0, push.stderr);
  assert.ok(fx.audits.some((a) => a.action === "push.would-refuse"), JSON.stringify(fx.audits));
  assert.equal(spoolFiles(fx.spoolDir).length, 0);
});

test("off mode streams without any gate work", async () => {
  const fx = await fixture({ mode: "off" });
  const w = mkWork(fx);
  w.write(".env", "TOKEN=x\n");
  w.commitAll("env");
  const push = await w.push(["HEAD:main"]);
  assert.equal(push.code, 0, push.stderr);
  assert.equal(fx.audits.filter((a) => a.action.includes("push")).length, 0);
});

test("a device include option passes where a plain push is refused", async () => {
  const fx = await fixture();
  const w = mkWork(fx);
  w.write("keep.md", "k\n");
  w.commitAll("base");
  assert.equal((await w.push(["HEAD:main"])).code, 0);
  w.write(".env", "TOKEN=x\n");
  w.commitAll("env");
  const refused = await w.push(["HEAD:main"]);
  assert.notEqual(refused.code, 0);
  const included = await w.push(["-o", "goodfolder-include=.env", "HEAD:main"]);
  assert.equal(included.code, 0, included.stderr);
  assert.ok(fx.audits.some((a) => a.action === "push.included-on-purpose"));
});

test("an upstream failure after headers yields ng lines", async () => {
  const fx = await fixture({ upstreamStatus: 500 });
  const w = mkWork(fx);
  w.write("file.txt", "x\n");
  w.commitAll("base");
  const push = await w.push(["HEAD:main"]);
  assert.notEqual(push.code, 0);
  assert.ok(/ng refs\/heads\/main|service unavailable|unpack/i.test(push.stderr), push.stderr);
});

test("a client abort leaves no spool file", async () => {
  const fx = await fixture();
  // Hand-drive a receive-pack POST with a declared length we never finish.
  const { request } = await import("node:http");
  const req = request(`${fx.proxyUrl}/git/${PROJECT}/git-receive-pack`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`x:${TOKEN}`).toString("base64")}`,
      "content-type": "application/x-git-receive-pack-request",
      "content-length": "1000000",
    },
  });
  req.on("error", () => {});
  req.write(Buffer.from("partial"));
  await new Promise((r) => setTimeout(r, 150));
  req.destroy();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(spoolFiles(fx.spoolDir).length, 0);
});

test("a refused push leaves objects it uploaded ahead of time in storage", async () => {
  const fx = await fixture();
  const w = mkWork(fx);
  w.write("keep.md", "k\n");
  w.commitAll("base");
  assert.equal((await w.push(["HEAD:main"])).code, 0);
  const oid = "a".repeat(64);
  fx.storedObjects.push({ oid });
  w.write(".env", `oid sha256:${oid}\n`);
  w.commitAll("env pointer");
  const refused = await w.push(["HEAD:main"]);
  assert.notEqual(refused.code, 0);
  // Known gap: nothing deletes large-file objects uploaded ahead of a
  // refused save — the gate never issues a delete.
  assert.ok(
    !fx.sql.texts.some((t) => t.startsWith("DELETE FROM stored_objects")),
    JSON.stringify(fx.sql.texts.filter((t) => t.includes("stored_objects"))),
  );
});

test("a gzip-encoded refused push still gets the sideband refusal", async () => {
  // Capture the exact bytes a real client sends for a refused push by
  // running it once against an observe-mode gate, where it lands upstream.
  const observeFx = await fixture({ mode: "observe" });
  const w0 = mkWork(observeFx);
  w0.write("keep.md", "k\n");
  w0.commitAll("base");
  assert.equal((await w0.push(["HEAD:main"])).code, 0);
  w0.write(".env", "TOKEN=x\n");
  w0.commitAll("env");
  assert.equal((await w0.push(["HEAD:main"])).code, 0);
  const bodies = observeFx.upstream.bodies.get(`POST /${PROJECT}.git/git-receive-pack`);
  assert.ok(bodies && bodies.length >= 2);
  const clientBody = bodies[bodies.length - 1]!;

  // Replay those bytes gzipped against an enforce-mode gate.
  const fx = await fixture();
  const payload = gzipSync(clientBody);
  const { request } = await import("node:http");
  const res = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const req = request(`${fx.proxyUrl}/git/${PROJECT}/git-receive-pack`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`x:${TOKEN}`).toString("base64")}`,
        "content-type": "application/x-git-receive-pack-request",
        "content-encoding": "gzip",
        "content-length": String(payload.length),
      },
    }, resolve);
    req.on("error", reject);
    req.end(payload);
  });
  const chunks: Buffer[] = [];
  for await (const c of res) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  assert.equal(res.statusCode, 200, body);
  assert.ok(body.includes("GoodFolder refused this save"), body);
  assert.ok(body.includes("goodfolder-refusal {"), body);
  assert.ok(fx.audits.some((a) => a.action === "push.refused"), JSON.stringify(fx.audits));
});

test("a service key's include option is ignored", async () => {
  const fx = await fixture();
  const w = mkWork(fx, SERVICE_TOKEN);
  w.write("keep.md", "k\n");
  w.commitAll("base");
  assert.equal((await w.push(["HEAD:main"])).code, 0);
  w.write(".env", "TOKEN=x\n");
  w.commitAll("env");
  const refused = await w.push(["-o", "goodfolder-include=.env", "HEAD:main"]);
  assert.notEqual(refused.code, 0, "service keys cannot opt files in");
  assert.equal(w.upstreamRefs().includes("main"), true);
  // The ref must still point at the clean base — nothing new landed.
  const tip = execFileSync("git", ["-C", fx.upstream.bare, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
  const baseTip = execFileSync("git", ["-C", w.repo, "rev-parse", "HEAD~1"], { encoding: "utf8" }).trim();
  assert.equal(tip, baseTip);
});
