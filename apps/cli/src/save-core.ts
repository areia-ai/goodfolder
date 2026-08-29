import { appendFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  fallbackLabel,
  findCaseCollisions,
  LABEL_EXCERPT_CHAR_BUDGET,
  routeFile,
  type AiLabelContext,
  type SaveCounts,
} from "@goodfolder/shared";
import type { FolderConfig } from "./config.ts";
import { CliError } from "./cli-error.ts";
import { git, gitOk, gitStream, gitAsync, findGitDir } from "./git.ts";
import { trace, traceSync, renderTrace, snapshotMarks } from "./perf.ts";
import type { GitResult } from "./git.ts";

interface ChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
  all: string[];
}

/** Parse `status --porcelain` into a change set (paths relative to root). */
function scanChanges(folder: string): ChangeSet {
  // -uall: enumerate every untracked FILE. Default mode collapses whole
  // directories into one entry, which would corrupt change counts, the
  // timeline path list, and case-gate coverage during imports.
  const r = git(folder, ["status", "--porcelain", "-z", "-uall"]);
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const all: string[] = [];
  const entries = r.stdout.split("\0").filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const xy = entry.slice(0, 2);
    let path = entry.slice(3);
    // renames/copies in -z mode: "R  new-path\0old-path\0" — the paired
    // old-name field must be consumed, and the NEW path (already parsed
    // above) is the one we track going forward.
    if (xy.includes("R") || xy.includes("C")) {
      i++;
    }
    if (path.startsWith('"')) continue; // odd quoting; skip rather than mis-handle
    all.push(path);
    if (xy.includes("D") && !xy.includes("?")) deleted.push(path);
    else if (xy.includes("A") || xy.includes("?")) added.push(path);
    else modified.push(path);
  }
  return { added, modified, deleted, all };
}

function hasHead(folder: string): boolean {
  return gitOk(folder, ["rev-parse", "-q", "--verify", "HEAD"]);
}

/**
 * THE CASE GATE — a colliding pair must never enter history.
 * Runs against everything that will be committed: changed paths plus all
 * currently-tracked ones (a collision can involve an untouched file).
 */
async function enforceCaseGate(
  folder: string,
  changes: ChangeSet,
  trackedPromise: Promise<GitResult>,
): Promise<void> {
  const tracked = (await trackedPromise).stdout.split("\n").filter(Boolean);
  const collisions = findCaseCollisions([...new Set([...changes.all, ...tracked])]);
  if (collisions.length === 0) return;
  console.error("✗ This save was refused.\n");
  console.error(
    "Two files differ only by capitalization, which would silently overwrite",
  );
  console.error("one of them on Windows or macOS:");
  for (const c of collisions.slice(0, 10)) {
    console.error(`   • ${c.a}  ↔  ${c.b}`);
  }
  throw new CliError("\nRename one of them, then save again.", 1);
}

/** Ensure every LFS-routed path has an exact entry in .gitattributes. */
function applyRouting(folder: string, paths: string[]): void {
  const attrPath = join(folder, ".gitattributes");
  let existing = "";
  try {
    existing = readFileSync(attrPath, "utf8");
  } catch {
    /* no attributes yet */
  }
  const lines = new Set(existing.split("\n").map((l) => l.trim()));
  let dirty = false;
  for (const p of paths) {
    let size = 0;
    try {
      size = statSync(join(folder, p)).size;
    } catch {
      continue; // deleted
    }
    if (routeFile(p, size).target !== "lfs") continue;
    const entry = `${p.includes(" ") ? `"${p}"` : p} filter=lfs diff=lfs merge=lfs -text`;
    if (!lines.has(entry)) {
      lines.add(entry);
      dirty = true;
    }
  }
  if (dirty) {
    const header = existing.includes("# goodfolder-managed")
      ? ""
      : "# goodfolder-managed large-file routing\n";
    appendFileSync(
      attrPath,
      (existing.endsWith("\n") || existing === "" ? "" : "\n") +
        header +
        [...lines].filter((l) => l && !existing.split("\n").includes(l)).join("\n") +
        "\n",
    );
  }
}

