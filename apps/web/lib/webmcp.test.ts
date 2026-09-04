import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRestorePreview,
  decodeMediaDataUrl,
  explainSave,
  searchSaves,
  toCompactSave,
  DASHBOARD_TOOL_NAMES,
  registerDashboardTools,
  unregisterDashboardTools,
  webMcpRegistrationState,
} from "./webmcp.ts";
import { countsLabel, folderStatus, friendlyHarness, actorLabel } from "./gf-api.ts";
import { setPageRenderReport } from "./page-report.ts";

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
  const reviewTools = [
    "propose_file_change",
    "propose_document_change",
    "propose_document_media",
    "propose_generated_file",
    "propose_restore_file",
    "propose_new_goodfolder",
    "comment_on_change_proposal",
    "comment_on_document",
  ];
  const toolNames = Object.keys(DASHBOARD_TOOL_NAMES);

  assert.equal(toolNames.length, 25);
  assert.equal(reviewTools.length, 8);
  assert.equal(toolNames.filter((name) => !reviewTools.includes(name)).length, 17);
  assert.equal(DASHBOARD_TOOL_NAMES.get_local_save_guidance, true);
  assert.equal(DASHBOARD_TOOL_NAMES.read_image, true);
  assert.equal(DASHBOARD_TOOL_NAMES.get_page_render_report, true);
  assert.equal(DASHBOARD_TOOL_NAMES.propose_document_change, true);
  assert.equal(DASHBOARD_TOOL_NAMES.propose_document_media, true);
  assert.equal(DASHBOARD_TOOL_NAMES.comment_on_document, true);
  assert.equal(DASHBOARD_TOOL_NAMES.comment_on_change_proposal, true);
  const names = toolNames.join(" ");
  assert.doesNotMatch(names, /accept|reject|invite|permission|delete|save_document/);
});

test("propose_restore_file holds an earlier image version for human review", async () => {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const tools: Array<Record<string, any>> = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool: async (tool: Record<string, unknown>) => tools.push(tool) }, body: { dataset: {} } },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { search: "?folder=qa-folder&file=duck.png" }, dispatchEvent: () => true, getSelection: () => ({ toString: () => "" }) },
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/projects")) return new Response(JSON.stringify([{ id: "qa-folder", name: "QA" }]));
    if (url.endsWith("/api/projects/qa-folder/saves?paths=full")) {
      return new Response(JSON.stringify([{ seq: 1, label: "Added duck", createdAt: "2026-09-03T10:00:00Z", commitSha: "deadbeef", changedPaths: ["duck.png"] }]));
    }
    if (url.includes("/api/projects/qa-folder/file/raw?path=duck.png&ref=deadbeef")) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    }
    if (url.includes("/api/projects/qa-folder/staged-files?name=duck.png")) return new Response(JSON.stringify({ stagingId: "staged-duck", size: 3 }));
    if (url.endsWith("/api/projects/qa-folder/proposals")) return new Response(JSON.stringify({ proposalId: "proposal-restore", url: "https://trygoodfolder.com/dashboard?proposal=proposal-restore" }));
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    await registerDashboardTools();
    const tool = tools.find((item) => item.name === "propose_restore_file");
    assert.ok(tool);
    assert.equal((tool.annotations as any).readOnlyHint, false);
    const result = await tool.execute({ path: "duck.png", number: 1 });
    assert.equal((result as any).proposalId, "proposal-restore");
    assert.equal((result as any).reviewRequired, true);
    assert.equal((result as any).changedDocument, false);
    const proposal = calls.find((call) => call.url.endsWith("/proposals"));
    assert.ok(proposal);
    const body = JSON.parse(String(proposal!.init?.body));
    assert.equal(body.operation.path, "duck.png");
    assert.equal(body.operation.kind, "asset_replace");
    assert.equal(body.operation.stagingId, "staged-duck");
  } finally {
    await unregisterDashboardTools();
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("media data URLs accept bounded media and refuse other payloads", () => {
  const decoded = decodeMediaDataUrl("data:image/png;base64,aGVsbG8=");
  assert.ok(!("error" in decoded));
  if (!("error" in decoded)) {
    assert.equal(decoded.mimeType, "image/png");
    assert.equal(new TextDecoder().decode(decoded.bytes), "hello");
  }
  assert.deepEqual(decodeMediaDataUrl("data:text/plain;base64,aGVsbG8="), {
    error: "Give the media as a base64 image, video, or audio data URL.",
  });
});

test("new workspace tools keep the existing read tools", () => {
  for (const name of ["list_folders", "get_local_save_guidance", "get_timeline", "list_files", "read_selected_text", "read_file_context", "read_table_range", "get_document_history"]) {
    assert.equal((DASHBOARD_TOOL_NAMES as Record<string, boolean>)[name], true);
  }
  assert.equal(DASHBOARD_TOOL_NAMES.propose_file_change, true);
});

test("local save guidance keeps browser agents on the local MCP or CLI path", async () => {
  const previous = (globalThis as { document?: unknown }).document;
  const tools: Array<Record<string, any>> = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool: async (tool: Record<string, unknown>) => tools.push(tool) }, body: { dataset: {} } },
  });
  try {
    await registerDashboardTools();
    const guidance = tools.find((tool) => tool.name === "get_local_save_guidance");
    assert.ok(guidance);
    assert.equal((guidance.annotations as any).readOnlyHint, true);
    const result = await guidance.execute({});
    assert.equal(result.dashboardCanSaveLocalFolder, false);
    assert.match(result.requiredLocalActions.join(" "), /goodfolder_connect/);
    assert.match(result.requiredLocalActions.join(" "), /goodfolder_save/);
    assert.match(result.note, /Do not create a dashboard folder/);
  } finally {
    await unregisterDashboardTools();
    if (previous === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previous });
  }
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
    const media = calls.find((tool) => tool.name === "propose_document_media");
    const generatedFile = calls.find((tool) => tool.name === "propose_generated_file");
    const image = calls.find((tool) => tool.name === "read_image");
    const read = calls.find((tool) => tool.name === "read_file_context");
    assert.ok(generic);
    assert.ok(alias);
    assert.ok(media);
    assert.ok(generatedFile);
    assert.ok(image);
    assert.ok(read);
    assert.deepEqual((generic.inputSchema as any).properties.operation.enum, ["text_replace", "table_update", "asset_replace"]);
    assert.equal((generic.annotations as any).untrustedContentHint, true);
    assert.equal((alias.annotations as any).untrustedContentHint, true);
    assert.equal((media.annotations as any).untrustedContentHint, true);
    assert.equal((generatedFile.annotations as any).untrustedContentHint, true);
    assert.equal((image.annotations as any).readOnlyHint, true);
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

