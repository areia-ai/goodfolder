import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileChange, RepositoryAdapter, Sql } from "@goodfolder/serverlib";
import {
  LABEL_WAIT_MS,
  recordRemoteSave,
  writeLateLabel,
  type RemoteDeps,
  type TreeEntry,
} from "./remote.ts";

function fakeSql() {
  const queries: { text: string; values: unknown[] }[] = [];
  const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    if (text.startsWith("INSERT INTO saves")) return [{ id: "save-1", seq: 7 }];
    return [];
  };
  const tagged = query as unknown as Sql & { queries: typeof queries };
  tagged.queries = queries;
  tagged.json = ((value: unknown) => value) as Sql["json"];
  tagged.begin = (async (work: (tx: Sql) => Promise<unknown>) => work(tagged)) as unknown as Sql["begin"];
  return tagged;
}

function fixture(labelFor: RemoteDeps["labelFor"]) {
  const sql = fakeSql();
  const blob = (path: string, sha: string): TreeEntry => ({ path, type: "blob", sha, size: 10 });
  const repos = {
    head: async () => "head-new",
    tree: async (_projectId: string, ref = "main") => (ref === "main" ? [blob("a.md", "1")] : []),
    readFile: async () => null,
    changeFiles: async (_input: { changes: FileChange[] }) => ({ commitSha: "head-new" }),
  } as unknown as RepositoryAdapter;
  const deps: RemoteDeps = {
    sql,
    repos,
    writeAccessError: async () => null,
    refreshUsage: () => {},
    labelFor,
  };
  return { deps, sql };
}

const input = {
  projectId: "project-1",
  accountId: "account-1",
  actorDeviceId: "device-1",
  actorName: "web",
  harness: null,
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("a label that answers in time is the one recorded", async () => {
  const { deps, sql } = fixture(
    async () => new Promise<{ label: string; source: "user" | "agent" }>((resolve) =>
      setTimeout(() => resolve({ label: "Wrote the itinerary", source: "agent" }), 20)),
  );
  const outcome = await recordRemoteSave(deps, input);
  assert.equal(outcome.status, "recorded");
  assert.equal(outcome.label, "Wrote the itinerary");
  assert.equal(sql.queries.some((q) => q.text.startsWith("UPDATE saves SET label")), false);
});

test("a label past the budget records the fallback, then writes in", async () => {
  let resolveModel: (label: string | null) => void = () => {};
  const model = new Promise<string | null>((resolve) => (resolveModel = resolve));
  const { deps, sql } = fixture(async () => ({
    label: "Updated files (1 added, 0 changed, 0 removed)",
    source: "agent",
    late: model,
  }));
  const outcome = await recordRemoteSave(deps, input);
  assert.equal(outcome.status, "recorded");
  assert.equal(outcome.label, "Updated files (1 added, 0 changed, 0 removed)");
  assert.equal(sql.queries.some((q) => q.text.startsWith("UPDATE saves SET label")), false);
  resolveModel("Wrote the itinerary");
  await tick();
  const update = sql.queries.find((q) => q.text.startsWith("UPDATE saves SET label"));
  assert.equal(update?.text, "UPDATE saves SET label = ? WHERE id = ? AND label = ?");
  assert.deepEqual(update?.values, ["Wrote the itinerary", "save-1", "Updated files (1 added, 0 changed, 0 removed)"]);
});

test("a failed model label is never written", async () => {
  const { deps, sql } = fixture(async () => ({
    label: "Updated files (1 added, 0 changed, 0 removed)",
    source: "agent",
    late: Promise.resolve(null),
  }));
  const outcome = await recordRemoteSave(deps, input);
  assert.equal(outcome.status, "recorded");
  await tick();
  assert.equal(sql.queries.some((q) => q.text.startsWith("UPDATE saves SET label")), false);
});

test("writeLateLabel never touches a label someone changed", async () => {
  const sql = fakeSql();
  writeLateLabel(sql, "save-1", "Updated files", Promise.resolve("Wrote the itinerary"));
  await tick();
  const update = sql.queries.find((q) => q.text.startsWith("UPDATE saves SET label"));
  // The AND clause pins the write to the recorded fallback, so an edit made
  // meanwhile is kept.
  assert.equal(update?.text, "UPDATE saves SET label = ? WHERE id = ? AND label = ?");
  assert.deepEqual(update?.values, ["Wrote the itinerary", "save-1", "Updated files"]);
});

test("the label budget is a few seconds", () => {
  assert.equal(LABEL_WAIT_MS, 4_000);
});
