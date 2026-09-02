import assert from "node:assert/strict";
import test from "node:test";
import { projectNameForFolder } from "./connect.ts";

test("connected folders keep their literal local name", () => {
  assert.equal(projectNameForFolder("/work/real_smoothies"), "real_smoothies");
  assert.equal(projectNameForFolder("/work/Research  2026"), "Research  2026");
});
