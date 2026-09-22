import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IGNORE_FILE,
  ignoreRuleFor,
  parseIgnoreFile,
  skipRuleFor,
  validateIgnorePattern,
  warnRuleFor,
} from "./index.ts";

const nothingOnDisk = () => false;

test("the new credential shapes are left out", () => {
  assert.equal(skipRuleFor("cert.p12", nothingOnDisk)?.category, "credentials");
  assert.equal(skipRuleFor("cert.pfx", nothingOnDisk)?.category, "credentials");
  assert.equal(skipRuleFor("app.keystore", nothingOnDisk)?.category, "credentials");
  assert.equal(skipRuleFor("app.jks", nothingOnDisk)?.category, "credentials");
  assert.equal(skipRuleFor("credentials", nothingOnDisk)?.category, "credentials");
  assert.equal(skipRuleFor("a/credentials", nothingOnDisk)?.category, "credentials");
  // A Keynote deck is still not a private key.
  assert.equal(skipRuleFor("Deck.key", nothingOnDisk), null);
});

test("names that suggest secrets warn, case-insensitively", () => {
  assert.deepEqual(warnRuleFor("Secret Santa.xlsx"), { path: "Secret Santa.xlsx", pattern: "*secret*" });
  assert.deepEqual(warnRuleFor("password-notes.md"), { path: "password-notes.md", pattern: "*password*" });
  assert.deepEqual(warnRuleFor("API_Credentials.txt"), { path: "API_Credentials.txt", pattern: "*credential*" });
  assert.deepEqual(warnRuleFor("server.key.bak"), { path: "server.key.bak", pattern: "*.key.*" });
});

test("ordinary names do not warn", () => {
  assert.equal(warnRuleFor("Deck.key"), null);
  assert.equal(warnRuleFor("notes.md"), null);
  assert.equal(warnRuleFor("secrets/notes.md"), null, "only the last segment is read");
});

test("a skip beats a warning — the louder message already said it", () => {
  assert.equal(warnRuleFor("credentials"), null);
  assert.equal(warnRuleFor(".env"), null);
  assert.equal(warnRuleFor("my.pem"), null);
});

test("ignore patterns are checked in plain language", () => {
  assert.equal(validateIgnorePattern("*.mov"), null);
  assert.equal(validateIgnorePattern("renders/"), null);
  assert.equal(validateIgnorePattern("!x"), "starts with ! — this list can't carry exceptions");
  assert.match(validateIgnorePattern("**/x")!, /\*\*/);
  assert.match(validateIgnorePattern("a?b")!, /only wildcard/);
  assert.match(validateIgnorePattern("/abs")!, /relative to the top/);
  assert.match(validateIgnorePattern(IGNORE_FILE)!, /itself/);
  assert.match(validateIgnorePattern("*ignore")!, /itself/);
  assert.match(validateIgnorePattern("*")!, /itself/);
});

test("the ignore file parses comments, blanks and repeats, and reports the rest", () => {
  const parsed = parseIgnoreFile(
    [
      "# leave my renders out",
      "",
      "*.mov",
      "renders/",
      "*.mov",
      "  spaced.png  ",
      "!keep.txt",
    ].join("\n"),
  );
  assert.deepEqual(parsed.patterns, ["*.mov", "renders/", "spaced.png"]);
  assert.deepEqual(parsed.invalid, [
    { line: 7, text: "!keep.txt", reason: "starts with ! — this list can't carry exceptions" },
  ]);
});

test("the ignore list matches like the engine, last line winning", () => {
  const patterns = ["*.mov", "renders/", "*.mov"];
  assert.equal(ignoreRuleFor("video.mov", patterns), "*.mov");
  assert.equal(ignoreRuleFor("renders/final.mov", ["renders/", "*.mov"]), "*.mov");
  assert.equal(ignoreRuleFor("renders/final.png", ["renders/"]), "renders/");
  assert.equal(ignoreRuleFor("notes.md", patterns), null);
  assert.equal(ignoreRuleFor("", patterns), null);
});

test("the ignore file itself can never be listed out", () => {
  assert.equal(ignoreRuleFor(IGNORE_FILE, [IGNORE_FILE]), IGNORE_FILE);
  // …which is exactly why such a line is refused at validation instead.
  assert.notEqual(validateIgnorePattern(IGNORE_FILE), null);
});
