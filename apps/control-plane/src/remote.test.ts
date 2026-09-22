import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileChange, RepositoryAdapter, Sql } from "@goodfolder/serverlib";
import {
  REMOTE_REVERT_FILE_CAP,
  applyRevert,
  countsOf,
  previewRevert,
  exclusionsFor,
  readSkippedReport,
  recordRemoteSave,
  runnerRun,
  screenLandedPush,
  screenSaveChanges,
  treeChanges,
  type RemoteDeps,
  type TreeEntry,
} from "./remote.ts";

const blob = (path: string, sha: string, size = 10): TreeEntry => ({ path, type: "blob", sha, size });

function fakeSql(options: { nextSeq?: number; latest?: { seq: number; label: string; commitSha: string } | null } = {}): Sql & { queries: string[] } {
  const queries: string[] = [];
  const query = async (strings: TemplateStringsArray) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(text);
    if (text.startsWith("INSERT INTO saves")) return [{ seq: options.nextSeq ?? 7 }];
    if (text.startsWith("SELECT seq, label, commit_sha")) {
      return options.latest ? [{ seq: options.latest.seq, label: options.latest.label, commitSha: options.latest.commitSha }] : [];
    }
    if (text.startsWith("SELECT seq, label, \"commitSha\"") || text.startsWith("SELECT seq, label, commit_sha AS")) return [];
    if (text.includes("FROM webhook_endpoints")) return [];
    return [];
  };
  const tagged = query as unknown as Sql & { queries: string[] };
  tagged.queries = queries;
  tagged.json = ((value: unknown) => value) as Sql["json"];
  return tagged;
}

interface FixtureOptions {
  head?: string | null;
  trees?: Record<string, TreeEntry[]>;
  files?: Record<string, { content: Buffer; sha: string; size: number }>;
  denied?: { code: string; message: string; status: number } | null;
  nextSeq?: number;
  latest?: { seq: number; label: string; commitSha: string } | null;
}

function fixture(options: FixtureOptions = {}) {
  const calls: { head: number; changeFiles: FileChange[][]; messages: string[] } = { head: 0, changeFiles: [], messages: [] };
  const repos = {
    head: async () => {
      calls.head += 1;
      return options.head ?? null;
    },
    tree: async (_projectId: string, ref = "main") => options.trees?.[ref] ?? [],
    readFile: async (_projectId: string, path: string, ref = "main") => options.files?.[`${ref}:${path}`] ?? null,
    changeFiles: async (input: { changes: FileChange[]; message: string }) => {
      calls.changeFiles.push([...input.changes]);
      calls.messages.push(input.message);
      return { commitSha: "head-new" };
    },
  } as unknown as RepositoryAdapter;
  const sql = fakeSql({
    ...(options.nextSeq === undefined ? {} : { nextSeq: options.nextSeq }),
    latest: options.latest ?? null,
  });
  const deps: RemoteDeps = {
    sql,
    repos,
    writeAccessError: async () => options.denied ?? null,
    refreshUsage: () => {},
    labelFor: async (_ai, userLabel) => (userLabel ? { label: userLabel, source: "user" } : { label: "Saved changes", source: "agent" }),
  };
  return { deps, sql, repos, calls };
}

test("treeChanges names what arrived, changed, and left, in path order", () => {
  const changes = treeChanges(
    [blob("kept.md", "a"), blob("edited.md", "b"), blob("gone.md", "c")],
    [blob("kept.md", "a"), blob("edited.md", "b2"), blob("added.md", "d")],
  );
  assert.deepEqual(changes, [
    { path: "added.md", kind: "added", size: 10 },
    { path: "edited.md", kind: "changed", size: 10 },
    { path: "gone.md", kind: "removed", size: 10 },
  ]);
  assert.deepEqual(countsOf(changes), { added: 1, changed: 1, removed: 1 });
});

test("runnerRun counts the contiguous run at the top, never the whole timeline", () => {
  const row = (harness: string | null) => ({ harness });
  assert.equal(runnerRun([row("Instinct"), row("Instinct"), row("Instinct"), row("Codex")]), 3);
  assert.equal(runnerRun([row("Instinct"), row("Codex"), row("Instinct")]), 1);
  assert.equal(runnerRun([row(null), row(null)]), 1);
  assert.equal(runnerRun([row("Instinct")]), 1);
});

