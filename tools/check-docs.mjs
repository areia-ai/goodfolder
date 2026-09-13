#!/usr/bin/env node
// Documentation gate — the rendered section's invariants, in one place:
//   - every docs/*.md that renders has front matter with title, description,
//     and order (site: false marks a file as deliberately not rendered);
//   - slugs are unique;
//   - every relative .md link resolves — a docs/<slug>.md page, CHANGELOG.md
//     (rendered as /docs/changelog), or a real file at the repository root.
//
// Run: node tools/check-docs.mjs   (exit 1 on any drift)

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(ROOT, "docs");

const problems = [];
const slugs = new Set();

for (const file of readdirSync(DOCS_DIR)) {
  if (!file.endsWith(".md")) continue;
  const slug = file.slice(0, -3);
  if (slugs.has(slug)) problems.push(`${file}: duplicate slug ${slug}`);
  slugs.add(slug);

  const src = readFileSync(join(DOCS_DIR, file), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) {
    problems.push(`${file}: no front matter`);
    continue;
  }
  const meta = m[1];
  const hidden = /(^|\n)\s*site:\s*false\s*(\n|$)/.test(meta);
  for (const key of ["title", "description", "order"]) {
    if (!hidden && !new RegExp(`(^|\\n)\\s*${key}:\\s*\\S`).test(meta)) {
      problems.push(`${file}: front matter missing ${key}`);
    }
  }

  for (const lm of src.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = lm[1];
    if (/^(https?:)?\/\//.test(href) || href.startsWith("#") || href.startsWith("mailto:")) continue;
    const clean = href.replace(/^\.\//, "");
    if (clean.startsWith("../")) {
      if (!existsSync(join(DOCS_DIR, clean))) problems.push(`${file}: dead link ${href}`);
    } else if (/^[\w-]+\.md$/.test(clean)) {
      if (!existsSync(join(DOCS_DIR, clean))) problems.push(`${file}: dead link ${href}`);
    }
  }
}

if (problems.length) {
  console.error("docs check failed:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`docs check: ${slugs.size} pages, all links resolve ✓`);
