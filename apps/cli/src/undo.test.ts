import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildPreview,
  buildUndoLabel,
  detectAgentRun,
  parseNameStatus,
  summarizeReverseEffect,
} from "./undo.ts";
import type { TimelineEntry } from "./api.ts";

const save = (seq: number, harness: string | null, label = `save ${seq}`): TimelineEntry =>
  ({ seq, harness, label, commit_sha: `sha${seq}` }) as unknown as TimelineEntry;

test("detectAgentRun: person-made last save is never a run", () => {
  assert.equal(detectAgentRun([save(3, null), save(2, "claude-code"), save(1, "claude-code")]), 1);
});

test("detectAgentRun: counts the contiguous same-agent run from the top", () => {
  const saves = [save(5, "codex"), save(4, "codex"), save(3, "codex"), save(2, null), save(1, null)];
  assert.equal(detectAgentRun(saves), 3);
});

test("detectAgentRun: stops at a different agent", () => {
  const saves = [save(4, "codex"), save(3, "codex"), save(2, "claude-code"), save(1, "codex")];
  assert.equal(detectAgentRun(saves), 2);
});

test("detectAgentRun: never returns the whole timeline", () => {
  const saves = [save(3, "codex"), save(2, "codex"), save(1, "codex")];
  assert.equal(detectAgentRun(saves), 2); // leaves #1 to return to
});

test("detectAgentRun: single-agent pair leaves an earlier state", () => {
  assert.equal(detectAgentRun([save(2, "codex"), save(1, "codex")]), 1);
});

test("parseNameStatus: classifies add / change / remove and collects paths", () => {
  const out = "A\tnew.md\nM\tintro.md\nD\told.md\nM\tnotes/day.md";
  const { paths, counts } = parseNameStatus(out);
  assert.deepEqual(paths, ["new.md", "intro.md", "old.md", "notes/day.md"]);
  assert.deepEqual(counts, { added: 1, changed: 2, removed: 1 });
});

test("parseNameStatus: renames keep the new path", () => {
  const { paths, counts } = parseNameStatus("R100\told.md\tnew.md");
  assert.deepEqual(paths, ["new.md"]);
  assert.equal(counts.changed, 1);
});

test("summarizeReverseEffect: inverts the original change set", () => {
  // Original save added 1, modified 2, deleted 1.
  const out = "A\tnew.md\nM\ta.md\nM\tb.md\nD\tgone.md";
  assert.equal(
    summarizeReverseEffect(out),
    "It brings back 1 file, removes 1 file that was added and rolls back 2 changes.",
  );
});

test("summarizeReverseEffect: single effect reads cleanly", () => {
  assert.equal(summarizeReverseEffect("M\tintro.md"), "It rolls back 1 change.");
  assert.equal(summarizeReverseEffect("A\tx.md\nA\ty.md"), "It removes 2 files that were added.");
});

test("summarizeReverseEffect: empty means no-op", () => {
  assert.match(summarizeReverseEffect(""), /changes nothing/);
});

test("buildUndoLabel: one save echoes its number and label", () => {
  assert.equal(
    buildUndoLabel([save(7, "codex", "Rewrote the intro")], "Codex"),
    "Undid save #7 — Rewrote the intro",
  );
});

test("buildUndoLabel: a run names the count, agent, and range", () => {
  const scope = [save(9, "codex"), save(8, "codex"), save(7, "codex")];
  assert.equal(buildUndoLabel(scope, "Codex"), "Undid 3 saves from Codex (#7–#9)");
});

test("buildPreview: single save with a same-agent run notes the run", () => {
  const text = buildPreview({
    scope: [save(7, "codex", "Rewrote the intro")],
    harnessName: "Codex",
    effect: "It rolls back 1 change.",
    runLen: 3,
  });
  assert.match(text, /undoes Codex's last save \(#7\)/);
  assert.match(text, /“Rewrote the intro”/);
  assert.match(text, /The 3 most recent saves are all from Codex\./);
});

test("buildPreview: run scope describes the span", () => {
  const scope = [save(9, "codex"), save(8, "codex"), save(7, "codex")];
  const text = buildPreview({
    scope,
    harnessName: "Codex",
    effect: "It rolls back 4 changes.",
    runLen: 3,
  });
  assert.match(text, /3 most recent saves from Codex \(#7 through #9\)/);
  assert.match(text, /stay visible in your timeline/);
});
