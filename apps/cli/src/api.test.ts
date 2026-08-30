import assert from "node:assert/strict";
import test from "node:test";
import { preflightSave } from "./api.ts";
import type { FolderConfig } from "./config.ts";

const cfg: FolderConfig = {
  apiUrl: "https://example.test",
  projectId: "project",
  token: "token",
  connectedAt: "2026-08-30T00:00:00Z",
};

test("save preflight gives a protected-data message for quota refusal", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "quota-exceeded", message: "raw server message" },
  }), { status: 409, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(preflightSave(cfg), /Nothing was removed/);
  } finally {
    globalThis.fetch = original;
  }
});

test("save preflight accepts a writable account", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: true, canWrite: true });
  try {
    await preflightSave(cfg);
  } finally {
    globalThis.fetch = original;
  }
});
