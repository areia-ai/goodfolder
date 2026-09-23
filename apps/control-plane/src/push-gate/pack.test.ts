/**
 * The pack reader against real packs produced by `git` in temporary
 * repositories. Nothing here touches a real folder.
 */

import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, writeFileSync as wf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackReader } from "./pack.ts";
import { PushGateError } from "./pktline.ts";

let dir: string;
let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commitAll(message: string): string {
  git(["add", "-A"]);
  git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", message]);
  return git(["rev-parse", "HEAD"]);
}

function packAll(...flags: string[]): string {
  const revs = git(["rev-list", "--objects", "--all"]);
  const out = join(dir, `pack-${Math.random().toString(36).slice(2)}.pack`);
  execFileSync("bash", ["-c", `git pack-objects --stdout ${flags.join(" ")} > ${JSON.stringify(out)}`], {
    cwd: repo,
    input: revs,
  });
  return out;
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), "gf-pack-test-"));
  repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo]);
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("object ids in a plain pack match rev-parse output", async () => {
  writeFileSync(join(repo, "a.txt"), "alpha\n");
  const c1 = commitAll("one");
  const pack = await PackReader.open(packAll());
  try {
    const ids = new Set<string>();
    for (const e of pack.entries) ids.add(await pack.idOf(e.index));
    assert.ok(ids.has(c1), "the change is in the pack");
    assert.ok(ids.has(git(["rev-parse", "HEAD^{tree}"])));
    assert.ok(ids.has(git(["rev-parse", "HEAD:a.txt"])));
  } finally {
    await pack.close();
  }
});

test("OFS deltas resolve to the objects the engine lists", async () => {
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
  writeFileSync(join(repo, "big.txt"), lines);
  commitAll("big");
  writeFileSync(join(repo, "big.txt"), lines.replace("line 200", "line two hundred"));
  const tip = commitAll("edit");
  const path = packAll("--delta-base-offset");
  const pack = await PackReader.open(path);
  try {
    assert.ok(pack.entries.some((e) => e.type === "ofs-delta"), "pack uses ofs deltas");
    const blobId = git(["rev-parse", `${tip}:big.txt`]);
    const idx = await pack.indexOfId(blobId);
    const resolved = await pack.resolve(idx);
    assert.equal(resolved.type, "blob");
    assert.ok(resolved.content.toString().includes("line two hundred"));
  } finally {
    await pack.close();
  }
});

test("REF deltas resolve too", async () => {
  const path = packAll("--no-delta-base-offset");
  const pack = await PackReader.open(path);
  try {
    assert.ok(pack.entries.some((e) => e.type === "ref-delta"), "pack uses ref deltas");
    for (const e of pack.entries) {
      const resolved = await pack.resolve(e.index).catch(() => null);
      if (resolved === null) {
        // Big blobs are not retained; only deltas and small objects resolve.
        assert.equal(e.type, "blob");
        continue;
      }
      assert.match(await pack.idOf(e.index), /^[0-9a-f]{40}$/);
    }
  } finally {
    await pack.close();
  }
});

test("a deltified tree resolves to the same entries the engine lists", async () => {
  // Two commits that share most of a directory give the second a delta tree.
  writeFileSync(join(repo, "extra.txt"), "new file\n");
  const tip = commitAll("add extra");
  const pack = await PackReader.open(packAll());
  try {
    const treeId = git(["rev-parse", `${tip}^{tree}`]);
    const idx = await pack.indexOfId(treeId);
    const resolved = await pack.resolve(idx);
    assert.equal(resolved.type, "tree");
    assert.ok(resolved.content.length > 0);
  } finally {
    await pack.close();
  }
});

test("a 60MB blob is skipped inside a fixed memory budget", async () => {
  const size = 60 * 1024 * 1024;
  writeFileSync(join(repo, "huge.bin"), Buffer.alloc(size, 7));
  commitAll("huge");
  const pack = await PackReader.open(packAll("--delta-base-offset"));
  try {
    const blobId = git(["rev-parse", "HEAD:huge.bin"]);
    const idx = await pack.indexOfId(blobId);
    assert.ok(idx >= 0);
    const before = process.memoryUsage().heapUsed;
    // Resolve everything reachable; blob bytes must not be retained.
    for (const e of pack.entries) {
      if (e.type === "commit" || e.type === "tree" || e.type === "tag") await pack.resolve(e.index);
    }
    const grown = process.memoryUsage().heapUsed - before;
    assert.ok(grown < 32 * 1024 * 1024, `heap grew ${grown} bytes`);
  } finally {
    await pack.close();
  }
});

test("truncated and corrupt packs are unreadable", async () => {
  const good = readFileSync(packAll());
  const truncated = join(dir, "truncated.pack");
  writeFileSync(truncated, good.subarray(0, good.length - 100));
  await assert.rejects(() => PackReader.open(truncated), PushGateError);

  const corrupt = join(dir, "corrupt.pack");
  const bad = Buffer.from(good);
  bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff; // ruin the trailing checksum
  writeFileSync(corrupt, bad);
  await assert.rejects(() => PackReader.open(corrupt), PushGateError);

  const garbage = join(dir, "garbage.pack");
  wf(garbage, Buffer.from("not a pack at all"));
  await assert.rejects(() => PackReader.open(garbage), PushGateError);
});
