import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRestorePreview,
  explainSave,
  searchSaves,
  toCompactSave,
  DASHBOARD_TOOL_NAMES,
  registerDashboardTools,
  unregisterDashboardTools,
  webMcpRegistrationState,
} from "./webmcp.ts";
import { countsLabel, folderStatus, friendlyHarness, actorLabel } from "./gf-api.ts";

const now = new Date("2026-08-26T15:00:00Z").getTime();

const saves = [
  { seq: 3, label: "Added the Q3 totals", createdAt: "2026-08-26T14:00:00Z", harness: "claude-code", addedCount: 1, changedCount: 0, removedCount: 0, topPaths: ["totals.md"], changedPaths: ["totals.md"] },
  { seq: 2, label: "Rewrote the intro", createdAt: "2026-08-25T10:00:00Z", harness: null, deviceName: "Carlos's MacBook", addedCount: 0, changedCount: 2, removedCount: 1, topPaths: ["intro.md"], changedPaths: ["intro.md", "outline.md", "old-draft.md"] },
  { seq: 1, label: "First save", createdAt: "2026-08-24T09:00:00Z", addedCount: 5, changedCount: 0, removedCount: 0, topPaths: ["a.md"], changedPaths: ["a.md"] },
] as any[];

test("friendlyHarness maps known tools and tidies unknowns", () => {
  assert.equal(friendlyHarness("claude-code"), "Claude Code");
  assert.equal(friendlyHarness("Codex"), "Codex");
  assert.equal(friendlyHarness("some-weird-thing"), "Some-weird-thing");
  assert.equal(friendlyHarness(null), null);
});

test("countsLabel skips zero parts", () => {
  assert.equal(countsLabel({ addedCount: 0, changedCount: 2, removedCount: 0 }), "2 changed");
  assert.equal(countsLabel({ addedCount: 1, changedCount: 2, removedCount: 3 }), "1 added · 2 changed · 3 removed");
  assert.equal(countsLabel({}), "");
});

test("actorLabel prefers the tool, falls back to the device", () => {
  assert.equal(actorLabel({ harness: "codex", deviceName: "Mac" }), "saved by Codex");
  assert.equal(actorLabel({ harness: null, deviceName: "Carlos's MacBook" }), "saved on Carlos's MacBook");
  assert.equal(actorLabel({}), null);
});

test("folderStatus covers empty, fresh, and stale", () => {
  assert.deepEqual(folderStatus({ id: "x", name: "F", lastSeq: 0 }, now).kind, "empty");
  const fresh = folderStatus({ id: "x", name: "F", lastSeq: 3, lastSaveAt: "2026-08-26T14:00:00Z" }, now);
  assert.equal(fresh.kind, "current");
  assert.match((fresh as any).text, /just now|hour/);
});

test("toCompactSave renders receipt fields in plain language", () => {
  const c = toCompactSave(saves[1], now);
  assert.equal(c.number, 2);
  assert.equal(c.actor, "saved on Carlos's MacBook");
  assert.equal(c.counts, "2 changed · 1 removed");
  assert.deepEqual(c.topPaths, ["intro.md"]);
});

test("searchSaves matches labels and paths, case-insensitively", () => {
  assert.equal(searchSaves(saves, "q3").length, 1);
  assert.equal(searchSaves(saves, "INTRO").length, 1);
  assert.equal(searchSaves(saves, "zzz").length, 0);
});

test("explainSave surfaces attention for conflicting saves", () => {
  const plain = explainSave(saves[0], now);
  assert.equal(plain.attention, undefined);
  const flagged = explainSave({ ...saves[0], collision: "text-overlap" }, now);
  assert.match(flagged.attention ?? "", /human decision/);
});

test("computeRestorePreview unions paths of later saves only", () => {
  const p = computeRestorePreview(saves, 1) as any;
  assert.equal(p.restoreNumber, 1);
  assert.equal(p.affectedFileCount, 4); // totals.md, intro.md, outline.md, old-draft.md
  assert.match(p.howToRestore, /goodfolder restore 1/);
  assert.match(p.reversible, /undo/);
});

