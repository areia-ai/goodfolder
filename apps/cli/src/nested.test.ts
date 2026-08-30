import { strict as assert } from "node:assert";
import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import { absorbForeignHistories, foreignHistories, pathsInside } from "./nested.ts";

function write(dir: string, path: string, body: string): void {
  const abs = join(dir, path);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
}

/** An outer folder with `inner` carrying its own separate history. */
function folderWithForeignHistory(): string {
  const dir = mkdtempSync(join(tmpdir(), "gf-nested-"));
  write(dir, "index.html", "<h1>site</h1>");
  write(dir, "notes/plan.md", "the plan");

  const inner = join(dir, "vendor/somelib");
  mkdirSync(inner, { recursive: true });
  write(dir, "vendor/somelib/lib.js", "export const x = 1");
  write(dir, "vendor/somelib/deep/util.js", "export const y = 2");
  write(dir, "vendor/somelib/.gitignore", "*.tmp\n");
  write(dir, "vendor/somelib/scratch.tmp", "throwaway");
  chmodSync(join(inner, "lib.js"), 0o755);
  git(inner, ["init", "-b", "main"]);
  git(inner, ["add", "-A"]);
  git(inner, ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "their work"]);
  write(dir, "vendor/somelib/added-later.js", "export const z = 3");

  git(dir, ["init", "-b", "main"]);
  return dir;
}

const cleanup = (dir: string) => rmSync(dir, { recursive: true, force: true });

test("an ordinary folder inside a folder is left completely alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "gf-plain-"));
  try {
    write(dir, "Client Work/Acme/2026/Q3 Report/draft.md", "words");
    write(dir, "Personal/Recetas/flan.md", "receta");
    git(dir, ["init", "-b", "main"]);
    git(dir, ["add", "-A"]);
    assert.deepEqual(foreignHistories(dir), [], "nothing here carries its own history");
    const tracked = git(dir, ["ls-files"]).stdout.split("\n").filter(Boolean);
    assert.deepEqual(tracked.sort(), [
      "Client Work/Acme/2026/Q3 Report/draft.md",
      "Personal/Recetas/flan.md",
    ]);
  } finally {
    cleanup(dir);
  }
});

test("a folder carrying another tool's history is found, not guessed at", () => {
  const dir = folderWithForeignHistory();
  try {
    git(dir, ["add", "-A"]);
    assert.deepEqual(foreignHistories(dir), ["vendor/somelib"]);
  } finally {
    cleanup(dir);
  }
});

test("its files are taken, including ones it had not recorded yet", () => {
  const dir = folderWithForeignHistory();
  try {
    git(dir, ["add", "-A"]);
    const taken = absorbForeignHistories(dir, foreignHistories(dir));
    assert.ok(taken.includes("vendor/somelib/lib.js"));
    assert.ok(taken.includes("vendor/somelib/deep/util.js"));
    assert.ok(taken.includes("vendor/somelib/added-later.js"), "not yet in their history");
    assert.ok(
      !taken.includes("vendor/somelib/scratch.tmp"),
      "their own exclusions are honoured",
    );
    const entries = git(dir, ["ls-files", "-s"]).stdout;
    assert.ok(!entries.includes("160000"), "no bookmark is left behind");
    assert.ok(entries.includes("100755\t") || /100755 \w+ 0\tvendor\/somelib\/lib\.js/.test(entries),
      "the runnable file stays runnable");
  } finally {
    cleanup(dir);
  }
});

test("the other tool's own history is never touched", () => {
  const dir = folderWithForeignHistory();
  const inner = join(dir, "vendor/somelib");
  try {
    const before = git(inner, ["rev-parse", "HEAD"]).stdout.trim();
    git(dir, ["add", "-A"]);
    absorbForeignHistories(dir, foreignHistories(dir));
    assert.equal(git(inner, ["rev-parse", "HEAD"]).stdout.trim(), before);
    assert.equal(git(inner, ["status", "--porcelain"]).code, 0, "still a working setup");
  } finally {
    cleanup(dir);
  }
});

test("the save settles: nothing is reported as changed straight afterwards", () => {
  const dir = folderWithForeignHistory();
  try {
    git(dir, ["add", "-A"]);
    absorbForeignHistories(dir, foreignHistories(dir));
    git(dir, ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "First save"]);
    const status = git(dir, ["status", "--porcelain", "-uall"]).stdout.trim();
    assert.equal(status, "", "no phantom changes on the next save");
  } finally {
    cleanup(dir);
  }
});

test("a link stays a link rather than becoming a copy of what it points at", () => {
  const dir = folderWithForeignHistory();
  try {
    symlinkSync("lib.js", join(dir, "vendor/somelib/alias.js"));
    git(dir, ["add", "-A"]);
    absorbForeignHistories(dir, foreignHistories(dir));
    const entry = git(dir, ["ls-files", "-s", "--", "vendor/somelib/alias.js"]).stdout;
    assert.ok(entry.startsWith("120000"), `expected a link entry, got: ${entry.trim()}`);
  } finally {
    cleanup(dir);
  }
});

test("the paths are known before the bytes are read, so routing can run first", () => {
  const dir = folderWithForeignHistory();
  try {
    const inside = pathsInside(dir, ["vendor/somelib"]);
    assert.ok(inside.includes("vendor/somelib/lib.js"));
    assert.ok(inside.every((p) => p.startsWith("vendor/somelib/")));
  } finally {
    cleanup(dir);
  }
});

test("a colliding pair inside such a folder is still refused before it can do harm", async () => {
  const { runSavePipeline } = await import("./save-core.ts");
  const { applySkipRules } = await import("./skip.ts");
  const dir = mkdtempSync(join(tmpdir(), "gf-nested-case-"));
  try {
    write(dir, "site.md", "outer");
    const inner = join(dir, "theme");
    mkdirSync(inner, { recursive: true });
    write(dir, "theme/README.md", "the real one");
    git(inner, ["init", "-b", "main"]);
    git(inner, ["add", "-A"]);
    // A project written on a case-sensitive filesystem carries both spellings.
    // Only one of them can exist on a Mac's disk, so it has to be recreated
    // the way it actually arrives: recorded, but not written out.
    const blob = git(inner, ["hash-object", "-w", "--stdin"], "the other one").stdout.trim();
    git(inner, ["update-index", "--add", "--cacheinfo", "100644", blob, "Readme.md"]);
    git(inner, ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "x"]);

    git(dir, ["init", "-b", "main"]);
    git(dir, ["config", "user.email", "t@t"]);
    git(dir, ["config", "user.name", "T"]);
    applySkipRules(dir, join(dir, ".git"));

    await assert.rejects(
      () =>
        runSavePipeline(
          dir,
          { projectId: "p", apiUrl: "http://localhost", token: "t", connectedAt: "" },
          { skipPush: true },
        ),
      /Rename one of them/,
      "taking files from another tool's folder must not slip past the case gate",
    );
    assert.equal(git(dir, ["rev-parse", "-q", "--verify", "HEAD"]).code, 1, "nothing was saved");
  } finally {
    cleanup(dir);
  }
});
