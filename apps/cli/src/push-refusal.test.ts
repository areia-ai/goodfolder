import { strict as assert } from "node:assert";
import { test, after } from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import { saveConfig, type FolderConfig } from "./config.ts";
import { applySkipRules } from "./skip.ts";
import { GF_REMOTE } from "./repo-setup.ts";
import { runSavePipeline } from "./save-core.ts";
import { CliError } from "./cli-error.ts";

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const servers: Server[] = [];

/** A stub API that only answers the save preflight — pushes go to the local bare remote. */
async function stubApi(): Promise<string> {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

after(() => servers.forEach((s) => s.close()));

const CFG: FolderConfig = {
  projectId: "00000000-0000-0000-0000-000000000001",
  apiUrl: "http://localhost:9",
  token: "t",
  connectedAt: "",
};

function folderWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gf-refusal-"));
  for (const [path, body] of Object.entries(files)) {
    const abs = join(dir, path);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  git(dir, ["init", "-b", "main"]);
  saveConfig(join(dir, ".git"), { ...CFG });
  applySkipRules(dir, join(dir, ".git"));
  return dir;
}

/** A local bare "remote" whose pre-receive hook is `hook`. */
function bareRemote(hook: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "gf-remote-"));
  const bare = join(dir, "remote.git");
  git(dir, ["init", "-q", "--bare", bare]);
  git(bare, ["config", "receive.advertisePushOptions", "true"]);
  writeFileSync(join(bare, "hooks", "pre-receive"), hook, { mode: 0o755 });
  return { path: bare, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const REFUSAL_HOOK = `#!/bin/sh
echo "GoodFolder refused this save: 1 file is left out by this folder's rules." >&2
echo "  .env — looks like it holds passwords or keys (rule: .env)" >&2
echo "Nothing from this save was kept. Take these files out and save again." >&2
echo 'goodfolder-refusal {"code":"left-out","refusalId":"r-1","paths":[{"path":".env","kind":"credentials","pattern":".env","reason":"looks like it holds passwords or keys (rule: .env)"}],"total":1}' >&2
exit 1
`;

const cleanup = (dir: string) => rmSync(dir, { recursive: true, force: true });

test("a refused save is recognised as a refusal, not 'another device'", async () => {
  const remote = bareRemote(REFUSAL_HOOK);
  const dir = folderWith({ "notes.md": "hello\n" });
  try {
    git(dir, ["remote", "add", GF_REMOTE, remote.path]);
    const apiUrl = await stubApi();
    const err = await runSavePipeline(dir, { ...CFG, apiUrl }, {}).then(
      () => null,
      (e) => e,
    );
    assert.ok(err instanceof CliError, `expected CliError, got ${err}`);
    assert.equal(err.refusal?.code, "left-out");
    assert.equal(err.refusal?.paths[0]?.path, ".env");
    assert.equal(err.refusal?.total, 1);
    assert.match(err.message, /refused|left out/i);
    assert.doesNotMatch(err.message, /Another device saved first/);
    // The save this run made is taken back; the file itself stays.
    assert.equal(git(dir, ["rev-parse", "--verify", "HEAD"]).code !== 0, true, "no history ref left");
    assert.ok(existsSync(join(dir, "notes.md")), "work file intact");
    assert.match(git(dir, ["status", "--porcelain"]).stdout, /notes\.md/, "file still tracked/staged");
  } finally {
    cleanup(dir);
    remote.cleanup();
  }
});

test("a refused later save keeps earlier history and the working files", async () => {
  const remote = bareRemote(REFUSAL_HOOK);
  const dir = folderWith({ "first.md": "one\n" });
  try {
    git(dir, ["remote", "add", GF_REMOTE, remote.path]);
    const apiUrl = await stubApi();
    // First save exists locally without pushing (remote refuses everything).
    await runSavePipeline(dir, { ...CFG, apiUrl }, { skipPush: true });
    const first = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    writeFileSync(join(dir, "second.md"), "two\n");
    const err = await runSavePipeline(dir, { ...CFG, apiUrl }, {}).then(
      () => null,
      (e) => e,
    );
    assert.ok(err instanceof CliError);
    assert.equal(err.refusal?.code, "left-out");
    assert.equal(git(dir, ["rev-parse", "HEAD"]).stdout.trim(), first, "earlier save intact");
    assert.ok(existsSync(join(dir, "second.md")), "new work intact");
    assert.match(git(dir, ["status", "--porcelain"]).stdout, /second\.md/, "change still staged");
  } finally {
    cleanup(dir);
    remote.cleanup();
  }
});

test("a plain rejection still reports another device", async () => {
  const remote = bareRemote(`#!/bin/sh\necho "some other failure" >&2\nexit 1\n`);
  const dir = folderWith({ "notes.md": "hello\n" });
  try {
    git(dir, ["remote", "add", GF_REMOTE, remote.path]);
    const apiUrl = await stubApi();
    const err = await runSavePipeline(dir, { ...CFG, apiUrl }, {}).then(
      () => null,
      (e) => e,
    );
    assert.ok(err instanceof CliError);
    assert.equal(err.refusal, undefined);
    assert.match(err.message, /Could not reach|Another device/);
  } finally {
    cleanup(dir);
    remote.cleanup();
  }
});

test("alsoProtect paths ride the push as include options", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gf-remote-"));
  const bare = join(dir, "remote.git");
  git(dir, ["init", "-q", "--bare", bare]);
  git(bare, ["config", "receive.advertisePushOptions", "true"]);
  const logFile = join(dir, "options.log");
  writeFileSync(
    join(bare, "hooks", "pre-receive"),
    `#!/bin/sh\nenv | grep GIT_PUSH_OPTION > ${logFile} || true\nexit 0\n`,
    { mode: 0o755 },
  );
  const folder = folderWith({ ".env": "TOKEN=x\n", "notes.md": "n\n" });
  try {
    git(folder, ["remote", "add", GF_REMOTE, bare]);
    const apiUrl = await stubApi();
    const outcome = await runSavePipeline(folder, { ...CFG, apiUrl, alsoProtect: [".env"] }, { skipPush: false });
    assert.ok(outcome.sha);
    const log = readFileSync(logFile, "utf8");
    assert.match(log, /GIT_PUSH_OPTION_0=goodfolder-include=\.env/, log);
    // And the deliberately-included file actually landed upstream.
    assert.equal(git(bare, ["cat-file", "-e", "refs/heads/main"]).code, 0);
    const listing = git(bare, ["ls-tree", "-r", "--name-only", "refs/heads/main"]).stdout;
    assert.match(listing, /\.env/, "the protected file travelled with the save");
  } finally {
    cleanup(folder);
    cleanup(dir);
  }
});
