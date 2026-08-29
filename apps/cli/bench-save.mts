/**
 * The steady-state save gate: <1 second at 100,000 files.
 *
 * Builds a deterministic corpus, times the first (import) save, then N
 * steady-state rounds of mutate-a-few-files -> full save pipeline. Exits
 * non-zero if any steady-state round exceeds the 1s budget.
 *
 *   node --experimental-transform-types apps/cli/bench-save.mts [options]
 *     --files N       corpus size            (default 100000)
 *     --changed N     files mutated / round  (default 10)
 *     --rounds N      steady-state rounds    (default 7)
 *     --remote URL    push to this remote instead of a local bare repo
 *     --no-push       skip pushes entirely (pure-local numbers)
 *     --keep          keep the temp folder for inspection
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GOODFOLDER_TRACE = "1";

import { git, gitOk, findGitDir } from "./src/git.ts";
import { configureRepo } from "./src/perf.ts";
import { runSavePipeline } from "./src/save-core.ts";
import type { FolderConfig } from "./src/config.ts";

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) || def : def;
}
const FILES = arg("files", 100_000);
const CHANGED = arg("changed", 10);
const ROUNDS = arg("rounds", 7);
const REMOTE = (() => {
  const i = process.argv.indexOf("--remote");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const NO_PUSH = process.argv.includes("--no-push");
const KEEP = process.argv.includes("--keep");

const DIRS = Math.max(1, Math.ceil(FILES / 500)); // ~500 files per dir
const PER_DIR = Math.ceil(FILES / DIRS);
const BUDGET_MS = 1000;

const fmt = (n: number): string => n.toLocaleString("en-US");
const ms = (n: number): string => `${n.toFixed(0)}ms`;

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)]!;
}

// ---------------------------------------------------------------------------
console.log(`building ${fmt(FILES)}-file corpus…`);
const root = mkdtempSync(join(tmpdir(), "gf-bench-"));
const folder = join(root, "folder");
mkdirSync(folder);

if (!gitOk(folder, ["init", "-b", "main"])) throw new Error("git init failed");
git(folder, ["config", "user.email", "bench@goodfolder"]);
git(folder, ["config", "user.name", "bench"]);
configureRepo(folder);

let originPath: string | undefined;
if (!REMOTE && !NO_PUSH) {
  originPath = join(root, "origin.git");
  mkdirSync(originPath, { recursive: true });
  if (!gitOk(originPath, ["init", "--bare", "-b", "main"])) {
    throw new Error("bare init failed");
  }
}
const remoteUrl = REMOTE ?? originPath;
if (remoteUrl) git(folder, ["remote", "add", "origin", remoteUrl]);

const body =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.\n".repeat(
    16,
  );
let written = 0;
for (let d = 0; d < DIRS; d++) {
  const dir = join(folder, `area${String(d).padStart(3, "0")}`);
  mkdirSync(dir);
  const n = Math.min(PER_DIR, FILES - written);
  for (let f = 0; f < n; f++) {
    writeFileSync(join(dir, `doc-${String(f).padStart(4, "0")}.txt`), `#${written}\n${body}`);
    written++;
  }
  if ((d + 1) % 50 === 0) console.log(`  wrote ${fmt(written)} files`);
}
console.log(`corpus ready at ${folder}`);

const cfg: FolderConfig = {
  projectId: "bench",
  apiUrl: "",
  token: "",
  connectedAt: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
console.log("\n— import (first save) —");
{
  const t0 = performance.now();
  await runSavePipeline(folder, cfg, { skipPush: true });
  const importMs = performance.now() - t0;
  console.log(`import total: ${ms(importMs)} (no budget — informational)`);
}

if (remoteUrl && !NO_PUSH) {
  const t0 = performance.now();
  const r = git(folder, ["push", "-u", "origin", "main"]);
  const pushMs = performance.now() - t0;
  if (r.code !== 0) throw new Error(`initial push failed: ${r.stderr}`);
  console.log(`initial push: ${ms(pushMs)} (establishes origin/main)`);
}

// ---------------------------------------------------------------------------
console.log(`\n— steady state: ${CHANGED} files changed, ${ROUNDS} rounds —`);
const localTotals: number[] = [];
const pushTimes: number[] = [];
let allPass = true;
for (let round = 1; round <= ROUNDS; round++) {
  // mutate CHANGED files spread across different areas
  for (let k = 0; k < CHANGED; k++) {
    const idx = (round * CHANGED * 7 + k * 977) % FILES;
    const d = Math.floor(idx / PER_DIR);
    const f = idx % PER_DIR;
    writeFileSync(
      join(folder, `area${String(d).padStart(3, "0")}`, `doc-${String(f).padStart(4, "0")}.txt`),
      `#round${round} ${body}`,
    );
  }
  const t0 = performance.now();
  const out = await runSavePipeline(folder, cfg, { skipPush: NO_PUSH });
  const total = performance.now() - t0;
  // The gate measures LOCAL save cost (scan→gate→stage→label→commit).
  // Push is network transport — reported separately, per TECHNICAL_PROPOSAL.
  const pushMs = out.timings.push ?? 0;
  const localMs = total - pushMs;
  localTotals.push(localMs);
  if (!NO_PUSH) pushTimes.push(pushMs);
  const verdict = localMs <= BUDGET_MS ? "PASS" : "FAIL";
  if (localMs > BUDGET_MS) allPass = false;
  console.log(
    `round ${round}: local ${ms(localMs)}${NO_PUSH ? "" : ` · push ${ms(pushMs)}`} · ${verdict}`,
  );
}

localTotals.sort((a, b) => a - b);
const worst = localTotals[localTotals.length - 1]!;
const median = percentile(localTotals, 50);
const p95 = percentile(localTotals, 95);
console.log("\n— results —");
console.log(
  `LOCAL save: median ${ms(median)} · p95 ${ms(p95)} · worst ${ms(worst)} · budget ${BUDGET_MS}ms`,
);
if (pushTimes.length) {
  const sortedPush = [...pushTimes].sort((a, b) => a - b);
  console.log(
    `push (transport): median ${ms(percentile(sortedPush, 50))} · worst ${ms(sortedPush[sortedPush.length - 1]!)} — informational`,
  );
}
console.log(allPass ? "\nGATE: PASS" : "\nGATE: FAIL");

if (!KEEP) {
  // The fsmonitor daemon holds files open inside .git — stop it before rm.
  git(folder, ["fsmonitor--daemon", "stop"]);
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
} else console.log(`kept: ${root}`);

process.exit(allPass ? 0 : 1);
