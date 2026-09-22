import { readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  IGNORE_FILE,
  ignoreRuleFor,
  parseIgnoreFile,
  validateIgnorePattern,
} from "@goodfolder/shared";
import { CliError } from "./cli-error.ts";
import { requireTerminalToConfirm } from "./confirm.ts";
import { loadConfig } from "./config.ts";
import { applySkipRules } from "./skip.ts";
import { findGitDir, git } from "./git.ts";

/**
 * `goodfolder ignore` — the folder's own leave-out list.
 *
 * `.goodfolderignore` sits in the folder itself, so it syncs to every device
 * like any other file. These commands are its editor: they check each line
 * can actually be used, write the file, and re-apply the rules so the next
 * save honours them. Adding a pattern never takes anything out of saves
 * already made — `--remove` on `add` stops protecting the copies already
 * saved, and even that leaves the files on this computer alone.
 */

const HEADER = "# What this folder leaves out — one pattern per line. The only wildcard is *.";

function ignoreFilePath(folder: string): string {
  return join(folder, IGNORE_FILE);
}

function readRaw(folder: string): string {
  try {
    return readFileSync(ignoreFilePath(folder), "utf8");
  } catch {
    return "";
  }
}

/** Not-yet-saved files the given patterns leave out right now. */
function unsavedLeftOut(folder: string, patterns: readonly string[]): string[] {
  if (patterns.length === 0) return [];
  const r = git(folder, ["ls-files", "-o", "-i", "--exclude-standard", "-z"]);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\0")
    .filter((p) => p && ignoreRuleFor(p, patterns) !== null);
}

/** Files already in the folder's history that the patterns would leave out. */
function alreadySavedMatches(folder: string, patterns: readonly string[]): string[] {
  if (patterns.length === 0) return [];
  const r = git(folder, ["ls-files", "-c", "-i", "--exclude-standard", "-z"]);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\0")
    .filter((p) => p && ignoreRuleFor(p, patterns) !== null);
}

/**
 * These commands never touch the network, so they ask only that the folder
 * is connected — no credential refresh on the way.
 */
