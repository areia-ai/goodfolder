import { test } from "node:test";
import assert from "node:assert/strict";
import type { BillingConfig, RepositoryAdapter, S3Client, Sql } from "@goodfolder/serverlib";
import { HostedBilling } from "./hosted-billing.ts";

type FakeSql = Sql & { queries: string[] };

function fakeSql(folderName: string | null): FakeSql {
  const queries: string[] = [];
  const query = async (strings: TemplateStringsArray) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(text);
    if (text.startsWith("SELECT name FROM projects")) return folderName === null ? [] : [{ name: folderName }];
    if (text.startsWith("SELECT COALESCE")) return [{ repositoryBytes: 0, objectBytes: 0 }];
    if (text.startsWith("SELECT total_bytes")) return [{ totalBytes: 0 }];
    return [];
  };
  const tagged = query as unknown as FakeSql;
  tagged.queries = queries;
  tagged.json = ((value: unknown) => value) as Sql["json"];
  tagged.begin = (async (work: (tx: Sql) => Promise<unknown>) => work(tagged)) as unknown as Sql["begin"];
  return tagged;
}

function fixture(folderName: string | null) {
  const sql = fakeSql(folderName);
  const prefixes: string[] = [];
  const deletedKeys: string[][] = [];
  const storage = {
    send: async (command: { input?: { Prefix?: string; Delete?: { Objects?: Array<{ Key?: string }> } } }) => {
      if (command.input?.Prefix) {
        prefixes.push(command.input.Prefix);
        return { Contents: [{ Key: `${command.input.Prefix}one` }] };
      }
      const keys = command.input?.Delete?.Objects?.flatMap((item) => item.Key ? [item.Key] : []) ?? [];
      deletedKeys.push(keys);
      return {};
    },
  } as unknown as S3Client;
  const removed: string[] = [];
  const repos = {
    deleteRepo: async (projectId: string) => { removed.push(projectId); },
  } as unknown as RepositoryAdapter;
  const billing = new HostedBilling(sql, { stripe: null } as unknown as BillingConfig, repos, storage, "test-bucket");
  return { billing, sql, prefixes, deletedKeys, removed };
}

test("folder deletion refuses a wrong name before removing anything", async () => {
  const testCase = fixture("recipes");
  assert.deepEqual(
    await testCase.billing.deleteFolder("account-1", "folder-1", "Recipes", "owner@example.com"),
    { status: "confirmation" },
  );
  assert.deepEqual(testCase.prefixes, []);
  assert.deepEqual(testCase.removed, []);
  assert.equal(testCase.sql.queries.some((query) => query.startsWith("DELETE FROM")), false);
});

test("folder deletion is owner-scoped", async () => {
  const testCase = fixture(null);
  assert.deepEqual(
    await testCase.billing.deleteFolder("contributor-1", "folder-1", "recipes", "guest@example.com"),
    { status: "not-found" },
  );
  assert.deepEqual(testCase.prefixes, []);
  assert.deepEqual(testCase.removed, []);
});

test("confirmed folder deletion removes stored and waiting files, backing data, and database rows", async () => {
  const testCase = fixture("recipes");
  assert.deepEqual(
    await testCase.billing.deleteFolder("account-1", "folder-1", "recipes", "owner@example.com"),
    { status: "deleted", name: "recipes", objects: 2 },
  );
  assert.deepEqual(testCase.prefixes, ["folder-1/", "staging/folder-1/"]);
  assert.deepEqual(testCase.deletedKeys, [["folder-1/one"], ["staging/folder-1/one"]]);
  assert.deepEqual(testCase.removed, ["folder-1"]);
  assert.equal(testCase.sql.queries.some((query) => query.startsWith("DELETE FROM saves")), true);
  assert.equal(testCase.sql.queries.some((query) => query.startsWith("DELETE FROM transfer_tokens")), true);
  assert.equal(testCase.sql.queries.some((query) => query.startsWith("DELETE FROM devices")), true);
  assert.equal(testCase.sql.queries.some((query) => query.startsWith("DELETE FROM projects")), true);
  assert.equal(testCase.sql.queries.some((query) => query.includes("'project.delete'")), true);
});