test("propose_document_media holds bytes outside the folder and creates one bundled review item", async () => {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const tools: Array<Record<string, any>> = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool: async (tool: Record<string, unknown>) => tools.push(tool) }, body: { dataset: {} } },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: "?folder=qa-folder&file=recipe.md" },
      dispatchEvent: () => true,
      getSelection: () => ({ toString: () => "" }),
    },
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/projects")) return new Response(JSON.stringify([{ id: "qa-folder", name: "QA" }]));
    if (url.endsWith("/api/projects/qa-folder/files")) {
      return new Response(JSON.stringify({ role: "owner", head: "head-before", files: [{ path: "recipe.md", size: 40, sha: "file-before", proposable: true }] }));
    }
    if (url.includes("/api/projects/qa-folder/staged-files?name=images%2Fdrink.png")) {
      return new Response(JSON.stringify({ ok: true, stagingId: "staged-1", size: 5 }));
    }
    if (url.endsWith("/api/projects/qa-folder/proposals")) {
      return new Response(JSON.stringify({ ok: true, proposalId: "proposal-media", title: "Add drink photo", suggestionCount: 2, url: "https://trygoodfolder.com/dashboard?folder=qa-folder&proposal=proposal-media" }));
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    await registerDashboardTools();
    const tool = tools.find((item) => item.name === "propose_document_media");
    assert.ok(tool);
    const result = await tool.execute({
      document: "recipe.md",
      assetPath: "images/drink.png",
      assetDataUrl: "data:image/png;base64,aGVsbG8=",
      anchorText: "## Steps",
      insertionText: "![Piña colada](images/drink.png)",
      placement: "before",
      section: "Between Ingredients and Steps",
      explanation: "Show the finished drink before the method.",
      title: "Add drink photo",
    });
    assert.equal((result as any).changedDocument, false);
    assert.equal((result as any).stagedOutsideFolder, true);
    assert.equal((result as any).reviewRequired, true);
    const staged = calls.find((call) => call.url.includes("/staged-files?"));
    assert.ok(staged?.init?.body instanceof Blob);
    assert.equal((staged!.init!.body as Blob).size, 5);
    const proposal = calls.find((call) => call.url.endsWith("/proposals"));
    assert.ok(proposal);
    const body = JSON.parse(String(proposal!.init?.body));
    assert.equal(body.suggestions.length, 2);
    assert.deepEqual(body.suggestions.map((suggestion: { kind: string; path: string }) => [suggestion.kind, suggestion.path]), [
      ["asset_replace", "images/drink.png"],
      ["text_replace", "recipe.md"],
    ]);
    assert.equal(body.suggestions[1].before, "## Steps");
    assert.equal(body.suggestions[1].replacement, "![Piña colada](images/drink.png)\n\n## Steps");
  } finally {
    await unregisterDashboardTools();
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("propose_generated_file holds every supported artifact for review without changing the folder", async () => {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const tools: Array<Record<string, any>> = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool: async (tool: Record<string, unknown>) => tools.push(tool) }, body: { dataset: {} } },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: "?folder=qa-folder&file=guide.md" },
      dispatchEvent: () => true,
      getSelection: () => ({ toString: () => "" }),
    },
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/projects")) return new Response(JSON.stringify([{ id: "qa-folder", name: "QA" }]));
    if (url.endsWith("/api/projects/qa-folder/files")) return new Response(JSON.stringify({ role: "owner", head: "head-before", files: [{ path: "guide.md", size: 40, sha: "file-before", proposable: true }] }));
    if (url.endsWith("/api/projects/qa-folder/generated-files")) return new Response(JSON.stringify({ ok: true, stagingId: "staged-file", size: 5 }));
    if (url.endsWith("/api/projects/qa-folder/proposals")) return new Response(JSON.stringify({ ok: true, proposalId: "proposal-deck", title: "Real Smooth presentation", suggestionCount: 1, url: "https://trygoodfolder.com/dashboard?folder=qa-folder&proposal=proposal-deck" }));
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    await registerDashboardTools();
    const tool = tools.find((item) => item.name === "propose_generated_file");
    assert.ok(tool);
    const result = await tool.execute({
      path: "real-smooth-deck.pptx",
      artifactType: "presentation",
      content: { slides: [{ title: "Real Smooth", body: "Brand guide presentation" }] },
      brand: { name: "Real Smooth", backgroundColor: "F7F1E8", accentColor: "E85D04", logoDataUrl: "data:image/png;base64,aGVsbG8=" },
      explanation: "A short deck based on the current brand guide.",
      title: "Real Smooth presentation",
    });
    assert.equal((result as any).changedDocument, false);
    assert.equal((result as any).stagedOutsideFolder, true);
    assert.equal((result as any).reviewRequired, true);
    const generated = calls.find((call) => call.url.endsWith("/generated-files"));
    assert.ok(generated);
    const generatedBody = JSON.parse(String(generated!.init?.body));
    assert.equal(generatedBody.artifactType, "presentation");
    assert.equal(generatedBody.brand.name, "Real Smooth");
    assert.equal(generatedBody.brand.logoDataUrl, "data:image/png;base64,aGVsbG8=");
    assert.deepEqual(generatedBody.content.slides, [{ title: "Real Smooth", body: "Brand guide presentation" }]);
    const proposal = calls.find((call) => call.url.endsWith("/proposals"));
    assert.ok(proposal);
    const body = JSON.parse(String(proposal!.init?.body));
    assert.equal(body.operation.path, "real-smooth-deck.pptx");
    assert.equal(body.operation.kind, "asset_replace");
    assert.equal(body.operation.stagingId, "staged-file");
  } finally {
    await unregisterDashboardTools();
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("read_image returns a bounded bitmap from the active GoodFolder without changing it", async () => {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  const tools: Array<Record<string, any>> = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool: async (tool: Record<string, unknown>) => tools.push(tool) }, body: { dataset: {} } },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { search: "?folder=qa-folder" }, dispatchEvent: () => true, getSelection: () => ({ toString: () => "" }) },
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/projects")) return new Response(JSON.stringify([{ id: "qa-folder", name: "QA" }]));
    if (url.endsWith("/api/projects/qa-folder/files")) return new Response(JSON.stringify({ role: "owner", files: [{ path: "logo.png", size: 5, sha: "logo", proposable: true }] }));
    if (url.includes("/api/projects/qa-folder/file/raw?path=logo.png")) return new Response(new Uint8Array([104, 101, 108, 108, 111]), { headers: { "content-type": "image/png" } });
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    await registerDashboardTools();
    const tool = tools.find((item) => item.name === "read_image");
    assert.ok(tool);
    const result = await tool.execute({ path: "logo.png" });
    assert.equal((result as any).path, "logo.png");
    assert.equal((result as any).mimeType, "image/png");
    assert.equal((result as any).dataUrl, "data:image/png;base64,aGVsbG8=");
    assert.ok(!calls.some((url) => /\/proposals|generated-files/.test(url)));
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

