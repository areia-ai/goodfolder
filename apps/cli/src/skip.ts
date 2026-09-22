import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  categoryOfPattern,
  CREDENTIAL_PATHSPECS,
  IGNORE_FILE,
  KEEP_PATTERNS,
  parseIgnoreFile,
  SKIP_CATEGORY_LABEL,
  SKIP_RULES,
  type SkipCategory,
  type SkippedEntry,
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
 * the folder itself — except `.goodfolderignore`, which is the person's own
 * list and travels with the folder to every device.
 */

const BEGIN = "# --- GoodFolder: what it leaves out (managed automatically) ---";
const END = "# --- end GoodFolder ---";
const IGNORE_BEGIN = "# --- GoodFolder: your own leave-out list ---";
const IGNORE_END = "# --- end your own list ---";

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
 * Read the folder's own `.goodfolderignore`. A missing file is an empty
 * list; unusable lines are reported, never applied — the server reads the
 * same file through the same parser, so the two can never disagree.
 */
export function readIgnoreFile(folder: string): {
  patterns: string[];
  invalid: Array<{ line: number; text: string; reason: string }>;
} {
  let text = "";
  try {
    text = readFileSync(join(folder, IGNORE_FILE), "utf8");
  } catch {
    /* no list yet */
  }
  return parseIgnoreFile(text);
}

/**
 * Write GoodFolder's block into the folder's private exclusion list, leaving
 * anything else in that file untouched. Safe to run repeatedly — every entry
 * path calls it, and a folder whose project gained a `package.json` since it
 * was set up picks up the matching rules on its next save.
 *
 * Two managed blocks, in order: the built-in rules (with the keeps last, so
 * they win), then the person's own `.goodfolderignore` lines — last of all,
 * so a line written there wins over a keep.
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
    new RegExp(
      `${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}\\n?|` +
        `${escapeRe(IGNORE_BEGIN)}[\\s\\S]*?${escapeRe(IGNORE_END)}\\n?`,
      "g",
    ),
    "",
  );
  const block = [BEGIN, ...activePatterns(folder), END, ""].join("\n");
  const ignore = readIgnoreFile(folder).patterns;
  const ignoreBlock = [IGNORE_BEGIN, ...ignore, IGNORE_END, ""].join("\n");
  const head = stripped.length && !stripped.endsWith("\n") ? stripped + "\n" : stripped;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, head + block + ignoreBlock);
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

export type { SkippedEntry };

/** Why one built-in rule left this path out, in singular form. */
const ENTRY_REASON: Record<SkipCategory, string> = {
  credentials: "looks like it holds passwords or keys",
  installed: "is part of packages the project downloaded",
  rebuildable: "is rebuilt by the project's own tools",
  noise: "is written by the computer itself",
};

/**
 * Everything a save is leaving out, one entry per path — directories the
 * engine collapsed stay collapsed, so a folder with thirty thousand
 * downloaded package files reports one entry rather than thirty thousand.
 *
 * Attribution comes from which *line* of which file caught the path (the
 * engine reports it), never from pattern text — the same text can sit in
 * both our block and the person's own list.
 */
export function skippedEntries(
  folder: string,
  alsoProtect: readonly string[] = [],
): SkippedEntry[] {
  const status = git(folder, ["status", "--porcelain", "--ignored", "-z"]);
  if (status.code !== 0) return [];
  const opted = new Set(alsoProtect);
  const paths = status.stdout
    .split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => entry.slice(3))
    .filter((p) => p && !opted.has(p));
  if (paths.length === 0) return [];

  // Where our two managed blocks sit in the engine's private list, so a
  // reported line number lands in exactly one of them.
  const gitDir = git(folder, ["rev-parse", "--absolute-git-dir"]).stdout.trim();
  let builtin: [number, number] | null = null;
  let own: [number, number] | null = null;
  let excludePath = "";
  try {
    excludePath = excludeFilePath(gitDir);
    const lines = readFileSync(excludePath, "utf8").split("\n");
    const find = (begin: string, end: string): [number, number] | null => {
      const lo = lines.indexOf(begin);
      const hi = lo < 0 ? -1 : lines.indexOf(end, lo);
      return lo >= 0 && hi > lo ? [lo + 1, hi + 1] : null;
    };
    builtin = find(BEGIN, END);
    own = find(IGNORE_BEGIN, IGNORE_END);
  } catch {
    /* no exclusion file yet */
  }

  const check = git(folder, ["check-ignore", "-v", "--no-index", "--stdin"], paths.join("\n"));
  const entries: SkippedEntry[] = [];
  for (const line of check.stdout.split("\n")) {
    if (!line.trim()) continue;
    // "<source>:<line>:<pattern>\t<path>"
    const tab = line.lastIndexOf("\t");
    if (tab < 0) continue;
    const path = line.slice(tab + 1);
    const source = line.slice(0, tab);
    const pattern = source.slice(source.lastIndexOf(":") + 1);
    const head = source.slice(0, source.lastIndexOf(":"));
    const lineNo = Number(head.slice(head.lastIndexOf(":") + 1));
    const sourceFile = head.slice(0, head.lastIndexOf(":"));

    const ours =
      Number.isInteger(lineNo) &&
      (sourceFile === excludePath || sourceFile.endsWith("/info/exclude") || sourceFile === "info/exclude");
    if (ours && builtin && lineNo > builtin[0] && lineNo < builtin[1]) {
      const category = categoryOfPattern(pattern) ?? "noise";
      entries.push({
        path,
        source: "built-in",
        category,
        pattern,
        reason: `${ENTRY_REASON[category]} (rule: ${pattern})`,
      });
    } else if (ours && own && lineNo > own[0] && lineNo < own[1]) {
      entries.push({
        path,
        source: "ignore-list",
        pattern,
        reason: `on your ignore list (${pattern})`,
      });
    } else {
      entries.push({
        path,
        source: "their-own",
        pattern,
        reason: `this project's own settings (${pattern})`,
      });
    }
  }
  return entries;
}

export interface SkippedGroup {
  category: SkipCategory | "ignore-list" | "their-own";
  label: string;
  paths: string[];
}

const THEIR_OWN_LABEL = "files this project's own settings leave out";
const IGNORE_LIST_LABEL = "files on your ignore list";

/** Group one left-out list by why, for display. */
export function groupSkippedEntries(entries: readonly SkippedEntry[]): SkippedGroup[] {
  const byKey = new Map<SkippedGroup["category"], string[]>();
  for (const entry of entries) {
    const key = entry.source === "built-in" ? (entry.category ?? "noise") : entry.source;
    const list = byKey.get(key) ?? [];
    list.push(entry.path);
    byKey.set(key, list);
  }

  const order: Array<SkippedGroup["category"]> = [
    "credentials",
    "ignore-list",
    "installed",
    "rebuildable",
    "noise",
    "their-own",
  ];
  const groups: SkippedGroup[] = [];
  for (const key of order) {
    const list = byKey.get(key);
    if (!list?.length) continue;
    groups.push({
      category: key,
      label:
        key === "their-own"
          ? THEIR_OWN_LABEL
          : key === "ignore-list"
            ? IGNORE_LIST_LABEL
            : SKIP_CATEGORY_LABEL[key],
      paths: [...list].sort(),
    });
  }
  return groups;
}

/**
 * The same left-out list as skippedEntries, grouped by why for display.
 */
export function skippedGroups(
  folder: string,
  alsoProtect: readonly string[] = [],
): SkippedGroup[] {
  return groupSkippedEntries(skippedEntries(folder, alsoProtect));
}
