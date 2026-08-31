import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml, resolveInlineImagePath } from "./markdown.ts";

test("resolves a Markdown image beside its document without leaving the folder", () => {
  assert.equal(resolveInlineImagePath("recipes/pina-colada.md", "images/drink.png"), "recipes/images/drink.png");
  assert.equal(resolveInlineImagePath("recipes/pina-colada.md", "../photos/drink.png"), "photos/drink.png");
  assert.equal(resolveInlineImagePath("pina-colada.md", "../outside.png"), null);
  assert.equal(resolveInlineImagePath("pina-colada.md", "https://example.com/drink.png"), null);
});

test("renders local Markdown images as authenticated preview markers", () => {
  const html = markdownToHtml("![A drink](pina-colada.png)", "pina-colada.md");
  assert.match(html, /data-gf-inline-image-path="pina-colada.png"/);
  assert.match(html, /data-gf-markdown-image-source="pina-colada.png"/);
  assert.match(html, /alt="A drink"/);
});
