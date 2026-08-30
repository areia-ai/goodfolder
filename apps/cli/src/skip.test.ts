import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import {
  activePatterns,
  applySkipRules,
  credentialFilesLeftOut,
  skippedGroups,
} from "./skip.ts";

/** A throwaway folder the engine manages, with the given files written in. */
function folderWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gf-skip-"));
  for (const [path, body] of Object.entries(files)) {
    const abs = join(dir, path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  git(dir, ["init", "-b", "main"]);
  applySkipRules(dir, join(dir, ".git"));
  return dir;
}

const cleanup = (dir: string) => rmSync(dir, { recursive: true, force: true });

test("unmistakable names are skipped with no evidence needed", () => {
  const dir = folderWith({ "notes.md": "hi" });
  try {
    const patterns = activePatterns(dir);
    assert.ok(patterns.includes("node_modules/"));
    assert.ok(patterns.includes(".next/"));
    assert.ok(patterns.includes(".DS_Store"));
  } finally {
    cleanup(dir);
  }
});

test("ambiguous names are skipped only on evidence — someone's build folder is safe", () => {
  const plain = folderWith({ "build/model.stl": "x" });
  try {
    assert.ok(!activePatterns(plain).includes("build/"), "no evidence, so no rule");
    // The folder is a person's work and stays protected.
    const status = git(plain, ["status", "--porcelain", "-uall"]).stdout;
    assert.ok(status.includes("build/model.stl"));
  } finally {
    cleanup(plain);
  }

  const project = folderWith({ "package.json": "{}", "build/out.js": "x" });
  try {
    assert.ok(activePatterns(project).includes("build/"), "evidence present");
    const status = git(project, ["status", "--porcelain", "-uall"]).stdout;
    assert.ok(!status.includes("build/out.js"));
  } finally {
    cleanup(project);
  }
});

test("a Keynote deck is never mistaken for a private key", () => {
  const dir = folderWith({ "Q3 Deck.key": "slides", "server.pem": "cert" });
  try {
    const status = git(dir, ["status", "--porcelain", "-uall"]).stdout;
    assert.ok(status.includes("Q3 Deck.key"), "the deck stays protected");
    assert.ok(!status.includes("server.pem"), "the certificate does not");
  } finally {
    cleanup(dir);
  }
});

test("secret files are left out, and their example template is not", () => {
  const dir = folderWith({
    ".env": "SECRET=1",
    ".env.local": "SECRET=2",
    ".env.example": "SECRET=",
    "app.js": "x",
  });
  try {
    assert.deepEqual(credentialFilesLeftOut(dir).sort(), [".env", ".env.local"]);
    const status = git(dir, ["status", "--porcelain", "-uall"]).stdout;
    assert.ok(status.includes(".env.example"), "the fill-in-the-blanks copy stays");
  } finally {
    cleanup(dir);
  }
});

test("a path the person asked for is no longer reported as left out", () => {
  const dir = folderWith({ ".env": "SECRET=1" });
  try {
    assert.deepEqual(credentialFilesLeftOut(dir, [".env"]), []);
    assert.deepEqual(skippedGroups(dir, [".env"]), []);
  } finally {
    cleanup(dir);
  }
});

test("applying the rules twice leaves one block, and keeps what was already there", () => {
  const dir = folderWith({ "a.txt": "x" });
  try {
    const excludePath = join(dir, ".git", "info", "exclude");
    writeFileSync(excludePath, "my-own-note.txt\n" + readFileSync(excludePath, "utf8"));
    applySkipRules(dir, join(dir, ".git"));
    applySkipRules(dir, join(dir, ".git"));
    const text = readFileSync(excludePath, "utf8");
    assert.equal(text.split("node_modules/").length - 1, 1, "one block, not three");
    assert.ok(text.includes("my-own-note.txt"), "the person's own line survives");
  } finally {
    cleanup(dir);
  }
});

test("what was left out is grouped by why, and reads in plain language", () => {
  const dir = folderWith({
    "package.json": "{}",
    ".env": "SECRET=1",
    "node_modules/pkg/index.js": "x",
    ".DS_Store": "x",
  });
  try {
    const groups = skippedGroups(dir);
    const byCategory = Object.fromEntries(groups.map((g) => [g.category, g]));
    assert.ok(byCategory.credentials, "secrets are called out");
    assert.ok(byCategory.installed, "downloaded packages are called out");
    assert.ok(byCategory.noise, "what the computer wrote is called out");
    assert.equal(byCategory.credentials?.label, "files that look like they hold passwords or keys");
    // Secrets lead: they are the group somebody might want to overrule.
    assert.equal(groups[0]?.category, "credentials");
    // A folder of thousands reports as one line, not thousands.
    assert.deepEqual(byCategory.installed?.paths, ["node_modules/"]);
  } finally {
    cleanup(dir);
  }
});
