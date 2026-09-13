// The documentation section's content model: docs/*.md in the repository is
// the single source of truth, rendered at build time (the app is a static
// export, so this only ever runs under Node). Front matter is a handful of
// `key: value` lines between --- markers; a file can opt out of the site with
// `site: false` — development.md uses that on purpose: it names the engine for
// contributors, and AGENTS.md rule 10 reserves that for for-engineers.tsx.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DOCS_DIR = join(REPO_ROOT, "docs");
const SITE = "https://trygoodfolder.com";

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  order: number;
  /** The document body with front matter removed. */
  markdown: string;
}

export function parseFrontMatter(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([\w-]+):\s*(.+)$/.exec(line.trim());
    if (kv) meta[kv[1]!] = kv[2]!.trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

function toPage(slug: string, src: string): DocPage | null {
  const { meta, body } = parseFrontMatter(src);
  if (meta.site === "false") return null;
  if (!meta.title || !meta.description || !meta.order) {
    throw new Error(`docs/${slug}.md is missing front matter (title/description/order)`);
  }
  return { slug, title: meta.title, description: meta.description, order: Number(meta.order), markdown: body.trim() };
}

/** Every page the site renders, in sidebar order. */
export function listDocs(): DocPage[] {
  const pages: DocPage[] = [];
  for (const file of readdirSync(DOCS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const page = toPage(file.slice(0, -3), readFileSync(join(DOCS_DIR, file), "utf8"));
    if (page) pages.push(page);
  }
  // The changelog lives at the repository root, not in docs/.
  const changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
  pages.push({
    slug: "changelog",
    title: "Changelog",
    description: "What changed between GoodFolder releases.",
    order: 90,
    markdown: changelog.trim(),
  });
  pages.sort((a, b) => a.order - b.order);
  return pages;
}

export function getDoc(slug: string): DocPage | undefined {
  return listDocs().find((p) => p.slug === slug);
}

/** The page's raw Markdown for the /docs/<slug>.md alternate — same body the
 *  renderer uses, with relative links resolved to absolute site URLs. */
export function docMarkdownForWeb(page: DocPage): string {
  return rewriteDocLinks(page.markdown, (href) => {
    if (/^(https?:)?\/\//.test(href) || href.startsWith("#") || href.startsWith("mailto:")) return href;
    const clean = href.replace(/^\.\//, "");
    if (clean === "../CHANGELOG.md" || clean === "CHANGELOG.md") return `${SITE}/docs/changelog`;
    if (clean.startsWith("../")) return `https://github.com/areia-ai/goodfolder/blob/main/${clean.slice(3)}`;
    if (/^[\w-]+\.md$/.test(clean)) return `${SITE}/docs/${clean.slice(0, -3)}.md`;
    return href;
  });
}

export function rewriteDocLinks(markdown: string, map: (href: string) => string): string {
  return markdown.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, bang: string, text: string, href: string) =>
    `${bang}[${text}](${map(href)})`,
  );
}
