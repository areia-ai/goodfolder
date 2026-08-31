#!/usr/bin/env node
// Vocabulary gate — GoodFolder's user-facing surfaces never leak engine
// vocabulary (git, repos, commits, branches, tokens, …).
//
// How it works:
//   1. Walks every user-facing source surface (CLI output, MCP tool
//      descriptions, control-plane pages/email, web copy).
//   2. Extracts STRING LITERALS with a small state machine that skips
//      comments and understands nested template interpolations.
//   3. Flags only PROSE-like literals (the heuristic: enough words to be a
//      sentence). Bare identifiers and engine arguments ("status", "--all",
//      "origin") can never trip it.
//   4. An explicit allowlist below documents every accepted exception with a
//      reason. If you add one, you owe the reason.
//
// Run: node tools/vocabulary-gate.mjs   (exit 1 on any leak)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  "apps/cli/src",
  "apps/mcp/src",
  // The whole control plane, not just its routes: the write gate holds
  // the words a person reads when a file is turned away.
  "apps/control-plane/src",
  "apps/web/app",
  "apps/web/components",
  "apps/web/lib",
  // Shared holds copy too now: the skip-category labels a person reads when a
  // save tells them what it left out.
  "packages/shared/src",
];

// The wall between the engine and the person. Word-bounded, case-insensitive.
const BANNED = [
  [/\bgits?\b/i, "git"],
  [/\brepo\b/i, "repo"],
  [/\brepositor(y|ies)\b/i, "repository"],
  [/\bcommit(s|ted|ting)?\b/i, "commit"],
  [/\bbranch(es|ed|ing)?\b/i, "branch"],
  [/\bstag(e|es|ed|ing)\b/i, "stage"],
  [/\bclon(e|es|ed|ing)\b/i, "clone"],
  [/\bmerg(e|es|ed|ing)\b/i, "merge"],
  [/\bcheckpoint(s|ed|ing)?\b/i, "checkpoint"],
  [/\btokens?\b/i, "token"],
  [/\bstash(ed|ing)?\b/i, "stash"],
  [/\brebas(e|ed|ing)\b/i, "rebase"],
  [/\bdiff(s|ed|ing)?\b/i, "diff"],
  [/\bfetch(es|ed|ing)?\b/i, "fetch"],
  [/\bpull(s|ed|ing)\b/i, "pull"],
  [/\bpush(es|ed|ing)\b/i, "push"],
  [/\bversion control\b/i, "version control"],
];

// Accepted exceptions. Every entry needs a human reason, and should name the
// `terms` it excuses and, where the exception belongs to one surface, the
// `files` it applies to. Both narrow the hole: an entry with neither is a
// blanket pass, which is what this list must not quietly become.
// `terms` it excuses: an exception written for one word used to wave through
// every other banned word in the same string, which is how "checkpoint" sat
// in the CLI's own help text under an entry about `clone`. Omitting `terms`
// still excuses the whole string, for the two entries that genuinely need it.
const ALLOWED = [
  {
    why: "`goodfolder clone` keeps its name — decided 2026-08-31, not a pending follow-up. The word reads to the people who use this as the one GitHub already taught them, and it names a real command that has to be typed exactly. It stays excused wherever the literal command is written, including in the dashboard.",
    terms: ["clone"],
    matches: (s) => s.includes("goodfolder clone"),
  },
  {
    why: "Control-plane pairing/sign-in pages embed working scripts (fetch, content-type); the visible COPY inside them is hand-audited.",
    matches: (s) => s.includes("<script") && s.includes("</html>"),
  },
  {
    why: "Git-transport boundary errors are answered to git CREDENTIAL FAILURES over /git/* — read by git clients while auth fails, never part of the person-facing journey.",
    matches: (s) => s.includes("token not valid for this project") || s.includes("malformed git path"),
  },
  {
    why:
      "ONE section of the landing page is addressed to engineers evaluating GoodFolder for colleagues who will never " +
      "read it: the buyer and the user are different people, and the buyer needs to hear that the engine is the boring, " +
      "proven one. Hard rule 5 protects the PRODUCT surface — labels, screens, errors, CLI output — from vocabulary a " +
      "person would have to learn. It is not a ban on telling an engineer what is underneath, in a block written for " +
      "them, below the fold, that the product itself never shows. Scoped to that one file and those two words on " +
      "purpose: if a third word or a second file needs excusing, that is a positioning change and it needs a decision, " +
      "not an edit here.",
    files: ["apps/web/components/for-engineers.tsx"],
    terms: ["git", "repository"],
    matches: () => true,
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function targetFiles() {
  const files = [];
  for (const t of TARGETS) {
    const abs = join(ROOT, t);
    try {
      statSync(abs).isDirectory();
      for (const f of walk(abs)) {
        if (/\.(ts|tsx)$/.test(f)) files.push(f);
      }
    } catch {
      files.push(abs); // single-file target
    }
  }
  return files;
}

/** Extract string literals, skipping comments and code outside strings.
 *  Fragments of one template literal (split by ${…}) share a template id so
 *  they can be judged as a single logical string later. */
function extractLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  let line = 1;
  let templateId = 0;
  const bump = (text) => {
    for (const ch of text) if (ch === "\n") line++;
  };

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    // comments
    if (ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      bump(src.slice(i, end < 0 ? n : end + 2));
      i = end < 0 ? n : end + 2;
      continue;
    }
    // strings
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const startLine = line;
      const tid = quote === "`" ? ++templateId : -1;
      let value = "";
      i++;
      while (i < n) {
        const c = src[i];
        if (c === "\\") {
          value += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (quote !== "`" && c === quote) {
          i++;
          break;
        }
        if (quote === "`" && c === "`") {
          i++;
          break;
        }
        if (c === "$" && src[i + 1] === "{" && quote === "`") {
          // interpolation: capture nothing, skip balanced braces
          let depth = 1;
          value += " ";
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            else if (src[i] === "\n") line++;
            i++;
          }
          continue;
        }
        if (c === "\n") line++;
        value += c;
        i++;
      }
      out.push({ line: startLine, value, tid });
      continue;
    }
    if (ch === "\n") line++;
    i++;
  }
  return out;
}