test("previewRevert compares the standing tree with the target save", async () => {
  const { deps } = fixture({
    head: "head-2",
    trees: {
      main: [blob("kept.md", "a"), blob("edited.md", "b2")],
      "save-1": [blob("kept.md", "a"), blob("edited.md", "b"), blob("restored.md", "c")],
    },
  });
  const preview = await previewRevert(deps, "folder-1", { seq: 1, label: "Earlier", commitSha: "save-1" });
  assert.equal(preview.status, "preview");
  if (preview.status !== "preview") return;
  assert.deepEqual(preview.changes.map((change) => change.path), ["edited.md", "restored.md"]);
  assert.deepEqual(preview.counts, { added: 1, changed: 1, removed: 0 });
  assert.deepEqual(preview.collisions, []);
});

test("previewRevert says so when the folder already matches", async () => {
  const { deps } = fixture({ head: "same", trees: { main: [blob("a.md", "a")], same: [blob("a.md", "a")] } });
  const preview = await previewRevert(deps, "folder-1", { seq: 2, label: "Now", commitSha: "same" });
  assert.equal(preview.status, "unchanged");
});

test("applyRevert refuses a target that would introduce a name collision", async () => {
  const { deps, calls } = fixture({
    head: "head-2",
    trees: {
      main: [blob("notes.md", "a")],
      "save-1": [blob("README.md", "b"), blob("readme.md", "c")],
    },
  });
  const outcome = await applyRevert(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    target: { seq: 1, label: "Earlier", commitSha: "save-1" },
    label: "Restored save #1",
    harness: "Instinct",
  });
  assert.equal(outcome.status, "refused");
  if (outcome.status !== "refused") return;
  assert.equal(outcome.code, "name-collision");
  assert.equal(calls.changeFiles.length, 0);
});

test("applyRevert refuses an enormous remote change instead of guessing", async () => {
  const many = Array.from({ length: REMOTE_REVERT_FILE_CAP + 1 }, (_, i) => blob(`file-${i}.md`, `sha-${i}`));
  const { deps, calls } = fixture({ head: "head-2", trees: { main: [], "save-1": many } });
  const outcome = await applyRevert(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    target: { seq: 1, label: "Earlier", commitSha: "save-1" },
    label: "Restored save #1",
    harness: "Instinct",
  });
  assert.equal(outcome.status, "refused");
  if (outcome.status !== "refused") return;
  assert.equal(outcome.code, "too-large");
  assert.equal(calls.changeFiles.length, 0);
});

test("applyRevert writes the target state and records a new save", async () => {
  const { deps, calls } = fixture({
    head: "head-2",
    nextSeq: 9,
    trees: {
      main: [blob("kept.md", "a"), blob("edited.md", "b2"), blob("gone.md", "c")],
      "save-1": [blob("kept.md", "a"), blob("edited.md", "b"), blob("back.md", "d")],
    },
    files: {
      "save-1:edited.md": { content: Buffer.from("old"), sha: "b", size: 3 },
      "save-1:back.md": { content: Buffer.from("back"), sha: "d", size: 4 },
    },
  });
  const outcome = await applyRevert(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    target: { seq: 1, label: "Earlier", commitSha: "save-1" },
    label: "Restored save #1: Earlier",
    harness: "Instinct",
  });
  assert.equal(outcome.status, "applied");
  if (outcome.status !== "applied") return;
  assert.equal(outcome.seq, 9);
  assert.equal(outcome.head, "head-new");
  assert.deepEqual(calls.changeFiles[0]!.map((change) => [change.operation, change.path]), [
    ["write", "back.md"],
    ["write", "edited.md"],
    ["remove", "gone.md"],
  ]);
  assert.equal(calls.messages[0], "Restored save #1: Earlier");
});

test("applyRevert refuses when the account may not write", async () => {
  const { deps, calls } = fixture({
    head: "head-2",
    denied: { code: "read-only", message: "Read and export mode.", status: 403 },
  });
  const outcome = await applyRevert(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    target: { seq: 1, label: "Earlier", commitSha: "save-1" },
    label: "Restored save #1",
    harness: null,
  });
  assert.equal(outcome.status, "refused");
  assert.equal(calls.changeFiles.length, 0);
});

test("recordRemoteSave computes the receipt from the folder's own trees", async () => {
  const { deps, sql } = fixture({
    head: "head-2",
    nextSeq: 12,
    latest: { seq: 3, label: "Before", commitSha: "head-1" },
    trees: {
      main: [blob("kept.md", "a"), blob("added.md", "d")],
      "head-1": [blob("kept.md", "a"), blob("gone.md", "c")],
    },
  });
  const outcome = await recordRemoteSave(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    label: "Added the plan",
    harness: "Instinct",
  });
  assert.equal(outcome.status, "recorded");
  if (outcome.status !== "recorded") return;
  assert.equal(outcome.seq, 12);
  assert.equal(outcome.label, "Added the plan");
  assert.deepEqual(outcome.counts, { added: 1, changed: 0, removed: 1 });
  assert.equal(sql.queries.some((query) => query.startsWith("INSERT INTO saves")), true);
});