/** Bounded label context: stats + capped text excerpt, media names only. */
function buildAiContext(folder: string, changes: ChangeSet): AiLabelContext | null {
  const diff = git(folder, ["diff", "--cached"]);
  const mediaPaths = new Set<string>();
  for (const p of [...changes.added, ...changes.modified]) {
    try {
      if (routeFile(p, statSync(join(folder, p)).size).target === "lfs") mediaPaths.add(p);
    } catch {}
  }
  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  for (const line of diff.stdout.split("\n")) {
    if (
      line.startsWith("Binary files") ||
      /^GIT binary patch/.test(line)
    ) {
      continue; // binary content never leaves the machine
    }
    if (used + line.length + 1 > LABEL_EXCERPT_CHAR_BUDGET) {
      truncated = true;
      break;
    }
    parts.push(line);
    used += line.length + 1;
  }
  if (!changes.all.length) return null;
  const mediaNote =
    mediaPaths.size > 0
      ? ` Media files (contents not shown): ${[...mediaPaths]
          .slice(0, 20)
          .map((p) => {
            try {
              return `${p} (${Math.round(statSync(join(folder, p)).size / 1024)} KB)`;
            } catch {
              return p;
            }
          })
          .join(", ")}.`
      : "";
  return {
    summary: `${changes.added.length} added, ${changes.modified.length} modified, ${changes.deleted.length} removed.${mediaNote}`,
    excerpt: parts.join("\n"),
    truncated,
  };
}

const fmt = (n: number): string => n.toLocaleString("en-US");

const NOISE_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/**
 * The handful of paths that matter most, for receipts and cards:
 * edits to existing work answer "what did it touch" loudest, then brand-new
 * files, then removals. Noise files never surface.
 */
function pickTopPaths(changes: ChangeSet, limit = 8): string[] {
  const clean = (list: string[]) =>
    list.filter((p) => !NOISE_FILES.has(p.split(/[\\/]/).pop() ?? ""));
  const ordered = [...clean(changes.modified), ...clean(changes.added), ...clean(changes.deleted)];
  return [...new Set(ordered)].slice(0, limit);
}

/**
 * Render git's --progress fragments as one calm line:
 *   Importing your folder… 45% (45,012 / 100,000 files)
 * Falls back to raw counter when git gives no percentage.
 *
 * Raw stdout writes are TTY-only: in captured contexts (MCP stdio is the
 * protocol channel!) they would corrupt the stream mid-response.
 */
function renderImportProgress(fragment: string): void {
  if (!process.stdout.isTTY) return;
  const pct = /(\d+)%/.exec(fragment);
  const nums = /(\d[\d,]*)\s*\/\s*(\d[\d,]*)/.exec(fragment.replace(/,/g, ""));
  let line: string;
  if (pct?.[1] && nums?.[1] && nums[2]) {
    line = `Importing your folder… ${pct[1]}% (${fmt(Number(nums[1].replace(/,/g, "")))} / ${fmt(Number(nums[2].replace(/,/g, "")))} files)`;
  } else if (nums?.[1] && nums[2]) {
    line = `Importing your folder… ${fmt(Number(nums[1].replace(/,/g, "")))} / ${fmt(Number(nums[2].replace(/,/g, "")))} files`;
  } else if (pct?.[1]) {
    line = `Importing your folder… ${pct[1]}%`;
  } else {
    return; // noise fragments stay invisible
  }
  process.stdout.write(`\r\x1b[2K${line}`);
}

export interface SaveOutcome {
  sha: string;
  changedCount: number;
  wasImport: boolean;
  seq: number | undefined;
  label: string;
  truncated: boolean;
  pushSkipped: boolean;
  /** Stage name → milliseconds, for budgets and diagnostics. */
  timings: Record<string, number>;
  counts: SaveCounts;
  topPaths: string[];
}

