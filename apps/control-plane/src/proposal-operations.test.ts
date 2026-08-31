import { test } from "node:test";
import assert from "node:assert/strict";
import { applyProposalOperations, isDocumentMediaBundle, isFileOperation } from "./proposal-operations.ts";

test("applies multiple text anchors in memory", () => {
  const result = applyProposalOperations(
    "Title\nOld summary\nOwner: Carlos\n",
    "brief.md",
    [
      { kind: "text", before: "Old summary", replacement: "New summary", operation: {} },
      { kind: "text", before: "Owner: Carlos", replacement: "Owner: Team", operation: {} },
    ],
  );
  assert.deepEqual(result, { content: "Title\nNew summary\nOwner: Team\n" });
});

test("applies a multi-cell table operation and refuses stale or malformed input", () => {
  const result = applyProposalOperations(
    "Name,Status\nAda,open\nLinus,open\n",
    "work.csv",
    [{
      kind: "table",
      before: "",
      replacement: "",
      operation: { kind: "table_update", changes: [
        { address: "B2", before: "open", replacement: "done" },
        { address: "B3", before: "open", replacement: "blocked" },
      ] },
    }],
  );
  assert.deepEqual(result, { content: "Name,Status\nAda,done\nLinus,blocked\n" });
  assert.deepEqual(
    applyProposalOperations("A,B\n1,2\n", "work.csv", [{ kind: "table", before: "", replacement: "", operation: { kind: "table_update", changes: [{ address: "B2", before: "old", replacement: "3" }] } }]),
    { error: "stale" },
  );
  assert.deepEqual(
    applyProposalOperations('"broken\n', "work.csv", [{ kind: "table", before: "", replacement: "", operation: { kind: "table_update", changes: [{ address: "A1", before: "", replacement: "x" }] } }]),
    { error: "malformed" },
  );
  assert.deepEqual(
    applyProposalOperations("A,B\n1,2\n", "work.csv", [{ kind: "table", before: "", replacement: "", operation: { kind: "table_update", changes: [{ address: "B2", before: "2", replacement: "3" }, { address: "A2", before: 1, replacement: "x" }] } }]),
    { error: "malformed" },
  );
});

test("does not apply unsupported binary operations", () => {
  assert.deepEqual(
    applyProposalOperations("ignored", "photo.png", [{ kind: "asset", before: "", replacement: "", operation: { kind: "asset_replace" } }]),
    { error: "unsupported" },
  );
});

test("a change to which files a folder holds is not a change to a file", () => {
  for (const kind of ["asset", "rename", "remove"] as const) {
    assert.deepEqual(
      applyProposalOperations("Some text.", "notes.md", [{ kind, before: "", replacement: "", operation: {} }]),
      { error: "unsupported" },
      kind,
    );
    assert.equal(isFileOperation(kind), true);
  }
  assert.equal(isFileOperation("text"), false);
  assert.equal(isFileOperation("table"), false);
  assert.equal(isFileOperation(null), false);
});

test("document media is recognized only when the file and reference travel together", () => {
  const text = { kind: "text" as const, before: "## Steps", replacement: "![Drink](drink.png)\n\n## Steps", operation: { kind: "text_replace", bundle: "document_media" } };
  const asset = { kind: "asset" as const, before: "", replacement: "", operation: { kind: "asset_replace", bundle: "document_media" } };
  assert.equal(isDocumentMediaBundle([asset, text]), true);
  assert.equal(isDocumentMediaBundle([asset]), false);
  assert.equal(isDocumentMediaBundle([{ ...asset, operation: { kind: "asset_replace" } }, text]), false);
});
