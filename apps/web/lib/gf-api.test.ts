import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { openFile, readFileRaw } from "./gf-api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("readFileRaw turns the size cap into a renderable viewer state", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    size: 31_000_000,
    error: {
      code: "too-large",
      message: "This file is 31.0 MB — bigger than the browser preview limit.",
    },
  }), {
    status: 413,
    headers: { "content-type": "application/json" },
  });

  assert.deepEqual(await readFileRaw("folder", "large.pdf"), {
    size: 31_000_000,
    blob: null,
    mimeType: null,
    storedForDevice: false,
    issue: "too-large",
    message: "This file is 31.0 MB — bigger than the browser preview limit.",
  });
});

test("openFile keeps list metadata when a preview is deliberately unavailable", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    size: 4_200_000,
    error: { code: "missing", message: "The stored copy is missing." },
  }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });

  assert.deepEqual(await openFile("folder", {
    path: "photo.png",
    sha: "abc",
    size: 4_200_000,
  }), {
    path: "photo.png",
    sha: "abc",
    size: 4_200_000,
    kind: "image",
    blob: null,
    mimeType: null,
    storedForDevice: false,
    previewIssue: "missing",
    previewMessage: "The stored copy is missing.",
  });
});

test("readFileRaw still throws unexpected server failures", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "server", message: "Unexpected failure" },
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });

  await assert.rejects(() => readFileRaw("folder", "photo.png"), /Unexpected failure/);
});