export interface SaveRecorder {
  (input: {
    changedPaths: string[];
    commitSha: string;
    label?: string;
    ai?: AiLabelContext;
    counts: SaveCounts;
    topPaths: string[];
  }): Promise<{ seq?: number; label?: string }>;
}

export interface SavePipelineOpts {
  message?: string | undefined;
  /** Skip the network push (bench harness); production always pushes. */
  skipPush?: boolean;
  /** Timeline recorder; omit in offline harnesses. */
  recorder?: SaveRecorder | undefined;
  /** MCP client name ("claude-code"); absent when a person runs the command. */
  harness?: string | undefined;
}

/**
 * The whole save pipeline, minus transport concerns. Used by cmdSave (with
 * the real API recorder) and by the performance harness (without).
 */
export async function runSavePipeline(
  folder: string,
  cfg: FolderConfig,
  opts: SavePipelineOpts = {},
): Promise<SaveOutcome> {
  const gitDir = findGitDir(folder);
  if (!gitDir) throw new CliError("✗ This folder is not connected.", 1);

  const wasImport = !traceSync("head-check", () => hasHead(folder));

  // ---- change detection (case-gate input read runs concurrently) ---------
  const trackedPromise = gitAsync(folder, ["ls-files"]);
  const changes = traceSync("scan", () => scanChanges(folder));
  if (wasImport) {
    console.log(
      "First save on this folder — bringing everything into GoodFolder.",
    );
    console.log("Large folders take a moment; you can keep working meanwhile.");
  } else if (changes.all.length === 0) {
    void trackedPromise; // drain
    console.log("Nothing new to save — your folder matches the last save.");
    const nothing: SaveOutcome = { sha: "", changedCount: 0, wasImport: false, seq: undefined, label: "", truncated: false, pushSkipped: opts.skipPush ?? false, timings: {}, counts: { added: 0, changed: 0, removed: 0 }, topPaths: [] };
    return nothing;
  }
  if (wasImport && changes.all.length === 0) {
    // Empty folder's first save: there is nothing to checkpoint yet, and
    // saying so beats a failed command.
    void trackedPromise;
    console.log("Connected. The folder is empty right now — anything you add and save is protected from then on.");
    const empty: SaveOutcome = { sha: "", changedCount: 0, wasImport: true, seq: undefined, label: "", truncated: false, pushSkipped: opts.skipPush ?? false, timings: {}, counts: { added: 0, changed: 0, removed: 0 }, topPaths: [] };
    return empty;
  }

  // ---- routing MUST come before staging --------------------------------
  // Git applies the large-file filter when a path is staged, reading the
  // attributes as they are at that moment. Writing .gitattributes afterwards
  // did nothing for the files in this save: they went into the folder's
  // history as whole copies, and the attribute only took effect for some
  // later save. Sizes come from the working tree, so this needs nothing
  // staged.
  traceSync("routing", () =>
    applyRouting(folder, [...changes.added, ...changes.modified]),
  );

  // ---- stage (import streams per-file progress; steady state is quick) ----
  let interrupted = false;
  const staged = await trace("stage", async () => {
    if (!wasImport) {
      const ok = gitOk(folder, ["add", "-A"]);
      if (!ok) throw new CliError("✗ Could not prepare your changes.", 1);
      return;
    }
    // Import: `add --verbose` emits one line per path — exact progress
    // against the change set we already counted. (--progress isn't an add
    // option, and git hides native progress without a TTY.)
    let seen = 0;
    const total = Math.max(1, changes.all.length);
    const tick = () => {
      seen++;
      if (seen % 200 === 0 || seen === total) {
        renderImportProgress(`${seen} / ${total} files`);
      }
    };
    const { done, kill } = gitStream(folder, ["add", "-A", "--verbose"], () => tick());
    const sigint = () => {
      interrupted = true;
      kill();
    };
    process.on("SIGINT", sigint);
    try {
      const r = await done;
      if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
      if (interrupted || r.code !== 0) {
        if (interrupted) {
          throw new CliError(
            "\nImport paused — nothing is lost. Run goodfolder save again to pick up where it left off.",
            130,
          );
        }
        throw new CliError(`✗ Could not prepare your changes: ${r.stderr.trim()}`, 1);
      }
    } finally {
      process.off("SIGINT", sigint);
    }
  });
  void staged;

  // ---- gates + metadata ---------------------------------------------------
  await trace("case-gate", () => enforceCaseGate(folder, changes, trackedPromise));

  const ai =
    opts.recorder
      ? traceSync("label-context", () => buildAiContext(folder, changes))
      : null;

  // ---- commit -------------------------------------------------------------
  const commitMsg = opts.message ?? (wasImport ? "First save" : "Save");
  const commit = await trace("commit", async () => {
    const r = git(folder, ["commit", "-m", commitMsg]);
    if (r.code !== 0) throw new CliError("✗ Could not save right now.", 1);
    return git(folder, ["rev-parse", "HEAD"]).stdout.trim();
  });

  // ---- push ----------------------------------------------------------------
  let pushSkipped = opts.skipPush ?? false;
  if (!pushSkipped) {
    await trace("push", async () => {
      const push = git(folder, ["push", "origin", "main"]);
      if (push.code !== 0) {
        if (/non-fast-forward|rejected/i.test(push.stderr)) {
          throw new CliError("✗ Another device saved first. Run: goodfolder sync");
        }
        throw new CliError(`✗ Could not reach GoodFolder: ${push.stderr.trim()}`);
      }
    });
  }

  // ---- timeline (never blocks the checkpoint) ------------------------------
  let label = commitMsg;
  let seq: number | undefined;
  let truncated = false;
  if (opts.recorder) {
    try {
      const input: Parameters<SaveRecorder>[0] = {
        changedPaths: changes.all,
        commitSha: commit,
        counts: {
          added: changes.added.length,
          changed: changes.modified.length,
          removed: changes.deleted.length,
        },
        topPaths: pickTopPaths(changes),
      };
      if (opts.message) input.label = opts.message;
      if (ai) input.ai = ai;
      const res = await opts.recorder(input);
      seq = res.seq;
      label = res.label ?? label;
    } catch (e) {
      console.warn(
        `⚠ Saved locally and uploaded, but the timeline update failed (${(e as Error).message}).`,
      );
    }
  }
  truncated = ai?.truncated ?? false;

  // ---- confirmation --------------------------------------------------------
  const counts: SaveCounts = {
    added: changes.added.length,
    changed: changes.modified.length,
    removed: changes.deleted.length,
  };
  if (wasImport) {
    console.log(`✓ Imported and safe — ${fmt(changes.all.length)} files are now protected.`);
  } else {
    const what =
      counts.added + counts.removed > 0
        ? `${counts.added} added · ${counts.changed} changed · ${counts.removed} removed`
        : `${counts.changed} file${counts.changed === 1 ? "" : "s"} updated`;
    console.log(`✓ Saved${seq !== undefined ? ` #${seq}` : ""}`);
    console.log(`  ${what}`);
  }
  console.log(`  ${label}`);
  if (truncated) console.log("  (large change — the label saw a partial preview)");
  const timings: Record<string, number> = {};
  for (const [name, ms] of snapshotMarks()) {
    timings[name] = (timings[name] ?? 0) + ms;
  }
  const tr = renderTrace();
  if (tr) console.log(tr);

  const outcome: SaveOutcome = { sha: commit, changedCount: changes.all.length, wasImport, seq, label, truncated, pushSkipped, timings, counts, topPaths: pickTopPaths(changes) };
  return outcome;
}
