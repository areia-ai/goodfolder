import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IGNORE_FILE, skipRuleFor } from "@goodfolder/shared";
import { git } from "./git.ts";
import { saveConfig, type FolderConfig } from "./config.ts";
import { applySkipRules, skippedEntries } from "./skip.ts";
import { cmdIgnore } from "./ignore.ts";
import { cmdSave } from "./save.ts";
import { runSavePipeline } from "./save-core.ts";
import { CliError } from "./cli-error.ts";

const CFG: FolderConfig = {
  projectId: "00000000-0000-0000-0000-000000000001",
  apiUrl: "http://localhost:9",
  token: "t",
  connectedAt: "",
};

function write(dir: string, path: string, body: string): void {
  const abs = join(dir, path);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
}

/** A connected throwaway folder with the given files written in. */
function folderWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gf-ignore-"));
  for (const [path, body] of Object.entries(files)) write(dir, path, body);
  git(dir, ["init", "-b", "main"]);
  const gitDir = join(dir, ".git");
  saveConfig(gitDir, { ...CFG });
  applySkipRules(dir, gitDir);
  return dir;
}

const cleanup = (dir: string) => rmSync(dir, { recursive: true, force: true });

/** Capture console.log output of a command. */
async function capture(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = log;
  }
  return lines.join("\n");
}

const status = (dir: string) => git(dir, ["status", "--porcelain", "-uall"]).stdout;

test("the engine and skipRuleFor agree on every new credential shape", () => {
  const dir = folderWith({
    "cert.p12": "x", "cert.pfx": "x", "app.keystore": "x", "app.jks": "x",
    "credentials": "x", "Deck.key": "x", "notes.md": "x",
  });
  try {
    const shown = status(dir);
    for (const p of ["cert.p12", "cert.pfx", "app.keystore", "app.jks", "credentials"]) {
      assert.equal(skipRuleFor(p, () => false)?.category, "credentials", p);
      assert.ok(!shown.includes(p), `${p} left out by the engine`);
    }
    assert.ok(shown.includes("Deck.key"));
    assert.ok(shown.includes("notes.md"));
  } finally {
    cleanup(dir);
  }
});

test("ignore add/list/remove round-trips with no duplicates", async () => {
  const dir = folderWith({ "clip.mov": "x", "keep.md": "x" });
  try {
    await cmdIgnore(dir, ["add", "*.mov"], { remove: false, yes: false });
    await cmdIgnore(dir, ["add", "*.mov"], { remove: false, yes: false });
    const text = readFileSync(join(dir, IGNORE_FILE), "utf8");
    assert.equal(text.split("*.mov").length - 1, 1, "one line, not two");
    assert.ok(!status(dir).includes("clip.mov"), "the clip is left out");
    assert.ok(status(dir).includes(IGNORE_FILE), "the list itself is protected");
    const out = await capture(() => cmdIgnore(dir, ["list"], { remove: false, yes: false }));
    assert.ok(out.includes("*.mov"), out);
    assert.ok(out.includes("leaves out 1 file"), out);
    await cmdIgnore(dir, ["remove", "*.mov"], { remove: false, yes: false });
    assert.ok(status(dir).includes("clip.mov"), "the clip is protected again");
  } finally {
    cleanup(dir);
  }
});

test("ignore remove only reports what was actually on the list", async () => {
  const dir = folderWith({ "clip.mov": "x" });
  try {
    await cmdIgnore(dir, ["add", "*.mov"], { remove: false, yes: false });
    const out = await capture(() =>
      cmdIgnore(dir, ["remove", "*.mov", "*.wav"], { remove: false, yes: false }),
    );
    assert.ok(out.includes("✓ *.mov no longer leaves files out"), out);
    assert.ok(out.includes("*.wav wasn't on the list"), out);
    // Removing only absent patterns leaves the file untouched.
    const after = readFileSync(join(dir, IGNORE_FILE), "utf8");
    const out2 = await capture(() =>
      cmdIgnore(dir, ["remove", "*.wav"], { remove: false, yes: false }),
    );
    assert.ok(out2.includes("wasn't on the list"), out2);
    assert.ok(!out2.includes("✓"), out2);
    assert.equal(readFileSync(join(dir, IGNORE_FILE), "utf8"), after);
  } finally {
    cleanup(dir);
  }
});

test("a bad pattern is refused and changes nothing", async () => {
  const dir = folderWith({ "a.txt": "x" });
  try {
    await assert.rejects(
      () => cmdIgnore(dir, ["add", "**/x"], { remove: false, yes: false }),
      CliError,
    );
    assert.equal(existsSync(join(dir, IGNORE_FILE)), false);
  } finally {
    cleanup(dir);
  }
});

test("an ignore pattern wins over a keep", async () => {
  const dir = folderWith({ ".env.example": "SECRET=" });
  try {
    assert.ok(status(dir).includes(".env.example"), "the template is protected by default");
    await cmdIgnore(dir, ["add", ".env.example"], { remove: false, yes: false });
    assert.ok(!status(dir).includes(".env.example"), "the person's list wins");
  } finally {
    cleanup(dir);
  }
});

test("already-saved files keep being saved after ignore add, and say so", async () => {
  const dir = folderWith({ "old.mov": "x", "new.mov": "y" });
  try {
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "first"]);
    const out = await capture(() => cmdIgnore(dir, ["add", "*.mov"], { remove: false, yes: false }));
    assert.ok(out.includes("already saved and will keep being saved"), out);
    const tracked = git(dir, ["ls-files"]).stdout;
    assert.ok(tracked.includes("old.mov"), "still in history until --remove");
  } finally {
    cleanup(dir);
  }
});

