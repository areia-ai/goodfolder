import { createInterface } from "node:readline/promises";
import { friendlyHarness, type SaveCounts } from "@goodfolder/shared";
import { CliError } from "./cli-error.ts";
import { requireConnection } from "./connect.ts";
import { git, gitOk } from "./git.ts";
import { listSaves, recordSave, type TimelineEntry } from "./api.ts";
import { GF_REMOTE, pushCurrentHistory } from "./repo-setup.ts";

export interface UndoOptions {
  /** Skip the interactive preview and undo the single most recent save. */
  yes?: boolean;
  /** Undo the whole contiguous run of same-agent saves at the top. */
  session?: boolean;
  /** Print what undo would do and stop (the MCP unconfirmed path). */
  previewOnly?: boolean;
  /** MCP client name, for the receipt on the new save. */
  harness?: string | undefined;
}

// Files that are never worth blocking an undo over — same set the save
// pipeline refuses to surface in receipts.
const NOISE_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/**
 * How many of the most-recent saves form one uninterrupted run by the same
 * agent. Returns 1 when the last save stands alone or a person made it.
 * Never returns the whole timeline — undo must leave an earlier state to
 * return to.
 */
export function detectAgentRun(saves: Pick<TimelineEntry, "harness">[]): number {
  const top = saves[0]?.harness;
  if (!top || saves.length < 2) return 1;
  let n = 1;
  while (n < saves.length - 1 && saves[n]?.harness === top) n++;
  return n;
}

/** Split `git diff --name-status` output into paths and add/change/remove counts. */
export function parseNameStatus(out: string): { paths: string[]; counts: SaveCounts } {
  let added = 0;
  let changed = 0;
  let removed = 0;
  const paths: string[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.lastIndexOf("\t");
    if (tab < 0) continue;
    const code = line[0]!;
    paths.push(line.slice(tab + 1));
    if (code === "A") added++;
    else if (code === "D") removed++;
    else changed++;
  }
  return { paths, counts: { added, changed, removed } };
}

/**
 * Plain-language description of what reversing a set of changes does, read
 * from the ORIGINAL `git diff --name-status <before> <after>`: a file added
 * then is removed now, a file deleted then comes back, everything else is a
 * rolled-back change.
 */
export function summarizeReverseEffect(nameStatus: string): string {
  let back = 0;
  let remove = 0;
  let roll = 0;
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const code = line[0];
    if (code === "A") remove++;
    else if (code === "D") back++;
    else roll++;
  }
  const parts: string[] = [];
  if (back) parts.push(`brings back ${back} file${back === 1 ? "" : "s"}`);
  if (remove) {
    parts.push(
      `removes ${remove} file${remove === 1 ? "" : "s"} that ${remove === 1 ? "was" : "were"} added`,
    );
  }
  if (roll) parts.push(`rolls back ${roll} change${roll === 1 ? "" : "s"}`);
  if (parts.length === 0) {
    return "It changes nothing — your folder already matches that state.";
  }
  if (parts.length === 1) return `It ${parts[0]}.`;
  return `It ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
}

const clip = (s: string, n = 90): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The label the undo save carries in the timeline. */
export function buildUndoLabel(scope: TimelineEntry[], harnessName: string | null): string {
  if (scope.length === 1) {
    return clip(`Undid save #${scope[0]!.seq} — ${scope[0]!.label}`, 110);
  }
  const who = harnessName ? ` from ${harnessName}` : "";
  return `Undid ${scope.length} saves${who} (#${scope[scope.length - 1]!.seq}–#${scope[0]!.seq})`;
}

/** The preview shown before undo acts. */
export function buildPreview(input: {
  scope: TimelineEntry[];
  harnessName: string | null;
  effect: string;
  runLen: number;
}): string {
  const { scope, harnessName, effect, runLen } = input;
  const lines: string[] = [];
  if (scope.length === 1) {
    const who = harnessName ? `${harnessName}'s last save` : "the last save";
    lines.push(
      `This undoes ${who} (#${scope[0]!.seq})${scope[0]!.label ? `: “${clip(scope[0]!.label)}”` : ""}.`,
    );
  } else {
    const who = harnessName ? ` from ${harnessName}` : "";
    lines.push(
      `This undoes the ${scope.length} most recent saves${who} (#${scope[scope.length - 1]!.seq} through #${scope[0]!.seq}).`,
    );
  }
  lines.push(effect);
  lines.push(
    scope.length === 1
      ? "The undone save stays visible in your timeline."
      : "The undone saves stay visible in your timeline.",
  );
  if (scope.length === 1 && runLen >= 2) {
    lines.push("");
    lines.push(
      `The ${runLen} most recent saves are all ${harnessName ? `from ${harnessName}` : "part of one run"}.`,
    );
  }
  return lines.join("\n");
}

function meaningfulUnsaved(folder: string): string[] {
  const out = git(folder, ["status", "--porcelain", "-uall"]).stdout;
  const paths: string[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const path = line.slice(3).split(" -> ").pop() ?? "";
    const base = path.split(/[\\/]/).pop() ?? "";
    if (!NOISE_FILES.has(base)) paths.push(path);
  }
  return paths;
}

function ensureObjects(folder: string, sha: string): void {
  if (gitOk(folder, ["cat-file", "-e", `${sha}^{commit}`])) return;
  console.log("Getting that save's contents…");
  git(folder, ["fetch", GF_REMOTE]);
  if (!gitOk(folder, ["cat-file", "-e", `${sha}^{commit}`])) {
    throw new CliError(
      "✗ Could not download that save's contents. Check your connection.",
      1,
    );
  }
}

