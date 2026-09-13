import assert from "node:assert/strict";
import { test } from "node:test";
import { docHref, renderMarkdown } from "./docs-markdown.ts";

test("headings get slug ids and are collected for the on-page nav", () => {
  const { html, headings } = renderMarkdown("# Big Title\n\n## Second Section!\n\n### Third");
  assert.match(html, /<h1 id="big-title">Big Title<\/h1>/);
  assert.match(html, /<h2 id="second-section">Second Section!<\/h2>/);
  assert.deepEqual(headings.map((h) => h.id), ["big-title", "second-section", "third"]);
});

test("paragraphs join wrapped lines and apply inline markup", () => {
  const { html } = renderMarkdown("Line one\nline two with **bold** and *it* and `code`.");
  assert.equal(html, "<p>Line one line two with <strong>bold</strong> and <em>it</em> and <code>code</code>.</p>");
});

test("digits in prose survive a code span", () => {
  const { html } = renderMarkdown("Node 22 and `pnpm install`.");
  assert.equal(html, "<p>Node 22 and <code>pnpm install</code>.</p>");
});

test("fenced code keeps the language class and escapes contents", () => {
  const { html } = renderMarkdown("```bash\ncp .env.example .env\na < b\n```");
  assert.match(html, /<pre><code class="language-bash">cp \.env\.example \.env\na &lt; b<\/code><\/pre>/);
});

test("lists: unordered and ordered", () => {
  const { html } = renderMarkdown("- one\n- two\n\n1. first\n2. second");
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
});

test("blockquotes and rules", () => {
  const { html } = renderMarkdown("> said this\n\n---");
  assert.match(html, /<blockquote><p>said this<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
});

test("GFM tables", () => {
  const { html } = renderMarkdown("| A | B |\n| --- | --- |\n| `x` | **y** |");
  assert.match(html, /<table><thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead><tbody><tr><td><code>x<\/code><\/td><td><strong>y<\/strong><\/td><\/tr><\/tbody><\/table>/);
});

test("doc-relative links map to /docs/<slug>", () => {
  assert.equal(docHref("configuration.md"), "/docs/configuration");
  assert.equal(docHref("./agents.md"), "/docs/agents");
  assert.equal(docHref("CHANGELOG.md"), "/docs/changelog");
  assert.equal(docHref("../CHANGELOG.md"), "/docs/changelog");
  assert.equal(docHref("../README.md"), "https://github.com/areia-ai/goodfolder/blob/main/README.md");
  assert.equal(docHref("https://example.com/x"), "https://example.com/x");
  assert.equal(docHref("#local"), "#local");
});

test("link rendering uses the mapping; images only for site-relative paths", () => {
  const { html } = renderMarkdown("[Cfg](configuration.md) and ![shot](/shots/x.png) and ![alt](https://x/y.png)");
  assert.match(html, /<a href="\/docs\/configuration">Cfg<\/a>/);
  assert.match(html, /<img src="\/shots\/x\.png" alt="shot">/);
  assert.match(html, / and alt<\/p>/); // remote image degrades to its alt text
});

test("HTML is escaped in paragraphs and inside fences", () => {
  const { html } = renderMarkdown("A <script>alert(1)</script> here\n\n```html\n<script>x</script>\n```");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
