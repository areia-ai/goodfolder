import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configPath, loadConfig, saveConfig, transportEnv, transportUrl, type FolderConfig } from "./config.ts";
import { git } from "./git.ts";
import { ensureRemote, GF_REMOTE } from "./repo-setup.ts";

const TOKEN = "a".repeat(64);
const PROJECT = "00000000-0000-4000-8000-000000000000";

/** Point the credential store at a scratch home for the test's duration. */
function withScratchHome<T>(run: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "goodfolder-home-"));
  const old = process.env.HOME;
  process.env.HOME = home;
  try {
    return run(home);
  } finally {
    if (old === undefined) delete process.env.HOME;
    else process.env.HOME = old;
    rmSync(home, { recursive: true, force: true });
  }
}

test("a folder's settings never hold the credential; the person's own file does", () => {
  withScratchHome((home) => {
    const gitDir = mkdtempSync(join(tmpdir(), "goodfolder-gitdir-"));
    try {
      const cfg: FolderConfig = { projectId: PROJECT, apiUrl: "https://gf.test", token: TOKEN, tokenExpiresAt: "2099-01-01T00:00:00.000Z", connectedAt: "2026-09-09T00:00:00.000Z" };
      saveConfig(gitDir, cfg);

      const written = readFileSync(configPath(gitDir), "utf8");
      assert.ok(!written.includes(TOKEN), "the credential must not be written into the folder");
      assert.ok(!written.includes("tokenExpiresAt"));
      assert.equal(statSync(configPath(gitDir)).mode & 0o777, 0o600);

      const store = readFileSync(join(home, ".config", "goodfolder", "folder-tokens.json"), "utf8");
      assert.ok(store.includes(TOKEN));
      assert.equal(statSync(join(home, ".config", "goodfolder", "folder-tokens.json")).mode & 0o777, 0o600);

      const loaded = loadConfig(gitDir);
      assert.equal(loaded?.token, TOKEN);
      assert.equal(loaded?.tokenExpiresAt, "2099-01-01T00:00:00.000Z");
    } finally {
      rmSync(gitDir, { recursive: true, force: true });
    }
  });
});

test("a folder set up before the change has its credential moved out on first load", () => {
  withScratchHome(() => {
    const gitDir = mkdtempSync(join(tmpdir(), "goodfolder-gitdir-"));
    try {
      writeFileSync(configPath(gitDir), JSON.stringify({ projectId: PROJECT, apiUrl: "https://gf.test", token: TOKEN, connectedAt: "2026-08-01T00:00:00.000Z" }));
      const loaded = loadConfig(gitDir);
      assert.equal(loaded?.token, TOKEN);
      assert.equal(loaded?.tokenExpiresAt, undefined, "age unknown until the server says");
      assert.ok(!readFileSync(configPath(gitDir), "utf8").includes(TOKEN));
      assert.equal(loadConfig(gitDir)?.token, TOKEN, "still readable from the store afterwards");
    } finally {
      rmSync(gitDir, { recursive: true, force: true });
    }
  });
});

test("a folder without any credential still counts as connected", () => {
  withScratchHome(() => {
    const gitDir = mkdtempSync(join(tmpdir(), "goodfolder-gitdir-"));
    try {
      writeFileSync(configPath(gitDir), JSON.stringify({ projectId: PROJECT, apiUrl: "https://gf.test", connectedAt: "2026-08-01T00:00:00.000Z" }));
      const loaded = loadConfig(gitDir);
      assert.equal(loaded?.projectId, PROJECT);
      assert.equal(loaded?.token, "");
    } finally {
      rmSync(gitDir, { recursive: true, force: true });
    }
  });
});

test("the credential travels with the command, and the written address is clean", () => {
  const cfg: FolderConfig = { projectId: PROJECT, apiUrl: "https://gf.test", token: TOKEN, connectedAt: "2026-09-09T00:00:00.000Z" };
  assert.equal(transportUrl(cfg), `https://gf.test/git/${PROJECT}`);
  const env = transportEnv(cfg);
  assert.equal(env.GIT_CONFIG_VALUE_0, `https://gf.test/git/${PROJECT}`);
  assert.equal(env.GIT_CONFIG_KEY_0, `url.https://x:${TOKEN}@gf.test/git/${PROJECT}.insteadOf`);
  assert.equal(env.GIT_CONFIG_VALUE_1, `https://x:${TOKEN}@gf.test/lfs/${PROJECT}`);
  assert.equal(env.GIT_CONFIG_KEY_2, "credential.helper");
  assert.equal(env.GIT_CONFIG_VALUE_2, "");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
});

test("an address that carried the credential is rewritten without it", () => {
  withScratchHome(() => {
    const root = mkdtempSync(join(tmpdir(), "goodfolder-remote-"));
    try {
      const folder = join(root, "folder");
      assert.equal(git(root, ["init", "-b", "main", folder]).code, 0);
      const cfg: FolderConfig = { projectId: PROJECT, apiUrl: "https://gf.test", token: TOKEN, connectedAt: "2026-09-09T00:00:00.000Z" };
      git(folder, ["remote", "add", GF_REMOTE, `https://x:${TOKEN}@gf.test/git/${PROJECT}`]);
      git(folder, ["config", "lfs.url", `https://x:${TOKEN}@gf.test/lfs/${PROJECT}`]);
      git(folder, ["config", `lfs.https://x:${TOKEN}@gf.test/lfs/${PROJECT}.locksverify`, "false"]);

      ensureRemote(folder, cfg);

      const config = readFileSync(join(folder, ".git", "config"), "utf8");
      assert.ok(!config.includes(TOKEN), "credential must be gone from the folder's settings");
      assert.equal(git(folder, ["remote", "get-url", GF_REMOTE]).stdout.trim(), transportUrl(cfg));
      assert.equal(git(folder, ["config", "--get", "lfs.url"]).stdout.trim(), `https://gf.test/lfs/${PROJECT}`);
      assert.equal(git(folder, ["config", "--local", "--get", "lfs.locksverify"]).stdout.trim(), "false");
      // And the engine still resolves the credentialed address for one command.
      assert.equal(git(folder, ["ls-remote", "--get-url", GF_REMOTE], undefined, transportEnv(cfg)).stdout.trim(), `https://x:${TOKEN}@gf.test/git/${PROJECT}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