test("recordRemoteSave says nothing new when the folder matches its latest save", async () => {
  const { deps, calls } = fixture({
    head: "head-1",
    latest: { seq: 3, label: "Before", commitSha: "head-1" },
  });
  const outcome = await recordRemoteSave(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    harness: null,
  });
  assert.equal(outcome.status, "unchanged");
  assert.equal(calls.changeFiles.length, 0);
});

const added = (path: string) => ({ path, kind: "added" as const });
const changed = (path: string) => ({ path, kind: "changed" as const });

test("screenSaveChanges flags credentials and ignored paths, and warns on secret names", () => {
  const present = new Set([".env", "clip.mov", "notes.md", "Secret plan.txt", "package.json"]);
  const result = screenSaveChanges(
    [".env", "clip.mov", "notes.md", "Secret plan.txt", "deliberate.pem"].map(added),
    {
      presentInTree: new Set([...present, "deliberate.pem"]),
      ignorePatterns: ["*.mov"],
      includedOnPurpose: ["deliberate.pem"],
    },
  );
  assert.deepEqual(result.flagged, [
    { path: ".env", pattern: ".env", kind: "credentials", deliberate: false },
    { path: "clip.mov", pattern: "*.mov", kind: "ignored", deliberate: false },
    { path: "deliberate.pem", pattern: "*.pem", kind: "credentials", deliberate: true },
  ]);
  assert.deepEqual(result.warnings, [{ path: "Secret plan.txt", pattern: "*secret*", change: "added" }]);
});

test("screenSaveChanges warns on a changed secret-named file, but never flags one", () => {
  const present = new Set(["Secret plan.txt", ".env", "notes.md"]);
  const result = screenSaveChanges(
    [changed("Secret plan.txt"), changed(".env"), changed("notes.md")],
    { presentInTree: present, ignorePatterns: [], includedOnPurpose: [] },
  );
  // A changed file was let in by an earlier decision — no flag, even when the
  // name is credential-shaped. The warn tier does re-flag it.
  assert.deepEqual(result.flagged, []);
  assert.deepEqual(result.warnings, [{ path: "Secret plan.txt", pattern: "*secret*", change: "changed" }]);
});

test("screenSaveChanges never evaluates a removed path", () => {
  const result = screenSaveChanges(
    [{ path: "Secret plan.txt", kind: "removed" }],
    { presentInTree: new Set(), ignorePatterns: [], includedOnPurpose: [] },
  );
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.flagged, []);
});

test("recordRemoteSave screens what the trees show, not what the caller claims", async () => {
  const { deps, sql } = fixture({
    head: "head-2",
    nextSeq: 12,
    latest: { seq: 3, label: "Before", commitSha: "head-1" },
    trees: {
      main: [blob("kept.md", "a"), blob(".env", "s"), blob("clip.mov", "m"), blob(".goodfolderignore", "i")],
      "head-1": [blob("kept.md", "a"), blob(".goodfolderignore", "i")],
    },
    files: { "head-2:.goodfolderignore": { content: Buffer.from("*.mov\n"), sha: "i", size: 6 } },
  });
  const outcome = await recordRemoteSave(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    harness: "Instinct",
  });
  assert.equal(outcome.status, "recorded");
  if (outcome.status !== "recorded") return;
  assert.deepEqual(outcome.flagged, [
    { path: ".env", pattern: ".env", kind: "credentials", deliberate: false },
    { path: "clip.mov", pattern: "*.mov", kind: "ignored", deliberate: false },
  ]);
  // The alarm fires where the push lands, not here — recording only reports.
  assert.equal(sql.queries.some((query) => query.includes("'save.flagged'")), false);
});

test("recordRemoteSave warns again when an existing secret-named file changes", async () => {
  const { deps } = fixture({
    head: "head-2",
    nextSeq: 12,
    latest: { seq: 3, label: "Before", commitSha: "head-1" },
    trees: {
      main: [blob("Secret plan.txt", "b2"), blob("kept.md", "a")],
      "head-1": [blob("Secret plan.txt", "b"), blob("kept.md", "a")],
    },
  });
  const outcome = await recordRemoteSave(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    harness: "Instinct",
  });
  assert.equal(outcome.status, "recorded");
  if (outcome.status !== "recorded") return;
  assert.deepEqual(outcome.warnings, [{ path: "Secret plan.txt", pattern: "*secret*", change: "changed" }]);
  assert.deepEqual(outcome.flagged, []);
});

