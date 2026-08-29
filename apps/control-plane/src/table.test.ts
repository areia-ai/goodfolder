import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDelimitedEdits,
  parseCellAddress,
  parseDelimitedTable,
  serializeDelimitedTable,
} from "./table.ts";

test("parses quoted commas, escaped quotes, and quoted newlines", () => {
  const parsed = parseDelimitedTable('Name,Note\r\nAda,"said ""hello, world"""\r\n', "people.csv");
  assert.equal("error" in parsed, false);
  if ("error" in parsed) return;
  assert.deepEqual(parsed.rows, [["Name", "Note"], ["Ada", 'said "hello, world"']]);
  assert.equal(parsed.lineEnding, "\r\n");
  assert.equal(parsed.hasFinalLineEnding, true);
  assert.equal(serializeDelimitedTable(parsed), 'Name,Note\r\nAda,"said ""hello, world"""\r\n');

  const multiline = parseDelimitedTable('a\t"two\nlines"\n', "notes.tsv");
  assert.equal("error" in multiline, false);
  if ("error" in multiline) return;
  assert.deepEqual(multiline.rows, [["a", "two\nlines"]]);
  assert.equal(serializeDelimitedTable(multiline), 'a\t"two\nlines"\n');
});
test("keeps BOM and line-ending style when applying a cell edit", () => {
  const source = "\ufeffA,B\r\n1,2\r\n";
  const result = applyDelimitedEdits(source, "numbers.csv", [{ address: "B2", before: "2", replacement: "3" }]);
  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.equal(result.content, "\ufeffA,B\r\n1,3\r\n");
});

test("refuses stale, duplicate, malformed, and out-of-range table edits", () => {
  assert.deepEqual(parseCellAddress("AA12"), { row: 11, col: 26 });
  assert.equal(parseCellAddress("A0"), null);
  assert.equal((applyDelimitedEdits("a,b\n1,2\n", "x.csv", [{ address: "B2", before: "old", replacement: "3" }]) as { error: string }).error, "stale");
  assert.equal((applyDelimitedEdits("a,b\n1,2\n", "x.csv", [
    { address: "B2", before: "2", replacement: "3" },
    { address: "b2", before: "2", replacement: "4" },
  ]) as { error: string }).error, "duplicate-address");
  assert.equal((applyDelimitedEdits('"unterminated\n', "x.csv", [{ address: "A1", before: "", replacement: "x" }]) as { error: string }).error, "malformed");
  assert.equal((applyDelimitedEdits("a,b\n1,2\n", "x.csv", [{ address: "C2", before: "", replacement: "3" }]) as { error: string }).error, "out-of-range");
});
