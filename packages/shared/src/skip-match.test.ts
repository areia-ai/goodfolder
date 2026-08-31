import assert from "node:assert/strict";
import { test } from "node:test";
import { skipRuleFor } from "./index.ts";

/** Most rules apply on sight; these tests say so explicitly. */
const nothingOnDisk = () => false;
const atTop = (...present: string[]) => (candidate: string) => present.includes(candidate);

test("downloaded packages are left out at any depth", () => {
  assert.equal(skipRuleFor("node_modules/react/index.js", nothingOnDisk)?.category, "installed");
  assert.equal(skipRuleFor("apps/web/node_modules/react/index.js", nothingOnDisk)?.category, "installed");
});

test("a folder rule never catches a file of the same name", () => {
  // Someone's notes called `node_modules` are their work, not a package folder.
  assert.equal(skipRuleFor("node_modules", nothingOnDisk), null);
  assert.equal(skipRuleFor("notes/dist", atTop("package.json")), null);
});

test("a rule written with a slash inside is anchored at the top", () => {
  assert.equal(skipRuleFor(".yarn/cache/react.zip", nothingOnDisk)?.category, "installed");
  assert.equal(skipRuleFor("vendor/.yarn/cache/react.zip", nothingOnDisk), null);
});

test("credential shapes are left out, wherever they sit", () => {
  assert.equal(skipRuleFor(".env", nothingOnDisk)?.category, "credentials");
  assert.equal(skipRuleFor(".env.local", nothingOnDisk)?.category, "credentials");
  assert.equal(skipRuleFor("apps/web/.env.production", nothingOnDisk)?.category, "credentials");
  assert.equal(skipRuleFor("certs/server.pem", nothingOnDisk)?.category, "credentials");
  assert.equal(skipRuleFor(".ssh/id_ed25519", nothingOnDisk)?.category, "credentials");
});

test("the example a person keeps on purpose survives", () => {
  assert.equal(skipRuleFor(".env.example", nothingOnDisk), null);
  assert.equal(skipRuleFor("apps/web/.env.sample", nothingOnDisk), null);
  assert.equal(skipRuleFor(".env.template", nothingOnDisk), null);
});

test("a Keynote presentation is not a private key", () => {
  assert.equal(skipRuleFor("decks/Q3 review.key", nothingOnDisk), null);
});

test("only the literal pattern matches, never a near miss", () => {
  // `.env.*` is a glob, not a prefix: `.environment` is somebody's folder.
  assert.equal(skipRuleFor(".environment/notes.md", nothingOnDisk), null);
  assert.equal(skipRuleFor("my.env", nothingOnDisk), null);
});

test("evidence decides the rules that need it", () => {
  assert.equal(skipRuleFor("dist/app.js", atTop("package.json"))?.category, "rebuildable");
  assert.equal(skipRuleFor("dist/app.js", nothingOnDisk), null);
  assert.equal(skipRuleFor("target/debug/app", atTop("Cargo.toml"))?.category, "rebuildable");
  assert.equal(skipRuleFor("target/debug/app", atTop("package.json")), null);
  assert.equal(skipRuleFor("venv/lib/x.py", atTop("venv/pyvenv.cfg"))?.category, "installed");
  assert.equal(skipRuleFor("venv/lib/x.py", nothingOnDisk), null);
});

test("rebuilt output and machine noise are left out", () => {
  assert.equal(skipRuleFor(".next/static/chunk.js", nothingOnDisk)?.category, "rebuildable");
  assert.equal(skipRuleFor("app/__pycache__/main.cpython-312.pyc", nothingOnDisk)?.category, "rebuildable");
  assert.equal(skipRuleFor("main.pyc", nothingOnDisk)?.category, "rebuildable");
  assert.equal(skipRuleFor("photos/.DS_Store", nothingOnDisk)?.category, "noise");
  assert.equal(skipRuleFor("~$Budget.xlsx", nothingOnDisk)?.category, "noise");
  assert.equal(skipRuleFor("npm-debug.log.3", nothingOnDisk)?.category, "noise");
});

test("a person's own work is left alone", () => {
  for (const path of ["report.md", "figures/chart.png", "src/index.ts", "Budget.xlsx"]) {
    assert.equal(skipRuleFor(path, atTop("package.json", "Cargo.toml")), null, path);
  }
});

test("the rule that caught a path is named", () => {
  assert.deepEqual(skipRuleFor("node_modules/x/y.js", nothingOnDisk), {
    path: "node_modules/x/y.js",
    pattern: "node_modules/",
    category: "installed",
  });
});
