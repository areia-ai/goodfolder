#!/usr/bin/env node
// Copies the rendered documentation's raw Markdown into the static export:
// every docs/*.md page (minus front matter, with relative links rewritten to
// absolute site URLs) becomes public/docs/<slug>.md so /docs/<slug>.md serves
// plain text. CHANGELOG.md joins them as docs/changelog.md. Files marked
// `site: false` in front matter are skipped — they are not on the site.
//
// Runs before `next build` / `next dev` (see apps/web/package.json).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(ROOT, "docs");
const OUT_DIR = join(ROOT, "apps/web/public/docs");
const SITE = "https://trygoodfolder.com";
const BLOB = "https://github.com/areia-ai/goodfolder/blob/main";

function stripFrontMatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  return { meta: m ? m[1] : "", body: m ? src.slice(m[0].length) : src };
}

const hidden = (meta) => /(^|\n)\s*site:\s*false\s*(\n|$)/.test(meta);

function absoluteLinks(md) {
  return md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, bang, text, href) => {
    const clean = href.replace(/^\.\//, "");
    let out = href;
    if (clean === "../CHANGELOG.md" || clean === "CHANGELOG.md") out = `${SITE}/docs/changelog`;
    else if (clean.startsWith("../")) out = `${BLOB}/${clean.slice(3)}`;
    else if (/^[\w-]+\.md$/.test(clean)) out = `${SITE}/docs/${clean.slice(0, -3)}.md`;
    return `${bang}[${text}](${out})`;
  });
}

mkdirSync(OUT_DIR, { recursive: true });
let count = 0;
for (const file of readdirSync(DOCS_DIR)) {
  if (!file.endsWith(".md")) continue;
  const { meta, body } = stripFrontMatter(readFileSync(join(DOCS_DIR, file), "utf8"));
  if (hidden(meta)) continue;
  const slug = file.slice(0, -3);
  writeFileSync(join(OUT_DIR, `${slug}.md`), absoluteLinks(body.trim()) + "\n");
  count++;
}
writeFileSync(
  join(OUT_DIR, "changelog.md"),
  absoluteLinks(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").trim()) + "\n",
);
console.log(`docs public: ${count + 1} markdown pages written to apps/web/public/docs/`);