test("add --remove stops protecting saved matches but leaves them on disk", async () => {
  const dir = folderWith({ "old.mov": "x" });
  try {
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "first"]);
    await cmdIgnore(dir, ["add", "*.mov"], { remove: true, yes: true });
    const tracked = git(dir, ["ls-files"]).stdout;
    assert.ok(!tracked.includes("old.mov"), "no longer protected");
    assert.ok(existsSync(join(dir, "old.mov")), "the file stays on this computer");
  } finally {
    cleanup(dir);
  }
});

test("add --remove with no terminal stops with the --yes message instead of assuming no", () => {
  const dir = folderWith({ "old.mov": "x" });
  try {
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "first"]);
    const cli = join(dirname(fileURLToPath(import.meta.url)), "index.ts");
    // Piped stdin: exactly what a script or an agent's shell looks like.
    const r = spawnSync(
      process.execPath,
      ["--experimental-transform-types", cli, "ignore", "add", "*.mov", "--remove"],
      { cwd: dir, input: "", encoding: "utf8" },
    );
    assert.notEqual(r.status, 0, `exits non-zero\n${r.stdout}\n${r.stderr}`);
    assert.ok(r.stderr.includes("no terminal here to ask in"), r.stderr);
    assert.ok(r.stderr.includes('goodfolder ignore add "*.mov" --remove --yes'), r.stderr);
    assert.ok(git(dir, ["ls-files"]).stdout.includes("old.mov"), "still protected — nothing was removed");
  } finally {
    cleanup(dir);
  }
});

test("a hand-edited .goodfolderignore takes effect when the rules are applied", () => {
  const dir = folderWith({ "big.mov": "x", "keep.md": "x" });
  try {
    assert.ok(status(dir).includes("big.mov"));
    // As if sync brought it in: the file changed on disk, then rules re-applied.
    writeFileSync(join(dir, IGNORE_FILE), "*.mov\n");
    applySkipRules(dir, join(dir, ".git"));
    assert.ok(!status(dir).includes("big.mov"));
  } finally {
    cleanup(dir);
  }
});

test("skippedEntries says who asked and why, for all three sources", () => {
  const dir = folderWith({
    ".env": "SECRET=1",
    "clip.mov": "x",
    "logs/app.log": "x",
    "kept.md": "x",
  });
  try {
    writeFileSync(join(dir, IGNORE_FILE), "*.mov\n");
    // The project's own settings, not ours.
    writeFileSync(join(dir, ".gitignore"), "logs/\n");
    applySkipRules(dir, join(dir, ".git"));
    const entries = skippedEntries(dir);
    const byPath = new Map(entries.map((e) => [e.path, e]));
    const env = byPath.get(".env");
    assert.equal(env?.source, "built-in");
    assert.equal(env?.category, "credentials");
    assert.ok(env?.reason.includes("passwords or keys"), env?.reason);
    const mov = byPath.get("clip.mov");
    assert.equal(mov?.source, "ignore-list");
    assert.ok(mov?.reason.includes("your ignore list"), mov?.reason);
    const logs = byPath.get("logs/");
    assert.equal(logs?.source, "their-own");
    assert.ok(logs?.reason.includes("own settings"), logs?.reason);
    for (const e of entries) {
      assert.ok(e.pattern && e.reason, `every entry carries pattern and reason: ${e.path}`);
    }
  } finally {
    cleanup(dir);
  }
});

test("a non-first save names the credential files it skipped, and counts the rest", async () => {
  const dir = folderWith({ "README.md": "hi" });
  try {
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "first"]);
    write(dir, "app.pfx", "x");
    write(dir, "Secret notes.txt", "x");
    write(dir, "new.md", "x");
    const out = await capture(() =>
      runSavePipeline(dir, { ...CFG }, { skipPush: true }),
    );
    assert.ok(out.includes("Skipped 1 file that looks like credentials: app.pfx"), out);
    assert.ok(out.includes("Left out:"), out);
    assert.ok(out.includes("that look like credentials"), out);
    assert.ok(out.includes("Saved, but 1 file has a name that suggests secrets: Secret notes.txt (*secret*)"), out);
  } finally {
    cleanup(dir);
  }
});

test("a warn-tier file is saved and lands in the outcome", async () => {
  const dir = folderWith({ "README.md": "hi" });
  try {
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "first"]);
    write(dir, "Passwords.xlsx", "x");
    const outcome = await runSavePipeline(dir, { ...CFG }, { skipPush: true });
    assert.deepEqual(outcome.warnings, [{ path: "Passwords.xlsx", pattern: "*password*" }]);
    const tracked = git(dir, ["ls-files"]).stdout;
    assert.ok(tracked.includes("Passwords.xlsx"), "warned, not skipped");
    assert.ok(Array.isArray(outcome.skipped));
  } finally {
    cleanup(dir);
  }
});

test("invalid lines in .goodfolderignore are named once and otherwise ignored", async () => {
  const dir = folderWith({ "README.md": "hi" });
  try {
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "first"]);
    writeFileSync(join(dir, IGNORE_FILE), "*.mov\n!nope\n");
    write(dir, "next.md", "x");
    const out = await capture(() =>
      runSavePipeline(dir, { ...CFG }, { skipPush: true }),
    );
    assert.ok(out.includes('line 2 ("!nope")'), out);
  } finally {
    cleanup(dir);
  }
});

test("--include-secrets refuses without a person at the keyboard", async () => {
  const dir = folderWith({ ".env": "SECRET=1", "app.md": "x" });
  try {
    assert.equal(process.stdin.isTTY, undefined, "test runs without a TTY");
    await assert.rejects(
      () => cmdSave(dir, { ...CFG }, { includeSecrets: true, gitDir: join(dir, ".git") }),
      (e) => e instanceof CliError && /goodfolder protect/.test(e.message),
    );
  } finally {
    cleanup(dir);
  }
});
