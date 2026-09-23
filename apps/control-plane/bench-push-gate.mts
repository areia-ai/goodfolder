/**
 * Push-gate cost — NOT part of CI.
 *
 *   node --experimental-transform-types apps/control-plane/bench-push-gate.mts [big [sizeMB] | many [count]]
 *
 * Pushes a synthetic first save through the real proxy twice per scenario —
 * once with the gate off (pure streaming) and once in enforce — against a
 * bare repo served by `git http-backend` in a CHILD process
 * (bench-upstream.mts), so the reported RSS/heap/external are the gate
 * process's alone. Scenarios:
 *   big   one ~sizeMB file of random bytes (default 1024)
 *   many  `count` files of 1–4KB in nested folders (default 100000)
 */

import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:http";
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { createGitProxy } from "./src/push-gate/proxy.ts";
import { SlotLimiter } from "./src/push-gate/gate.ts";
import type { RepositoryAdapter, Sql } from "@goodfolder/serverlib";

const execFileAsync = promisify(execFile);
const SCENARIO = process.argv[2] === "many" ? "many" : "big";
const SIZE_MB = Number(process.argv[3]) || 1024;
const FILE_COUNT = Number(process.argv[3]) || 100_000;
const PROJECT = "11111111-1111-1111-1111-111111111111";
const TOKEN = "bench-token";
const tokenHash = (raw: string) => createHash("sha256").update(raw).digest("hex");

const dirs: string[] = [];
const servers: Server[] = [];
const children: ChildProcess[] = [];

function startUpstream(): Promise<{ url: string; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "gf-bench-up-"));
  dirs.push(dir);
  const child = spawn(
    process.execPath,
    ["--experimental-transform-types", fileURLToPath(new URL("./bench-upstream.mts", import.meta.url)), dir],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  children.push(child);
  return new Promise((resolve, reject) => {
    child.stdout!.once("data", (d) => resolve({ url: d.toString().trim(), dir }));
    child.once("exit", (c) => reject(new Error(`upstream child exited ${c}`)));
  });
}

function fakeSql(): Sql {
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ");
    if (text.includes("FROM transfer_tokens"))
      return values.includes(tokenHash(TOKEN))
        ? [{ device_id: "dev-1", project_id: PROJECT, account_id: "acct-1", device_kind: "user" }]
        : [];
    if (text.includes("FROM webhook_endpoints")) return [];
    if (text.includes("FROM devices")) return [{ name: "bench" }];
    return [];
  };
  const sql = query as unknown as Sql;
  sql.json = ((v: unknown) => v) as Sql["json"];
  return sql;
}

