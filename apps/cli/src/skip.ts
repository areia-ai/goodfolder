import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  categoryOfPattern,
  CREDENTIAL_PATHSPECS,
  KEEP_PATTERNS,
  SKIP_CATEGORY_LABEL,
  SKIP_RULES,
  type SkipCategory,
} from "@goodfolder/shared";
import { git } from "./git.ts";

/**
 * Not every file in a folder is the person's work. A project downloads
 * thousands of packages, rebuilds its own output on every run, and keeps
 * credentials next to the code that uses them. Protecting all of it buries
 * the two files someone actually changed under ten thousand they didn't, and
 * sends their passwords to a server on the way.
 *
 * The rules live in @goodfolder/shared as data. This module applies them to a
 * folder and reports what they left out. It never matches paths itself: the
 * engine that decides what a save contains is the same one asked what the
 * save left out, so the two can never drift apart.
 *
 * The list is written where the engine keeps per-folder settings, not into
 * the folder itself. Nothing new appears next to the person's files, and
 * nothing about it travels to their other devices — every device derives the
 * same list from the same rules.
 */

const BEGIN = "# --- GoodFolder: what it leaves out (managed automatically) ---";
const END = "# --- end GoodFolder ---";

/** Where the engine keeps this folder's private exclusion list. */
function excludeFilePath(gitDir: string): string {
  return join(gitDir, "info", "exclude");
}

/** The patterns that apply to this folder, evidence-gated rules included. */
export function activePatterns(folder: string): string[] {
  const patterns: string[] = [];
  for (const rule of SKIP_RULES) {
    if (rule.needs !== undefined && !existsSync(join(folder, rule.needs))) continue;
    patterns.push(rule.pattern);
  }
  // Keeps go last: a later line wins, so these survive the patterns above.
  patterns.push(...KEEP_PATTERNS);
  return patterns;
}

/**
 * Write GoodFolder's block into the folder's private exclusion list, leaving
 * anything else in that file untouched. Safe to run repeatedly — every entry
 * path calls it, and a folder whose project gained a `package.json` since it
 * was set up picks up the matching rules on its next save.
 */
export function applySkipRules(folder: string, gitDir: string): void {
  const path = excludeFilePath(gitDir);
  let existing = "";
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    /* no list yet */
  }
  // Drop any block we wrote before, so this is a replace and not a pile-up.
  const stripped = existing.replace(
    new RegExp(`${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}\\n?`, "g"),
    "",
  );
  const block = [BEGIN, ...activePatterns(folder), END, ""].join("\n");
  const head = stripped.length && !stripped.endsWith("\n") ? stripped + "\n" : stripped;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, head + block);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Credential-shaped files this folder holds that a save is leaving out.
 * Asked as a narrow question — only these shapes, matched by the engine —
 * so it stays instant on a folder with a hundred thousand skipped files.
 */
export function credentialFilesLeftOut(
  folder: string,
  alsoProtect: readonly string[] = [],
): string[] {
  const r = git(folder, [
    "ls-files",
    "-o",
    "-i",
    "--exclude-standard",
    "-z",
    "--",
    ...CREDENTIAL_PATHSPECS,
  ]);
  if (r.code !== 0) return [];
  const opted = new Set(alsoProtect);
  return r.stdout.split("\0").filter((p) => p && !opted.has(p));
}

export interface SkippedGroup {
  category: SkipCategory | "their-own";
  label: string;
  paths: string[];
}

const THEIR_OWN_LABEL = "files this project's own settings leave out";

/**
 * Everything a save is leaving out, grouped by why. Directories collapse to
 * one entry, so a folder with thirty thousand downloaded package files
 * reports one line rather than thirty thousand.
 */
export function skippedGroups(
  folder: string,
  alsoProtect: readonly string[] = [],
): SkippedGroup[] {
  const status = git(folder, ["status", "--porcelain", "--ignored", "-z"]);
  if (status.code !== 0) return [];
  const opted = new Set(alsoProtect);
  const paths = status.stdout
    .split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => entry.slice(3))
    .filter((p) => p && !opted.has(p));
  if (paths.length === 0) return [];

  // Ask the engine which pattern caught each path; a pattern we wrote maps
  // to a category, anything else came from the project's own settings.
  const check = git(folder, ["check-ignore", "-v", "--no-index", "--stdin"], paths.join("\n"));
  const byCategory = new Map<SkipCategory | "their-own", string[]>();
  for (const line of check.stdout.split("\n")) {
    if (!line.trim()) continue;
    // "<source>:<line>:<pattern>\t<path>"
    const tab = line.lastIndexOf("\t");
    if (tab < 0) continue;
    const path = line.slice(tab + 1);
    const source = line.slice(0, tab);
    const pattern = source.slice(source.lastIndexOf(":") + 1);
    const category = categoryOfPattern(pattern) ?? "their-own";
    const list = byCategory.get(category) ?? [];
    list.push(path);
    byCategory.set(category, list);
  }

  const order: Array<SkipCategory | "their-own"> = [
    "credentials",
    "installed",
    "rebuildable",
    "noise",
    "their-own",
  ];
  const groups: SkippedGroup[] = [];
  for (const category of order) {
    const list = byCategory.get(category);
    if (!list?.length) continue;
    groups.push({
      category,
      label:
        category === "their-own"
          ? THEIR_OWN_LABEL
          : SKIP_CATEGORY_LABEL[category],
      paths: [...list].sort(),
    });
  }
  return groups;
}