async function confirm(question: string, choices: string[], fallback: string): Promise<string> {
  if (!process.stdin.isTTY) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} `)).trim().toLowerCase();
    return choices.find((c) => c === answer) ?? fallback;
  } finally {
    rl.close();
  }
}

export async function cmdUndo(folder: string, opts: UndoOptions = {}): Promise<void> {
  const { cfg } = requireConnection(folder);
  const saves = await listSaves(cfg);

  if (saves.length === 0) {
    console.log("No saves yet — there's nothing to undo.");
    return;
  }
  if (saves.length === 1) {
    console.log("This is your only save. There's no earlier state to go back to.");
    console.log("You can still look through it with: goodfolder log");
    return;
  }

  const last = saves[0]!;
  if (!last.commit_sha) {
    throw new CliError("✗ Could not read your timeline. Try again in a moment.", 1);
  }
  const harnessName = friendlyHarness(last.harness ?? null);
  const runLen = detectAgentRun(saves);

  // Resolve the scope: one save, or the same-agent run.
  const wantRun = opts.session === true;
  if (wantRun && runLen < 2) {
    console.log("The last save isn't part of a same-agent run — undoing just that one.");
  }
  const effectiveLen = wantRun && runLen >= 2 ? runLen : 1;
  const scope = saves.slice(0, effectiveLen);
  const target = saves[effectiveLen]!; // always exists: a run never covers the whole timeline

  const effect = summarizeReverseEffect(
    git(folder, ["diff", "--name-status", target.commit_sha, last.commit_sha]).stdout,
  );

  const preview = buildPreview({ scope, harnessName, effect, runLen });
  console.log(preview);

  if (opts.previewOnly) {
    console.log("");
    console.log("Run this again to confirm the undo.");
    return;
  }

  // Decide whether to proceed, and at what scope.
  let proceedScope = scope;
  let proceedTarget = target;
  if (!opts.yes && !wantRun) {
    if (!process.stdin.isTTY) {
      console.log("");
      console.log(
        runLen >= 2
          ? "Re-run with --yes to undo this save, or --session to undo the whole run."
          : "Re-run with --yes to undo this save.",
      );
      return;
    }
    if (runLen >= 2) {
      const pick = await confirm(
        `Undo one save (o), the whole run of ${runLen} (r), or cancel (c)?`,
        ["o", "r", "c"],
        "c",
      );
      if (pick === "c") {
        console.log("Nothing changed.");
        return;
      }
      if (pick === "r") {
        proceedScope = saves.slice(0, runLen);
        proceedTarget = saves[runLen]!;
        console.log(`Undoing ${runLen} saves (#${proceedScope[proceedScope.length - 1]!.seq}–#${proceedScope[0]!.seq}).`);
      }
    } else {
      const pick = await confirm("Undo this save? (y/N)", ["y", "n"], "n");
      if (pick !== "y") {
        console.log("Nothing changed.");
        return;
      }
    }
  }

  // Undo acts only on what the timeline shows — a dirty folder is ambiguous.
  const unsaved = meaningfulUnsaved(folder);
  if (unsaved.length > 0) {
    throw new CliError(
      `✗ You have unsaved changes (${unsaved.slice(0, 3).join(", ")}${unsaved.length > 3 ? `, +${unsaved.length - 3} more` : ""}).\n` +
        "  Save them first:  goodfolder save\n" +
        "  Then run:  goodfolder undo",
      1,
    );
  }

  ensureObjects(folder, proceedTarget.commit_sha);

  // Materialize the tracked tree at the target save, then drop files that
  // were added afterwards (restore --source leaves them behind).
  if (!gitOk(folder, ["restore", "--source", proceedTarget.commit_sha, "--worktree", "--staged", "."])) {
    throw new CliError("✗ Could not undo right now — your folder is untouched.", 1);
  }
  const targetFiles = new Set(
    git(folder, ["ls-tree", "-r", "--name-only", proceedTarget.commit_sha]).stdout
      .split("\n")
      .filter(Boolean),
  );
  for (const f of git(folder, ["ls-files"]).stdout.split("\n").filter(Boolean)) {
    if (!targetFiles.has(f)) git(folder, ["rm", "-q", "--cached", f]);
  }

  const label = buildUndoLabel(proceedScope, harnessName);
  if (!gitOk(folder, ["commit", "-m", label])) {
    console.log("Your folder already matches that state — nothing to undo.");
    return;
  }
  const sha = git(folder, ["rev-parse", "HEAD"]).stdout.trim();

  const push = pushCurrentHistory(folder);
  if (push.code !== 0) {
    if (/non-fast-forward|rejected/i.test(push.stderr)) {
      throw new CliError(
        "✗ Another device saved first. Run:  goodfolder sync\n  then undo again.",
        1,
      );
    }
    throw new CliError("✗ Undone here, but the upload failed. Run:  goodfolder sync", 1);
  }

  const changed = parseNameStatus(
    git(folder, ["diff", "--name-status", "HEAD^", "HEAD"]).stdout,
  );
  try {
    await recordSave(cfg, {
      label,
      changedPaths: changed.paths,
      commitSha: sha,
      counts: changed.counts,
      topPaths: changed.paths.slice(0, 8),
      harness: opts.harness ?? null,
    });
  } catch {
    /* the undo itself is saved and uploaded regardless */
  }

  console.log(
    proceedScope.length === 1
      ? `✓ Undone. Your folder is back to how it was before save #${proceedScope[0]!.seq}.`
      : `✓ Undone. Your folder is back to how it was before those ${proceedScope.length} saves.`,
  );
  console.log(`  Changed your mind? Run goodfolder undo again, or:  goodfolder restore ${proceedTarget.seq}`);
}