/** Drive propose_file_change against a stubbed folder listing. */
async function proposeAgainst(
  files: Array<Record<string, unknown>>,
  args: Record<string, unknown>,
): Promise<any> {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousFetch = globalThis.fetch;
  const tools: Array<Record<string, any>> = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool: async (t: Record<string, unknown>) => tools.push(t) }, body: { dataset: {} } },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: "?folder=qa-folder" },
      dispatchEvent: () => true,
      getSelection: () => ({ toString: () => "" }),
    },
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/projects")) return new Response(JSON.stringify([{ id: "qa-folder", name: "QA" }]));
    if (url.endsWith("/api/projects/qa-folder/files")) return new Response(JSON.stringify({ role: "owner", head: "h", files }));
    if (url.endsWith("/api/projects/qa-folder/proposals")) return new Response(JSON.stringify({ ok: true, proposalId: "p1", title: "t", suggestionCount: 1, url: "https://trygoodfolder.com/dashboard" }));
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    await registerDashboardTools();
    return await tools.find((t) => t.name === "propose_file_change")!.execute(args);
  } finally {
    await unregisterDashboardTools();
    globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
}

const textEdit = (document: string) => ({
  document,
  operation: "text_replace",
  originalText: "def old():",
  replacementText: "def new():",
  explanation: "Rename the function",
  title: "Rename",
});

