import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHtml, tokenizeHtml, attributeOf, setAttribute } from "./page-html.ts";
import {
  assetMimeFor,
  bundlePage,
  bytesToBase64,
  resolveFolderPath,
  resolveIn,
  type PageFileReader,
} from "./page-bundle.ts";
import { PAGE_FRAME_SANDBOX, readPageFrameEvent, pageFrameRuntime } from "./page-frame.ts";
import { isRenderablePage } from "./preview.ts";

/* --------------------------------------------------------------- reading */

test("taking a page apart and putting it back gives the same bytes", () => {
  const samples = [
    `<!doctype html><html><head><title>a > b</title></head><body><p>1 < 2</p></body></html>`,
    `<div class='x' data-n=3 hidden><img src="a.png" alt="a&amp;b"/></div>`,
    `<script>if (a<b) { c(); } // </script>`,
    `<p>unfinished <span attr="never closed`,
    `plain text with no markup at all`,
    `<!-- a comment --><br><br/>`,
  ];
  for (const sample of samples) {
    assert.equal(tokenizeHtml(sample).map((token) => token.raw).join(""), sample, sample);
    assert.equal(renderHtml(tokenizeHtml(sample)), sample, sample);
  }
});

test("script and style content is never read as markup", () => {
  const tokens = tokenizeHtml(`<script>var a = "<img src=x>"; if (1<2) {}</script><p>after</p>`);
  const tags = tokens.filter((token) => token.kind === "tag").map((token) => token.raw);
  assert.deepEqual(tags, ["<script>", "</script>", "<p>", "</p>"]);
});

test("an attribute is decoded to read and re-encoded only when it changes", () => {
  const tokens = tokenizeHtml(`<img src="a.png" alt="Tom &amp; Jerry" title='it&#39;s'>`);
  const img = tokens.find((token) => token.kind === "tag")!;
  assert.equal(attributeOf(img, "alt"), "Tom & Jerry");
  assert.equal(attributeOf(img, "title"), "it's");
  setAttribute(img, "src", "data:image/png;base64,AA");
  const out = renderHtml(tokens);
  assert.match(out, /src="data:image\/png;base64,AA"/);
  // The attributes nobody touched come back exactly as they went in.
  assert.match(out, /alt="Tom &amp; Jerry"/);
  assert.match(out, /title='it&#39;s'/);
});

/* ------------------------------------------------------------- addresses */

test("a reference resolves inside the folder, or not at all", () => {
  assert.equal(resolveFolderPath("site/index.html", "style.css"), "site/style.css");
  assert.equal(resolveFolderPath("site/index.html", "./img/a.png"), "site/img/a.png");
  assert.equal(resolveFolderPath("site/pages/a.html", "../style.css"), "site/style.css");
  assert.equal(resolveFolderPath("site/index.html", "/shared/a.css"), "shared/a.css");
  assert.equal(resolveFolderPath("index.html", "a.css?v=2#top"), "a.css");
  assert.equal(resolveFolderPath("index.html", "my%20file.css"), "my file.css");
  assert.equal(resolveIn("", "a/b.css"), "a/b.css");
});

test("a reference that is not a place in this folder is left alone", () => {
  for (const reference of [
    "https://example.com/a.css",
    "//cdn.example.com/a.js",
    "data:text/css,body{}",
    "mailto:someone@example.com",
    "javascript:void(0)",
    "#section",
    "",
    "   ",
    "../../outside.css",
  ]) {
    assert.equal(resolveFolderPath("site/index.html", reference), null, reference);
  }
});

test("base64 matches what the platform produces", () => {
  for (const sample of ["", "a", "ab", "abc", "abcd", "hello world", "üñî"]) {
    const bytes = new TextEncoder().encode(sample);
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString("base64"), sample);
  }
});

test("assetMimeFor names what it knows and admits what it does not", () => {
  assert.equal(assetMimeFor("a/b.css"), "text/css");
  assert.equal(assetMimeFor("a/b.WOFF2"), "font/woff2");
  assert.equal(assetMimeFor("a/b.qqq"), "application/octet-stream");
  assert.equal(assetMimeFor("Makefile"), "application/octet-stream");
});

/* ---------------------------------------------------------------- bundle */

