import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { git } from "./git.ts";
import { GF_REMOTE, pushCurrentHistory } from "./repo-setup.ts";

test("upload keeps the existing local history name untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "goodfolder-push-"));
  const folder = join(root, "folder");
  const remote = join(root, "remote.git");

  try {
    assert.equal(git(root, ["init", "-b", "master", folder]).code, 0);
    assert.equal(git(root, ["init", "--bare", remote]).code, 0);
    writeFileSync(join(folder, "recipe.txt"), "piña colada\n");
    assert.equal(git(folder, ["add", "recipe.txt"]).code, 0);
    assert.equal(
      git(folder, [
        "-c",
        "user.name=GoodFolder Test",
        "-c",
        "user.email=test@goodfolder.local",
        "commit",
        "-m",
        "First save",
      ]).code,
      0,
    );
    assert.equal(git(folder, ["remote", "add", GF_REMOTE, remote]).code, 0);

    const localHead = git(folder, ["rev-parse", "HEAD"]).stdout.trim();
    const pushed = pushCurrentHistory(folder);

    assert.equal(pushed.code, 0, pushed.stderr);
    assert.equal(git(folder, ["branch", "--show-current"]).stdout.trim(), "master");
    assert.equal(
      git(remote, ["rev-parse", "refs/heads/main"]).stdout.trim(),
      localHead,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