/** A single line that reads like something a person would be shown. */
function copyLikeLine(l) {
  const t = l.trim();
  if (!t) return true; // blank lines are neutral
  if (/[;{}]|=>|\)\.|function\b|\bconst\b|\breturn\b|\bif\s*\(|JSON\.|=>/.test(t)) return false;
  return /^[-–•·✓✔⚠✗×"'(\d\w]/.test(t);
}

function isProse(s) {
  const flat = s.replace(/\$\{[^{}]*\}/g, " ").replace(/\s+/g, " ").trim();
  const words = flat.split(" ").filter(Boolean);
  if (/\n/.test(s)) {
    const lines = s.split("\n").filter((l) => l.trim());
    const totalWords = words.length;
    return totalWords >= 3 && lines.every(copyLikeLine);
  }
  return words.length >= 4 && flat.length >= 18 && !/[;{}=<>|]/.test(flat);
}

function findBanned(s) {
  const hits = [];
  for (const [re, label] of BANNED) {
    if (re.test(s)) hits.push(label);
  }
  return hits;
}

const violations = [];

for (const file of targetFiles()) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  const lits = extractLiterals(src);

  // Group template fragments (shared tid) into single logical strings.
  const grouped = new Map(); // tid -> { line, value }
  for (const lit of lits) {
    if (lit.tid > 0) {
      const g = grouped.get(lit.tid);
      if (g) g.value += "\n" + lit.value;
      else grouped.set(lit.tid, { line: lit.line, value: lit.value });
    } else {
      judge(rel, lit.line, lit.value, violations);
    }
  }
  for (const g of grouped.values()) judge(rel, g.line, g.value, violations);

  // Second pass for JSX/HTML text nodes (not string literals): >copy<,
  // including paragraphs that wrap across lines.
  if (/\.tsx$/.test(file) || /\.html$/.test(file)) {
    const textNodes = src.matchAll(/>([^<>{}()]{6,})</g);
    for (const m of textNodes) {
      const value = m[1];
      if (!isProse(value)) continue;
      const hits = findBanned(value).filter(
        (term) =>
          !ALLOWED.some(
            (a) =>
              (!a.files || a.files.includes(rel)) &&
              (!a.terms || a.terms.includes(term)) &&
              a.matches(value),
          ),
      );
      if (!hits.length) continue;
      const line = src.slice(0, m.index).split("\n").length;
      violations.push({ file: rel, line, terms: hits.join(", "), text: value.trim().replace(/\s+/g, " ").slice(0, 140), note: "JSX/HTML text node" });
    }
  }
}

function judge(rel, line, value, into) {
  if (!isProse(value)) return;
  const hits = findBanned(value);
  if (!hits.length) return;
  const remaining = hits.filter(
    (term) =>
      !ALLOWED.some(
        (a) =>
          (!a.files || a.files.includes(rel)) &&
          (!a.terms || a.terms.includes(term)) &&
          a.matches(value),
      ),
  );
  if (remaining.length === 0) return;
  into.push({ file: rel, line, terms: remaining.join(", "), text: value.trim().slice(0, 140) });
}

if (violations.length > 0) {
  console.error(`\nvocabulary gate: ${violations.length} leak${violations.length === 1 ? "" : "s"}\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}${v.note ? ` (${v.note})` : ""}`);
    console.error(`    terms: ${v.terms}`);
    console.error(`    text:  ${v.text.replace(/\n/g, " ⏎ ")}\n`);
  }
  console.error("Engine words belong in engineering docs, never in what a person reads.");
  console.error("Rewrite the copy in plain language — or, only with real cause, add a reasoned entry to ALLOWED in tools/vocabulary-gate.mjs.");
  process.exit(1);
}

console.log("vocabulary gate: clean ✓");