function reader(files: Record<string, string | Uint8Array>): PageFileReader {
  const sized = Object.entries(files).map(([path, value]) => ({
    path,
    size: typeof value === "string" ? new TextEncoder().encode(value).byteLength : value.byteLength,
  }));
  return {
    files: sized,
    async readText(path) {
      const value = files[path];
      return typeof value === "string" ? value : null;
    },
    async readBytes(path) {
      const value = files[path];
      if (value === undefined) return null;
      return typeof value === "string" ? new TextEncoder().encode(value) : value;
    },
  };
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

test("a page carries in the files it points at", async () => {
  const html = `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>` +
    `<body><img src="img/logo.png"><script src="app.js"></script></body></html>`;
  const bundle = await bundlePage("site/index.html", html, reader({
    "site/index.html": html,
    "site/style.css": "body { color: red }",
    "site/app.js": "console.log(1)",
    "site/img/logo.png": PNG,
  }));
  assert.deepEqual(bundle.included, ["site/app.js", "site/img/logo.png", "site/style.css"]);
  assert.match(bundle.html, /href="data:text\/css;base64,/);
  assert.match(bundle.html, /src="data:text\/javascript;base64,/);
  assert.match(bundle.html, /src="data:image\/png;base64,iVBORw0K/);
  assert.deepEqual(bundle.missing, []);
});

test("a stylesheet's own references resolve from where the stylesheet is", async () => {
  const html = `<link rel="stylesheet" href="css/site.css">`;
  const bundle = await bundlePage("index.html", html, reader({
    "index.html": html,
    "css/site.css": `@font-face { src: url(../fonts/a.woff2) } .a { background: url("bg.png") }`,
    "fonts/a.woff2": PNG,
    "css/bg.png": PNG,
  }));
  assert.deepEqual(bundle.included, ["css/bg.png", "css/site.css", "fonts/a.woff2"]);
  const css = Buffer.from(bundle.html.match(/data:text\/css;base64,([^"]+)/)![1]!, "base64").toString();
  assert.match(css, /url\("data:font\/woff2;base64,/);
  assert.match(css, /url\("data:image\/png;base64,/);
});

test("a style block and a style attribute are rewritten too", async () => {
  const html = `<style>.a{background:url('p.png')}</style><div style="background: url(p.png)"></div>`;
  const bundle = await bundlePage("index.html", html, reader({ "index.html": html, "p.png": PNG }));
  assert.equal(bundle.included.length, 1);
  assert.equal(bundle.html.match(/data:image\/png/g)?.length, 2);
});

test("every candidate in a srcset is carried", async () => {
  const html = `<img srcset="a.png 1x, b.png 2x" src="a.png">`;
  const bundle = await bundlePage("index.html", html, reader({ "index.html": html, "a.png": PNG, "b.png": PNG }));
  assert.deepEqual(bundle.included, ["a.png", "b.png"]);
  assert.match(bundle.html, /srcset="data:image\/png;base64,[^ ]+ 1x, data:image\/png;base64,[^ ]+ 2x"/);
});

test("what is not there, and what is elsewhere, are reported apart", async () => {
  const html = `<link rel="stylesheet" href="https://cdn.example.com/a.css">` +
    `<img src="gone.png"><script src="app.js"></script>`;
  const bundle = await bundlePage("index.html", html, reader({ "index.html": html, "app.js": "1" }));
  assert.deepEqual(bundle.external, ["https://cdn.example.com/a.css"]);
  assert.deepEqual(bundle.missing, ["gone.png"]);
  assert.deepEqual(bundle.included, ["app.js"]);
  // An address on the web is left exactly as the page wrote it.
  assert.match(bundle.html, /href="https:\/\/cdn\.example\.com\/a\.css"/);
});

test("a file too big for the budget is left out, not read", async () => {
  const html = `<img src="huge.png"><img src="small.png">`;
  let readCount = 0;
  const base = reader({ "index.html": html, "small.png": PNG });
  const source: PageFileReader = {
    files: [...base.files, { path: "huge.png", size: 90_000_000 }],
    readText: base.readText,
    async readBytes(path) {
      readCount += 1;
      return base.readBytes(path);
    },
  };
  const bundle = await bundlePage("index.html", html, source, { budget: 1_000_000 });
  assert.deepEqual(bundle.omitted, ["huge.png"]);
  assert.deepEqual(bundle.included, ["small.png"]);
  assert.equal(readCount, 1, "the oversized file is never pulled through the browser");
  assert.match(bundle.html, /src="huge\.png"/);
});

test("a link to another page in the folder is marked, never flattened", async () => {
  const html = `<a href="about.html">About</a><a href="https://example.com">Away</a><a href="#top">Top</a>`;
  const bundle = await bundlePage("index.html", html, reader({ "index.html": html, "about.html": "<p>hi</p>" }));
  assert.match(bundle.html, /<a href="about\.html" data-gf-page="about\.html">/);
  assert.doesNotMatch(bundle.html, /data:text\/html/);
  assert.match(bundle.html, /<a href="https:\/\/example\.com">/);
  assert.equal(bundle.included.length, 0);
});

test("a <base> moves where references resolve, and one on the web disables them", async () => {
  const inFolder = `<base href="assets/"><img src="logo.png">`;
  const moved = await bundlePage("index.html", inFolder, reader({ "index.html": inFolder, "assets/logo.png": PNG }));
  assert.deepEqual(moved.included, ["assets/logo.png"]);

  const elsewhere = `<base href="https://example.com/"><img src="logo.png">`;
  const away = await bundlePage("index.html", elsewhere, reader({ "index.html": elsewhere, "logo.png": PNG }));
  assert.deepEqual(away.included, []);
  assert.deepEqual(away.external, ["logo.png"]);
});

test("the frame's own script runs before the page's", async () => {
  const html = `<html><head><script src="app.js"></script></head><body></body></html>`;
  const bundle = await bundlePage("index.html", html, reader({ "index.html": html, "app.js": "1" }), {
    runtime: "/* frame */",
  });
  assert.match(bundle.html, /<head><script>\/\* frame \*\/<\/script><script src="data:/);
});

test("a page with no head or html element still gets the runtime", async () => {
  const bundle = await bundlePage("a.html", `<p>hi</p>`, reader({ "a.html": "<p>hi</p>" }), {
    runtime: "/* frame */",
  });
  assert.match(bundle.html, /^<script>\/\* frame \*\/<\/script><p>hi<\/p>$/);
});

test("nothing in the runtime can close the script element carrying it", () => {
  assert.doesNotMatch(pageFrameRuntime("t"), /<\/script/i);
});

/* -------------------------------------------------------------- the frame */

test("the frame is never given an origin of its own", () => {
  // If this fails, a page in someone's folder can read the dashboard's storage
  // and speak to the account API as the person signed into it. Change the
  // change, not this test.
  assert.equal(PAGE_FRAME_SANDBOX, "allow-scripts allow-forms allow-modals allow-popups allow-downloads");
  for (const forbidden of ["allow-same-origin", "allow-top-navigation", "allow-popups-to-escape-sandbox"]) {
    assert.ok(!PAGE_FRAME_SANDBOX.includes(forbidden), forbidden);
  }
});

test("a message from the frame is believed only when it proves which frame it is", () => {
  assert.deepEqual(readPageFrameEvent({ __goodfolderPage: "t", kind: "navigate", path: "a.html" }, "t"), {
    kind: "navigate",
    path: "a.html",
  });
  assert.equal(readPageFrameEvent({ __goodfolderPage: "other", kind: "navigate", path: "a.html" }, "t"), null);
  assert.equal(readPageFrameEvent({ kind: "navigate", path: "a.html" }, "t"), null);
  assert.equal(readPageFrameEvent("navigate", "t"), null);
  assert.equal(readPageFrameEvent(null, "t"), null);
  assert.equal(readPageFrameEvent({ __goodfolderPage: "t", kind: "eval", code: "x" }, "t"), null);
  assert.equal(readPageFrameEvent({ __goodfolderPage: "t", kind: "navigate", path: 42 }, "t"), null);
});

test("what the frame says is cut down to size before it is kept", () => {
  const event = readPageFrameEvent(
    { __goodfolderPage: "t", kind: "error", message: "x".repeat(5000) },
    "t",
  );
  assert.equal(event?.kind === "error" && event.message.length, 400);
});

/* -------------------------------------------------------------- the kind */

test("only a web page renders; its neighbours in the folder still read as text", () => {
  assert.ok(isRenderablePage("site/index.html"));
  assert.ok(isRenderablePage("SITE/INDEX.HTM"));
  for (const path of ["style.css", "app.js", "notes.md", "data.json", "a.svg"]) {
    assert.ok(!isRenderablePage(path), path);
  }
});
