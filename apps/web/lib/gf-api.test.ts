import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { deleteFolder, openFile, readFileRaw } from "./gf-api.ts";

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

test("deleteFolder sends the exact name with a DELETE request", async () => {
  const requests: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method, body: init?.body });
    return new Response(JSON.stringify({ ok: true, projectId: "folder-1", name: "recipes" }), {
      headers: { "content-type": "application/json" },
    });
  };

  assert.deepEqual(await deleteFolder("folder-1", "recipes"), {
    ok: true,
    projectId: "folder-1",
    name: "recipes",
  });
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.url.endsWith("/api/projects/folder-1"), true);
  assert.equal(request.method, "DELETE");
  assert.deepEqual(JSON.parse(String(request.body)), { name: "recipes" });
});

test("deleteFolder shows the server's confirmation failure", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "confirmation", message: "Type the folder's exact name to confirm permanent deletion." },
  }), {
    status: 409,
    headers: { "content-type": "application/json" },
  });

  await assert.rejects(() => deleteFolder("folder-1", "Recipes"), /exact name/);
});
