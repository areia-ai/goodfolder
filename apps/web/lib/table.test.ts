import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDelimitedEdits, parseDelimitedTable, serializeDelimitedTable } from "./table.ts";

test("browser table helper mirrors CSV and TSV quoting rules", () => {
  const parsed = parseDelimitedTable('Name,Note\r\nAda,"said ""hello, world"""\r\n', "people.csv");
  assert.equal("error" in parsed, false);
  if ("error" in parsed) return;
  assert.deepEqual(parsed.rows, [["Name", "Note"], ["Ada", 'said "hello, world"']]);
  assert.equal(serializeDelimitedTable(parsed), 'Name,Note\r\nAda,"said ""hello, world"""\r\n');
  const result = applyDelimitedEdits("A\tB\n1\t2\n", "values.tsv", [{ address: "B2", before: "2", replacement: "3" }]);
  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.equal(result.content, "A\tB\n1\t3\n");
});
test("browser table helper reports a stale cell without changing content", () => {
  const result = applyDelimitedEdits("A,B\n1,2\n", "values.csv", [{ address: "B2", before: "old", replacement: "3" }]);
  assert.deepEqual(result, { error: "stale", message: "Cell B2 no longer contains the expected value.", address: "B2" });
});
