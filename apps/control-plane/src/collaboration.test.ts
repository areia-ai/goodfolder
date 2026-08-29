import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAnchoredSuggestion, safeDocumentPath } from "./collaboration.ts";

test("safeDocumentPath accepts nested files and blocks path escapes", () => {
  assert.equal(safeDocumentPath("notes/brief.md"), "notes/brief.md");
  for (const unsafe of ["/brief.md", "../brief.md", "notes//brief.md", "notes\\brief.md", "notes/./brief.md", "notes\0brief.md"]) {
    assert.equal(safeDocumentPath(unsafe), null);
  }
});

test("applyAnchoredSuggestion replaces one exact passage", () => {
  assert.deepEqual(applyAnchoredSuggestion("before middle after", "middle", "new"), { content: "before new after" });
});

test("applyAnchoredSuggestion refuses missing or repeated passages", () => {
  assert.deepEqual(applyAnchoredSuggestion("one", "two", "new"), { error: "missing" });
  assert.deepEqual(applyAnchoredSuggestion("same and same", "same", "new"), { error: "ambiguous" });
  assert.deepEqual(applyAnchoredSuggestion("", "", "first content"), { content: "first content" });
  assert.deepEqual(applyAnchoredSuggestion("already here", "", "new"), { error: "ambiguous" });
});