test("computeRestorePreview reports nothing-to-do and bad numbers", () => {
  const latest = computeRestorePreview(saves, 3) as any;
  assert.match(latest.explanation, /already matches/);
  const missing = computeRestorePreview(saves, 99) as any;
  assert.ok(missing.error);
});

test("site tools expose suggestions but never human review powers", () => {
  assert.equal(DASHBOARD_TOOL_NAMES.propose_document_change, true);
  assert.equal(DASHBOARD_TOOL_NAMES.comment_on_document, true);
  assert.equal(DASHBOARD_TOOL_NAMES.comment_on_change_proposal, true);
  const names = Object.keys(DASHBOARD_TOOL_NAMES).join(" ");
  assert.doesNotMatch(names, /accept|reject|invite|permission|delete|save_document/);
});

test("new workspace tools keep the existing read tools", () => {
  for (const name of ["list_folders", "get_timeline", "list_files", "read_selected_text", "read_file_context", "read_table_range", "get_document_history"]) {
    assert.equal((DASHBOARD_TOOL_NAMES as Record<string, boolean>)[name], true);
  }
  assert.equal(DASHBOARD_TOOL_NAMES.propose_file_change, true);
});

test("WebMCP registration is titled, idempotent, abort-aware, and reports state", async () => {
  const previous = (globalThis as { document?: unknown }).document;
  const calls: Array<Record<string, any>> = [];
  const registrationOptions: Array<{ signal?: AbortSignal }> = [];
  const fakeContext = {
    registerTool: async (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
      calls.push(tool);
      registrationOptions.push(options ?? {});
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: fakeContext, body: { dataset: {} } },
  });
  try {
    const first = await registerDashboardTools();
    assert.equal(first.length, Object.keys(DASHBOARD_TOOL_NAMES).length);
    assert.equal(calls.length, first.length);
    assert.equal(registrationOptions.length, first.length);
    assert.ok(registrationOptions.every((options) => options.signal instanceof AbortSignal));
    assert.equal(new Set(registrationOptions.map((options) => options.signal)).size, 1);
    assert.equal(registrationOptions[0]?.signal?.aborted, false);
    assert.ok(calls.every((tool) => typeof tool.title === "string" && tool.title.length > 0));
    assert.ok(calls.every((tool) => (tool.inputSchema as any)?.type === "object"));
    assert.ok(calls.every((tool) => (tool.annotations as any)?.readOnlyHint === true || (tool.annotations as any)?.untrustedContentHint === true));
    const generic = calls.find((tool) => tool.name === "propose_file_change");
    const alias = calls.find((tool) => tool.name === "propose_document_change");
    const read = calls.find((tool) => tool.name === "read_file_context");
    assert.ok(generic);
    assert.ok(alias);
    assert.ok(read);
    assert.deepEqual((generic.inputSchema as any).properties.operation.enum, ["text_replace", "table_update", "asset_replace"]);
    assert.equal((generic.annotations as any).untrustedContentHint, true);
    assert.equal((alias.annotations as any).untrustedContentHint, true);
    assert.equal((read.annotations as any).readOnlyHint, true);
    assert.equal((read.annotations as any).untrustedContentHint, true);

    const second = await registerDashboardTools();
    assert.deepEqual(second, first);
    assert.equal(calls.length, first.length);
    assert.equal(webMcpRegistrationState().status, "already-registered");

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => calls.find((tool) => tool.name === "list_folders")!.execute({}, { signal: controller.signal }),
      (error: Error) => error.name === "AbortError",
    );
  } finally {
    await unregisterDashboardTools();
    assert.ok(registrationOptions.every((options) => options.signal?.aborted));
    if (previous === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previous });
  }
});

