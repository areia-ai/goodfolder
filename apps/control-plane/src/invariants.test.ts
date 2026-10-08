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
