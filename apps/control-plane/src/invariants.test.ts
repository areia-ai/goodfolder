import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) yield path;
  }
}

describe("save row writes", () => {
  test("a save row is only ever written through insertSave", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const text = readFileSync(file, "utf8");
      const count = text.split("INSERT INTO saves").length - 1;
      if (count > 0) hits.push(`${file}:${count}`);
      if (file !== join(SRC_DIR, "remote.ts")) {
        assert.ok(!text.includes("COALESCE(MAX(s.seq)"), `${file} sequences saves outside remote.ts`);
        assert.ok(!text.includes("MAX(seq), 0) + 1"), `${file} sequences saves outside remote.ts`);
      }
    }
    assert.deepEqual(hits, [`${join(SRC_DIR, "remote.ts")}:1`]);
  });
});

const INFRA_DIR = join(SRC_DIR, "..", "..", "..", "infra");

/** The (table, firstColumn) pairs schema.sql can serve without a scan. */
function indexedFirstColumns(schema: string): Set<string> {
  const indexed = new Set<string>();
  for (const m of schema.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+(\w+)\s*\(\s*(\w+)/g)) {
    indexed.add(`${m[1]}.${m[2]}`);
  }
  for (const tm of schema.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    for (const line of tm[2]!.split("\n")) {
      const constraint = /^\s*(?:PRIMARY\s+KEY|UNIQUE)\s*\(\s*(\w+)/.exec(line);
      if (constraint) indexed.add(`${tm[1]}.${constraint[1]}`);
    }
  }
  return indexed;
}

describe("schema", () => {
  test("every index a migration creates is mirrored in schema.sql", () => {
    const schema = readFileSync(join(INFRA_DIR, "schema.sql"), "utf8");
    const migrationsDir = join(INFRA_DIR, "migrations");
    const missing: string[] = [];
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))) {
      const text = readFileSync(join(migrationsDir, file), "utf8");
      for (const m of text.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)/g)) {
        if (!schema.includes(m[1]!)) missing.push(`${file}: ${m[1]}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  test("the lookups every request runs stay indexed", () => {
    const schema = readFileSync(join(INFRA_DIR, "schema.sql"), "utf8");
    const indexed = indexedFirstColumns(schema);
    const required = [
      "projects.account_id",
      "project_members.account_id",
      "devices.project_id",
      "saves.project_id",
      "transfer_tokens.device_id",
      "account_devices.account_id",
      "service_credentials.account_id",
      "sessions.account_id",
      "proposal_suggestions.proposal_id",
      "proposal_comments.proposal_id",
      "change_proposals.project_id",
      "webhook_endpoints.account_id",
      "webhook_deliveries.endpoint_id",
      "stored_objects.project_id",
    ];
    for (const pair of required) {
      assert.ok(indexed.has(pair), `schema.sql has no index serving ${pair}`);
    }
    // The audit_log lookup runs on an expression; the parser skips it, so
    // the named index is asserted directly.
    assert.ok(schema.includes("audit_log_service_request"), "schema.sql is missing audit_log_service_request");
  });
});