test("propose_file_change only creates a review item and announces it", async () => {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const events: unknown[] = [];
  const fakeContext = { registerTool: async (tool: Record<string, unknown>) => tools.push(tool) };
  const tools: Array<Record<string, any>> = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: fakeContext, body: { dataset: {} } },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: "?folder=qa-folder&file=work.csv" },
      dispatchEvent: (event: unknown) => { events.push(event); return true; },
      getSelection: () => ({ toString: () => "" }),
    },
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/projects")) return new Response(JSON.stringify([{ id: "qa-folder", name: "QA" }]));
    if (url.endsWith("/api/projects/qa-folder/files")) return new Response(JSON.stringify({ role: "owner", head: "head-before", files: [{ path: "work.csv", size: 20, sha: "file-before", editable: true, previewable: true }] }));
    if (url.endsWith("/api/projects/qa-folder/proposals")) return new Response(JSON.stringify({ ok: true, proposalId: "proposal-1", title: "Update status", suggestionCount: 1, url: "https://trygoodfolder.com/dashboard?folder=qa-folder&proposal=proposal-1" }));
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    await registerDashboardTools();
    const tool = tools.find((item) => item.name === "propose_file_change");
    assert.ok(tool);
    const result = await tool.execute({
      document: "work.csv",
      operation: "table_update",
      changes: [{ address: "B2", before: "open", replacement: "done" }],
      explanation: "Close the completed item",
      title: "Update status",
    });
    assert.equal((result as any).changedDocument, false);
    assert.equal((result as any).reviewRequired, true);
    assert.equal(events.length, 1);
    assert.equal((events[0] as { type: string }).type, "proposal-created");
    const proposalRequest = calls.find((call) => call.url.endsWith("/api/projects/qa-folder/proposals"));
    assert.ok(proposalRequest);
    const body = JSON.parse(String(proposalRequest.init?.body));
    assert.equal(body.baseHead, null);
    assert.deepEqual(body.operation.changes, [{ address: "B2", before: "open", replacement: "done" }]);
    assert.equal(calls.some((call) => call.url.includes("/file?")), false);
  } finally {
    await unregisterDashboardTools();
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("bounded read tools expose line ranges, table cells, and grid selection", async () => {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousFetch = globalThis.fetch;
  const registered: Array<Record<string, any>> = [];
  const fakeContext = {
    registerTool: async (tool: Record<string, unknown>) => registered.push(tool),
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: fakeContext, body: { dataset: { gfSelectedCellAddress: "B2", gfSelectedCellValue: "open" } } },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { search: "?folder=qa-folder&file=work.csv" }, getSelection: () => ({ toString: () => "" }) },
  });
  const documentContent = "Task,Status\nClose Q3,open\nReview deck,done\n" + "x".repeat(50_000);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/projects")) return new Response(JSON.stringify([{ id: "qa-folder", name: "QA" }]));
    if (url.endsWith("/api/projects/qa-folder/file?path=work.csv")) {
      return new Response(JSON.stringify({ path: "work.csv", size: documentContent.length, sha: "sha", role: "owner", previewable: true, editable: true, previewKind: "text", content: documentContent }));
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    await registerDashboardTools();
    const context = registered.find((tool) => tool.name === "read_file_context");
    const range = registered.find((tool) => tool.name === "read_table_range");
    const selection = registered.find((tool) => tool.name === "read_selected_text");
    assert.ok(context && range && selection);
    const lines = await context.execute({ document: "work.csv", startLine: 2, lineCount: 1 });
    assert.deepEqual((lines as any).lines, [{ number: 2, text: "Close Q3,open" }]);
    const bounded = await context.execute({ document: "work.csv", startLine: 4, lineCount: 1 });
    assert.equal((bounded as any).truncated, true);
    assert.equal((bounded as any).lines[0].text.length, 40_000);
    const cells = await range.execute({ document: "work.csv", startRow: 1, startColumn: 1, rowCount: 2, columnCount: 2 });
    assert.deepEqual((cells as any).rows[1], [
      { address: "A2", value: "Close Q3" },
      { address: "B2", value: "open" },
    ]);
    assert.equal((cells as any).truncated, true);
    const selectedText = await selection.execute({});
    assert.equal((selectedText as any).selectionKind, "cell");
    assert.deepEqual((selectedText as any).cell, { address: "B2", value: "open" });
  } finally {
    await unregisterDashboardTools();
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});