test("recordRemoteSave says nothing about a secret-named file leaving", async () => {
  const { deps } = fixture({
    head: "head-2",
    nextSeq: 12,
    latest: { seq: 3, label: "Before", commitSha: "head-1" },
    trees: {
      main: [blob("kept.md", "a")],
      "head-1": [blob("Secret plan.txt", "b"), blob("kept.md", "a")],
    },
  });
  const outcome = await recordRemoteSave(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    harness: "Instinct",
  });
  assert.equal(outcome.status, "recorded");
  if (outcome.status !== "recorded") return;
  assert.deepEqual(outcome.warnings, []);
  assert.deepEqual(outcome.flagged, []);
});

test("recordRemoteSave records anyway when the tree cannot be read", async () => {
  const { deps, repos } = fixture({
    head: "head-2",
    nextSeq: 12,
    latest: { seq: 3, label: "Before", commitSha: "head-1" },
    trees: {
      main: [blob("kept.md", "a"), blob("added.md", "d")],
      "head-1": [blob("kept.md", "a")],
    },
  });
  const original = repos.readFile;
  (repos as { readFile: unknown }).readFile = async () => { throw new Error("store down"); };
  const outcome = await recordRemoteSave(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    harness: null,
  });
  assert.equal(outcome.status, "recorded");
  if (outcome.status !== "recorded") return;
  assert.deepEqual(outcome.warnings, []);
  assert.deepEqual(outcome.flagged, []);
  void original;
});

test("screenLandedPush raises the alarm when a push lands left-out files", async () => {
  const { deps, sql } = fixture({
    head: "head-2",
    trees: {
      "head-2": [blob("kept.md", "a"), blob(".env", "s"), blob("clip.mov", "m"), blob(".goodfolderignore", "i")],
      "head-1": [blob("kept.md", "a"), blob(".goodfolderignore", "i")],
    },
    files: { "head-2:.goodfolderignore": { content: Buffer.from("*.mov\n"), sha: "i", size: 6 } },
  });
  await screenLandedPush(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    before: "head-1",
    actor: "Instinct",
  });
  const audit = sql.queries.find((q) => q.includes("'save.flagged'"));
  assert.ok(audit, "one audit insert");
  assert.ok(
    sql.queries.some((q) => q.includes("FROM webhook_endpoints")),
    "the webhook fan-out ran",
  );
});

test("screenLandedPush does nothing when the head did not move", async () => {
  const { deps, sql } = fixture({ head: "head-1", trees: { "head-1": [blob("a.md", "a")] } });
  await screenLandedPush(deps, { projectId: "folder-1", accountId: "account-1", before: "head-1", actor: "folder" });
  assert.equal(sql.queries.some((q) => q.includes("'save.flagged'")), false);
});

test("screenLandedPush swallows a dead adapter", async () => {
  const { deps, repos } = fixture({ head: "head-2" });
  (repos as { head: unknown }).head = async () => { throw new Error("store down"); };
  await screenLandedPush(deps, { projectId: "folder-1", accountId: "account-1", before: "head-1", actor: "folder" });
});

test("readSkippedReport reads only a well-formed report", () => {
  // No report at all: absent, wrong type, or a non-object body.
  assert.equal(readSkippedReport({}), null);
  assert.equal(readSkippedReport({ skipped: "nope" }), null);
  assert.equal(readSkippedReport(null), null);

  const result = readSkippedReport({
    skipped: [
      { path: ".env", source: "built-in", category: "credentials", pattern: ".env", reason: "looks like it holds passwords or keys" },
      { path: "clip.mov", source: "ignore-list", pattern: "*.mov", reason: "on your ignore list" },
      { path: 42, source: "built-in" },                       // path not a string — dropped
      { path: "x.md", source: "made-up" },                    // unknown source — dropped
      "not an object",                                        // dropped
      { path: "y.log", source: "their-own" },                 // pattern/reason default to ""
      { path: "z.pem", source: "built-in", category: "bogus" }, // bad category dropped
    ],
    skippedTotal: 7.9,
  });
  assert.ok(result);
  assert.deepEqual(result.entries.map((e) => e.path), [".env", "clip.mov", "y.log", "z.pem"]);
  assert.equal(result.entries[0]!.category, "credentials");
  assert.equal(result.entries[2]!.pattern, "");
  assert.equal(result.entries[2]!.reason, "");
  assert.equal(result.entries[3]!.category, undefined);
  assert.equal(result.total, 7);
});