function requireConnectedFolder(folder: string): string {
  const gitDir = findGitDir(folder);
  if (!gitDir || !loadConfig(gitDir)) {
    throw new CliError(
      "✗ This folder isn't connected to GoodFolder yet. Run:\n    goodfolder connect",
      1,
    );
  }
  return gitDir;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

async function ignoreAdd(
  folder: string,
  patterns: string[],
  opts: { remove: boolean; yes: boolean },
): Promise<void> {
  const gitDir = requireConnectedFolder(folder);
  if (patterns.length === 0) {
    throw new CliError("Add what? e.g.: goodfolder ignore add \"*.mov\"", 1);
  }
  const errors: string[] = [];
  for (const p of patterns) {
    const reason = validateIgnorePattern(p);
    if (reason !== null) errors.push(`  "${p}" ${reason}`);
  }
  if (errors.length > 0) {
    throw new CliError(`✗ ${errors.length === 1 ? "That pattern" : "Those patterns"} can't be used:\n${errors.join("\n")}`, 1);
  }

  const raw = readRaw(folder);
  const parsed = parseIgnoreFile(raw);
  const known = new Set(parsed.patterns);
  const fresh = patterns.filter((p) => !known.has(p));
  if (fresh.length > 0) {
    const base = raw.length
      ? raw.endsWith("\n") ? raw : `${raw}\n`
      : `${HEADER}\n`;
    writeFileSync(ignoreFilePath(folder), base + fresh.join("\n") + "\n");
  } else {
    console.log("Already on the list — nothing to add.");
  }
  applySkipRules(folder, gitDir);

  const leftOut = unsavedLeftOut(folder, fresh.length ? fresh : patterns);
  const nowList = fresh.length ? fresh : patterns;
  for (const p of nowList) {
    if (fresh.includes(p)) console.log(`✓ ${p} added to ${IGNORE_FILE}`);
  }
  if (leftOut.length > 0) {
    console.log(
      `That leaves out ${leftOut.length} file${leftOut.length === 1 ? "" : "s"} that had not been saved yet.`,
    );
  }

  const saved = alreadySavedMatches(folder, nowList);
  if (opts.remove) {
    if (saved.length === 0) return;
    console.log(`\nAlready saved, matching ${nowList.join(", ")}:`);
    for (const path of saved.slice(0, 20)) console.log(`  • ${path}`);
    if (saved.length > 20) console.log(`  …and ${saved.length - 20} more`);
    console.log(
      "\nThey will be left out of this folder's future saves, and your other",
    );
    console.log("devices follow on their next sync after your next save.");
    console.log("This does NOT take them out of earlier saves, and the files");
    console.log("stay on this computer.");
    if (!opts.yes) {
      requireTerminalToConfirm(`goodfolder ignore add ${nowList.map((p) => JSON.stringify(p)).join(" ")} --remove --yes`);
    }
    const ok =
      opts.yes ||
      (await confirm(`Stop protecting ${saved.length} saved file${saved.length === 1 ? "" : "s"}? (y/N) `));
    if (!ok) {
      console.log("Nothing was taken out of the saves.");
      return;
    }
    const r = git(folder, ["rm", "--cached", "-q", "--", ...saved]);
    if (r.code !== 0) {
      throw new CliError(`✗ Could not update the folder's records: ${r.stderr.trim()}`, 1);
    }
    console.log(
      `✓ ${saved.length} file${saved.length === 1 ? "" : "s"} will be left out from the next save on. Run goodfolder save to finish.`,
    );
    return;
  }
  if (saved.length > 0) {
    console.log(
      `\n${saved.length} file${saved.length === 1 ? "" : "s"} matching ${nowList.join(", ")} ${saved.length === 1 ? "is" : "are"} already saved and will keep being saved.`,
    );
    console.log(
      `To take ${saved.length === 1 ? "it" : "them"} off every device, run: goodfolder ignore add ${nowList.join(" ")} --remove`,
    );
  }
}

async function ignoreList(folder: string): Promise<void> {
  requireConnectedFolder(folder);
  if (!existsSync(ignoreFilePath(folder))) {
    console.log(`No ${IGNORE_FILE} yet. To start one: goodfolder ignore add <pattern>`);
    return;
  }
  const parsed = parseIgnoreFile(readRaw(folder));
  if (parsed.patterns.length === 0 && parsed.invalid.length === 0) {
    console.log(`${IGNORE_FILE} is empty.`);
    return;
  }
  const all = git(folder, ["ls-files", "-o", "-i", "--exclude-standard", "-z"]);
  const ignored = all.code === 0 ? all.stdout.split("\0").filter(Boolean) : [];
  for (const pattern of parsed.patterns) {
    const count = ignored.filter((p) => ignoreRuleFor(p, parsed.patterns) === pattern).length;
    console.log(`  ${pattern} — leaves out ${count} file${count === 1 ? "" : "s"} right now`);
  }
  for (const bad of parsed.invalid) {
    console.log(`  line ${bad.line}: "${bad.text}" — not used (${bad.reason})`);
  }
}

async function ignoreRemove(folder: string, patterns: string[]): Promise<void> {
  const gitDir = requireConnectedFolder(folder);
  if (patterns.length === 0) {
    throw new CliError("Remove what? Run: goodfolder ignore list", 1);
  }
  if (!existsSync(ignoreFilePath(folder))) {
    console.log(`No ${IGNORE_FILE} yet — nothing to remove.`);
    return;
  }
  const lines = readRaw(folder).split("\n");
  const dropping = new Set(patterns.map((p) => p.trim()));
  const present = new Set(lines.map((line) => line.trim()).filter(Boolean));
  const removed = patterns.filter((p) => present.has(p.trim()));
  if (removed.length > 0) {
    const kept = lines.filter((line) => !dropping.has(line.trim()));
    writeFileSync(ignoreFilePath(folder), kept.join("\n"));
    applySkipRules(folder, gitDir);
  }
  for (const p of patterns) {
    console.log(
      present.has(p.trim())
        ? `✓ ${p} no longer leaves files out`
        : `  ${p} wasn't on the list`,
    );
  }
  if (removed.length > 0) {
    console.log("Files it was leaving out are protected from the next save on.");
  }
}

export async function cmdIgnore(
  folder: string,
  args: string[],
  opts: { remove: boolean; yes: boolean },
): Promise<void> {
  const sub = args[0] ?? "list";
  const rest = args.slice(1);
  switch (sub) {
    case "add":
      return ignoreAdd(folder, rest, opts);
    case "list":
      return ignoreList(folder);
    case "remove":
      return ignoreRemove(folder, rest);
    default:
      throw new CliError(
        'Say "add", "list" or "remove" — e.g.: goodfolder ignore add "*.mov"',
        1,
      );
  }
}