test("a source file can be proposed against even though it cannot be typed into", async () => {
  const result = await proposeAgainst(
    [{ path: "api/server.py", size: 20, sha: "s", editable: false, proposable: true, previewable: true }],
    textEdit("api/server.py"),
  );
  assert.equal(result.error, undefined);
  assert.equal(result.changedDocument, false);
  assert.equal(result.reviewRequired, true, "still only the owner can accept it");
});

test("a file with no readable text is still refused", async () => {
  const result = await proposeAgainst(
    [{ path: "photos/cat.png", size: 20, sha: "s", editable: false, proposable: false, previewable: true }],
    textEdit("photos/cat.png"),
  );
  assert.match(String(result.error), /read as text/);
});

test("an older server that reports no proposable field refuses source files rather than guessing", async () => {
  // The browser deploys on push and the server does not, so there is a window
  // where this field is missing. Falling back to `editable` keeps the browser
  // and the server saying the same thing instead of promising a write the
  // server would then reject.
  const result = await proposeAgainst(
    [{ path: "api/server.py", size: 20, sha: "s", editable: false, previewable: true }],
    textEdit("api/server.py"),
  );
  assert.match(String(result.error), /read as text/);

  const stillFine = await proposeAgainst(
    [{ path: "notes.md", size: 20, sha: "s", editable: true, previewable: true }],
    textEdit("notes.md"),
  );
  assert.equal(stillFine.error, undefined, "documents keep working against an older server");
});

test("get_page_render_report answers with what the open page actually did", async () => {
  const previous = (globalThis as { document?: unknown }).document;
  const tools: Array<Record<string, any>> = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool: async (tool: Record<string, unknown>) => tools.push(tool) }, body: { dataset: {} } },
  });
  try {
    await registerDashboardTools();
    const tool = tools.find((entry) => entry.name === "get_page_render_report");
    assert.ok(tool);
    assert.equal((tool.annotations as any).readOnlyHint, true);

    // Nothing open: it says so rather than inventing a healthy report.
    setPageRenderReport(null);
    assert.match((await tool.execute({})).error, /Open an \.html file/);

    setPageRenderReport({
      folderId: "f1",
      path: "site/about.html",
      openedPath: "site/index.html",
      title: "about.html",
      at: "2026-09-04T12:00:00.000Z",
      carried: ["site/styles.css", "site/tour.webm"],
      streamed: ["site/tour.webm"],
      missing: ["site/hero.png"],
      fromTheWeb: ["https://cdn.example.com/a.js"],
      omitted: ["site/tour.mp4"],
      bytes: 2048,
      problems: [{ kind: "error", detail: "TypeError: chart is not a function (line 12)" }],
    });
    const report = await tool.execute({});
    assert.equal(report.page, "site/about.html");
    assert.equal(report.openedFrom, "site/index.html");
    assert.deepEqual(report.usedFromThisFolder, ["site/styles.css", "site/tour.webm"]);
    assert.deepEqual(report.tooBigToWriteInSoHandedOverWhenItRan, ["site/tour.webm"]);
    assert.deepEqual(report.askedForButNotInThisFolder, ["site/hero.png"]);
    assert.deepEqual(report.askedForFromTheWeb, ["https://cdn.example.com/a.js"]);
    assert.deepEqual(report.tooBigToInclude, ["site/tour.mp4"]);
    assert.deepEqual(report.problems, ["TypeError: chart is not a function (line 12)"]);
  } finally {
    setPageRenderReport(null);
    await unregisterDashboardTools();
    if (previous === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previous });
  }
});