function bareRepos(dir: string): RepositoryAdapter {
  const bare = join(dir, `${PROJECT}.git`);
  const g = (args: string[]): string | null => {
    try {
      return execFileSync("git", ["-C", bare, ...args], { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  return {
    head: async () => g(["rev-parse", "--verify", "refs/heads/main"]),
    tree: async (_p: string, ref = "main") =>
      (g(["ls-tree", "-r", ref]) ?? "")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const m = /^(\d+) (blob|tree|commit) ([0-9a-f]{40})\t(.+)$/.exec(l)!;
          return { path: m[4]!, type: m[2]!, sha: m[3]!, size: 0 };
        }),
    readFile: async () => null,
    changeFiles: async () => ({ commitSha: "x" }),
  } as unknown as RepositoryAdapter;
}

async function seedWorkRepo(work: string): Promise<void> {
  execFileSync("git", ["init", "-q", work]);
  execFileSync("git", ["-C", work, "config", "user.email", "b@b"]);
  execFileSync("git", ["-C", work, "config", "user.name", "b"]);
  if (SCENARIO === "big") {
    // Random contents: an honest 1GB pack, no compression shortcut.
    const file = join(work, "big.bin");
    const out = createWriteStream(file);
    for (let i = 0; i < SIZE_MB; i++) {
      if (!out.write(randomBytes(1024 * 1024))) await new Promise((r) => out.once("drain", r));
    }
    await new Promise((r) => out.end(r));
  } else {
    // Many small files in nested folders — the object-count stress case.
    const t0 = Date.now();
    for (let i = 0; i < FILE_COUNT; i++) {
      const sub = join(work, `d${i % 64}`, `s${Math.floor(i / 64) % 64}`);
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, `f${i}.txt`), randomBytes(1024 + (i % 3072)));
    }
    console.log(`seeded ${FILE_COUNT} files in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const t0 = Date.now();
  execFileSync("git", ["-C", work, "add", "-A"]);
  execFileSync("git", ["-C", work, "commit", "-qm", "bench"]);
  console.log(`git add+commit took ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

async function pushOnce(mode: "off" | "enforce"): Promise<{ ms: number; rssMB: number; rssDeltaMB: number; heapMB: number; extMB: number }> {
  const { url: upUrl, dir: upDir } = await startUpstream();
  const spoolDir = mkdtempSync(join(tmpdir(), "gf-bench-spool-"));
  dirs.push(spoolDir);
  const sql = fakeSql();
  const repos = bareRepos(upDir);
  const proxy = createGitProxy({
    sql,
    repos,
    billing: {
      entitlement: async () => ({ canWrite: true, authorizedBytes: null, usageBytes: 0, reservedBytes: 0, reason: null }),
    } as never,
    cfg: {
      giteaInternalUrl: upUrl,
      giteaAdminUser: "gf-service",
      giteaAdminPassword: "pw",
      s3Bucket: "b",
    } as never,
    remoteDeps: {
      sql,
      repos,
      writeAccessError: async () => null,
      refreshUsage: () => {},
      labelFor: async () => ({ label: "x", source: "agent" }),
    } as never,
    writeAccessError: async () => null,
    gate: {
      mode,
      maxBytes: 4 * 1024 * 1024 * 1024,
      spoolDir,
      limiter: new SlotLimiter(4),
    },
  });
  const server = createServer((req, res) => void proxy(req, res));
  servers.push(server);
  const proxyUrl = await new Promise<string>((r) =>
    server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );

  const work = mkdtempSync(join(tmpdir(), "gf-bench-work-"));
  dirs.push(work);
  await seedWorkRepo(work);
  execFileSync("git", ["-C", work, "remote", "add", "gf", `http://x:${TOKEN}@${proxyUrl.slice(7)}/git/${PROJECT}`]);

  // Both modes share this process, so RSS carries the previous run's freed
  // arena. Report the peak AND the growth over this run's own baseline.
  const startRss = process.memoryUsage().rss / 1048576;
  let rssMB = 0;
  let heapMB = 0;
  let extMB = 0;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    rssMB = Math.max(rssMB, m.rss / 1048576);
    heapMB = Math.max(heapMB, m.heapUsed / 1048576);
    extMB = Math.max(extMB, (m.external + (m.arrayBuffers ?? 0)) / 1048576);
  }, 50);
  const t0 = Date.now();
  const { code, stderr } = await execFileAsync(
    "git",
    ["-C", work, "-c", "credential.helper=", "push", "gf", "HEAD:main"],
    { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 64 * 1024 * 1024 },
  ).then(
    (r) => ({ code: 0, stderr: String(r.stderr) }),
    (e) => ({ code: e.code ?? 1, stderr: String(e.stderr ?? "") }),
  );
  clearInterval(sampler);
  const ms = Date.now() - t0;
  if (code !== 0) throw new Error(`push failed in mode=${mode}: ${stderr}`);
  return { ms, rssMB, rssDeltaMB: rssMB - startRss, heapMB, extMB };
}

const fmt = (r: { ms: number; rssMB: number; rssDeltaMB: number; heapMB: number; extMB: number }) =>
  `${(r.ms / 1000).toFixed(1)}s  peak RSS ${r.rssMB.toFixed(0)} MB (+${r.rssDeltaMB.toFixed(0)} over baseline)  heap ${r.heapMB.toFixed(0)} MB  external ${r.extMB.toFixed(0)} MB`;

const only = process.argv[4]; // "off" | "enforce" | undefined (both)
console.log(`scenario: ${SCENARIO === "big" ? `one ~${SIZE_MB}MB file` : `${FILE_COUNT} files of 1-4KB`}`);
const off = only === "enforce" ? null : await pushOnce("off");
if (off) console.log(`off:     ${fmt(off)}`);
const on = only === "off" ? null : await pushOnce("enforce");
if (on) console.log(`enforce: ${fmt(on)}`);
if (off && on)
  console.log(
    `gate adds ${((on.ms - off.ms) / 1000).toFixed(1)}s (${(((on.ms - off.ms) / off.ms) * 100).toFixed(0)}%), ` +
      `peak RSS while checking ${on.rssMB.toFixed(0)} MB`,
  );
for (const s of servers) s.close();
for (const c of children) c.kill();
for (const d of dirs) rmSync(d, { recursive: true, force: true });
process.exit(0);