test("readSkippedReport caps the list, clips the strings, and clamps the total", () => {
  const many = Array.from({ length: 250 }, (_, i) => ({
    path: `f${i}.env`, source: "built-in", pattern: ".env", reason: "x",
  }));
  const result = readSkippedReport({ skipped: many, skippedTotal: 999_999_999 });
  assert.ok(result);
  assert.equal(result.entries.length, 200);
  assert.equal(result.total, 10_000_000);
  const long = readSkippedReport({
    skipped: [{ path: "p".repeat(600), source: "built-in", pattern: "x".repeat(300), reason: "r".repeat(300) }],
  });
  assert.equal(long?.entries[0]?.path.length, 512);
  assert.equal(long?.entries[0]?.pattern.length, 200);
  // A total smaller than the entries is lifted to match.
  const low = readSkippedReport({ skipped: many.slice(0, 3), skippedTotal: 1 });
  assert.equal(low?.total, 3);
});

test("recordRemoteSave stores the device's left-out report, or its absence", async () => {
  const withReport = fixture({
    head: "head-2",
    nextSeq: 5,
    latest: { seq: 4, label: "Before", commitSha: "head-1" },
    trees: {
      main: [blob("kept.md", "a"), blob("added.md", "d")],
      "head-1": [blob("kept.md", "a")],
    },
  });
  const outcome = await recordRemoteSave(withReport.deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    harness: "Instinct",
    skippedReport: {
      entries: [{ path: ".env", source: "built-in", category: "credentials", pattern: ".env", reason: "secret" }],
      total: 3,
    },
  });
  assert.equal(outcome.status, "recorded");
  if (outcome.status !== "recorded") return;
  assert.equal(outcome.skipped.length, 1);
  assert.equal(outcome.skippedTotal, 3);
  assert.equal(outcome.skippedReportedBy, "device");

  const without = fixture({
    head: "head-2",
    nextSeq: 5,
    latest: { seq: 4, label: "Before", commitSha: "head-1" },
    trees: {
      main: [blob("kept.md", "a"), blob("added.md", "d")],
      "head-1": [blob("kept.md", "a")],
    },
  });
  const plain = await recordRemoteSave(without.deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    harness: "Instinct",
  });
  assert.equal(plain.status, "recorded");
  if (plain.status !== "recorded") return;
  assert.deepEqual(plain.skipped, []);
  assert.equal(plain.skippedTotal, 0);
  assert.equal(plain.skippedReportedBy, null);
});

test("exclusionsFor answers with no history, no list, and a list with bad lines", async () => {
  // Nothing saved yet.
  const empty = await exclusionsFor(fixture({ head: null }).deps, "folder-1");
  assert.equal(empty.at, null);
  assert.equal(empty.ignoreFile.present, false);
  assert.ok(empty.builtIn.skip.length > 0);
  assert.ok(empty.builtIn.skip.some((r) => r.pattern === ".env" && r.category === "credentials" && r.label.length > 0));
  assert.ok(empty.builtIn.skip.some((r) => r.pattern === "dist/" && r.needs === "package.json"));
  assert.ok(empty.builtIn.warn.includes("*secret*"));
  assert.ok(empty.deviceOnly.includes("their-own"));

  // A head with no ignore file.
  const noList = await exclusionsFor(
    fixture({ head: "h1", trees: { h1: [blob("a.md", "a")] } }).deps,
    "folder-1",
  );
  assert.equal(noList.at, "h1");
  assert.equal(noList.ignoreFile.present, false);

  // Valid and invalid lines both surface.
  const listed = await exclusionsFor(
    fixture({
      head: "h1",
      trees: { h1: [blob("a.md", "a"), blob(".goodfolderignore", "i")] },
      files: { "h1:.goodfolderignore": { content: Buffer.from("*.mov\n!bad\n# note\n"), sha: "i", size: 16 } },
    }).deps,
    "folder-1",
  );
  assert.equal(listed.ignoreFile.present, true);
  assert.deepEqual(listed.ignoreFile.patterns, ["*.mov"]);
  assert.equal(listed.ignoreFile.invalid.length, 1);
  assert.equal(listed.ignoreFile.invalid[0]!.line, 2);
});

test("recordRemoteSave refuses a stale expected state", async () => {
  const { deps } = fixture({
    head: "head-2",
    latest: { seq: 3, label: "Before", commitSha: "head-1" },
  });
  const outcome = await recordRemoteSave(deps, {
    projectId: "folder-1",
    accountId: "account-1",
    actorDeviceId: "device-1",
    actorName: "Instinct",
    harness: null,
    expectedHead: "head-1",
  });
  assert.equal(outcome.status, "refused");
  if (outcome.status !== "refused") return;
  assert.equal(outcome.code, "newer-work");
});
