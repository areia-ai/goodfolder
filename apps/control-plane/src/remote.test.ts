import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileChange, RepositoryAdapter, Sql } from "@goodfolder/serverlib";
import {
  REMOTE_REVERT_FILE_CAP,
  applyRevert,
  countsOf,
  previewRevert,
  recordRemoteSave,
  runnerRun,
  screenLandedPush,
  screenSavedAdds,
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

test("screenSavedAdds flags credentials and ignored paths, and warns on secret names", () => {
  const present = new Set([".env", "clip.mov", "notes.md", "Secret plan.txt", "package.json"]);
  const result = screenSavedAdds(
    [".env", "clip.mov", "notes.md", "Secret plan.txt", "deliberate.pem"],
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
  assert.deepEqual(result.warnings, [{ path: "Secret plan.txt", pattern: "*secret*" }]);
});

test("screenSavedAdds only ever sees added paths — changed ones are not flagged", () => {
  // The caller filters to kind === "added" before calling, so a .env that was
  // merely edited is not news. Feeding an added path is what flags.
  const present = new Set([".env", "notes.md"]);
  const result = screenSavedAdds(["notes.md"], { presentInTree: present, ignorePatterns: [], includedOnPurpose: [] });
  assert.deepEqual(result.flagged, []);
  assert.deepEqual(result.warnings, []);
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
