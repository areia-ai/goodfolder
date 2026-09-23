/**
 * The receive-pack parser and the push inspector, on synthetic history
 * built with real `git` in temporary repositories. Nothing here touches a
 * real folder.
 */

import assert from "node:assert/strict";
import { test, after } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { FileChange, RepositoryAdapter, Sql } from "@goodfolder/serverlib";
import { IGNORE_FILE, pushRefusalFor } from "@goodfolder/shared";
import { pktLine, FLUSH } from "./pktline.ts";
import { parseReceivePackBody, inspectPush } from "./inspect.ts";
import { runChecks, leftOutCheck } from "./gate.ts";
import { PackReader } from "./pack.ts";
import { screenSaveChanges, type RemoteDeps, type TreeEntry } from "../remote.ts";

const ZERO = "0".repeat(40);
const dirs: string[] = [];

after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A throwaway repository and helpers bound to it. */
function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), "gf-inspect-test-"));
  dirs.push(dir);
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo]);
  const git = (args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  const commitAll = (message: string): string => {
    git(["add", "-A"]);
    git(["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", message]);
    return git(["rev-parse", "HEAD"]);
  };
  const write = (path: string, content: string | Buffer) => writeFileSync(join(repo, path), content);
  const rm = (path: string) => rmSync(join(repo, path));
  const treeOf = (ref: string): TreeEntry[] => {
    const out = git(["ls-tree", "-r", ref]);
    if (!out) return [];
    return out.split("\n").map((line) => {
      const m = /^(\d+) (blob|tree|commit) ([0-9a-f]{40})\t(.+)$/.exec(line)!;
      return { path: m[4]!, type: m[2]!, sha: m[3]!, size: 0 } as TreeEntry;
    });
  };
  /** Pack every object reachable from `to` that `from` does not have. */
  const packBetween = (from: string | null, to: string): string => {
    const range = from ? `${from}..${to}` : to;
    const revs = git(["rev-list", "--objects", range]);
    const out = join(dir, `push-${Math.random().toString(36).slice(2)}.pack`);
    execFileSync("bash", ["-c", `git pack-objects --stdout --delta-base-offset > ${JSON.stringify(out)}`], {
      cwd: repo,
      input: revs,
    });
    return out;
  };
  const bodyFile = (buf: Buffer): string => {
    const p = join(dir, `body-${Math.random().toString(36).slice(2)}.bin`);
    writeFileSync(p, buf);
    return p;
  };
  return { dir, repo, git, commitAll, write, rm, treeOf, packBetween, bodyFile };
}

function body(commands: { oldId: string; newId: string; ref: string }[], caps: string[], pushOptions: string[], packPath: string | null): Buffer {
  const parts: Buffer[] = [];
  commands.forEach((c, i) => {
    let line = `${c.oldId} ${c.newId} ${c.ref}`;
    if (i === 0 && caps.length) line += `\0${caps.join(" ")}`;
    parts.push(pktLine(line));
  });
  parts.push(FLUSH);
  for (const o of pushOptions) parts.push(pktLine(o));
  if (pushOptions.length) parts.push(FLUSH);
  if (packPath) parts.push(readFileSync(packPath));
  return Buffer.concat(parts);
}

function fakeDeps(trees: Record<string, TreeEntry[]>, files: Record<string, Buffer>, head: string | null): RemoteDeps {
  const repos = {
    head: async () => head,
    tree: async (_p: string, ref = "main") => trees[ref] ?? [],
    readFile: async (_p: string, path: string, ref = "main") => {
      const content = files[`${ref}:${path}`];
      if (!content) return null;
      return { content, sha: "0".repeat(40), size: content.length };
    },
    changeFiles: async (_input: { changes: FileChange[] }) => ({ commitSha: "x" }),
  } as unknown as RepositoryAdapter;
  const sql = (async () => []) as unknown as Sql;
  sql.json = ((v: unknown) => v) as Sql["json"];
  return {
    sql,
    repos,
    writeAccessError: async () => null,
    refreshUsage: () => {},
    labelFor: async () => ({ label: "x", source: "agent" }),
  };
}

/** Inspect a synthetic push end to end: body → parse → pack → inspection. */
async function inspectBody(
  r: ReturnType<typeof mkRepo>,
  bodyBuf: Buffer,
  deps: RemoteDeps,
  opts: { isDevice: boolean },
) {
  const parsed = parseReceivePackBody(bodyBuf);
  const pack = await PackReader.open(r.bodyFile(bodyBuf), parsed.packOffset);
  try {
    return await inspectPush(deps, "p1", pack, parsed, opts);
  } finally {
    await pack.close();
  }
}

test("parseReceivePackBody reads commands, caps and push options", () => {
  const buf = body(
    [{ oldId: "a".repeat(40), newId: "b".repeat(40), ref: "refs/heads/main" }],
    ["report-status-v2", "side-band-64k", "push-options"],
    ["goodfolder-include=a.env"],
    null,
  );
  const parsed = parseReceivePackBody(buf);
  assert.equal(parsed.commands.length, 1);
  assert.equal(parsed.commands[0]!.ref, "refs/heads/main");
  assert.ok(parsed.capabilities.includes("push-options"));
  assert.deepEqual(parsed.pushOptions, ["goodfolder-include=a.env"]);
  assert.equal(parsed.packOffset, -1);
});

test("a flush-only probe body is forwarded unchecked", () => {
  const parsed = parseReceivePackBody(FLUSH);
  assert.equal(parsed.commands.length, 0);
});

test("gzip bodies parse after decoding", () => {
  const raw = body(
    [{ oldId: ZERO, newId: "b".repeat(40), ref: "refs/heads/main" }],
    ["report-status"],
    [],
    null,
  );
  const parsed = parseReceivePackBody(gzipSync(raw), true);
  assert.equal(parsed.commands.length, 1);
});

test("sha256 object format is refused as unreadable", () => {
  const buf = body(
    [{ oldId: ZERO, newId: "b".repeat(40), ref: "refs/heads/main" }],
    ["object-format=sha256"],
    [],
    null,
  );
  assert.throws(() => parseReceivePackBody(buf), /sha256/);
});

test("an intermediate save that added then removed a credential is refused", async () => {
  const r = mkRepo();
  r.write("notes.md", "hello\n");
  const c1 = r.commitAll("base");
  r.write(".env", "TOKEN=secret\n");
  r.commitAll("adds env");
  r.rm(".env");
  const tip = r.commitAll("removes env");

  const inspection = await inspectBody(
    r,
    body([{ oldId: c1, newId: tip, ref: "refs/heads/main" }], ["report-status"], [], r.packBetween(c1, tip)),
    fakeDeps({ [c1]: r.treeOf(c1), [tip]: r.treeOf(tip) }, {}, c1),
    { isDevice: true },
  );
  assert.ok(inspection.addedPaths.includes(".env"), `added: ${inspection.addedPaths}`);
  const refusals = leftOutCheck(inspection, { includedOnPurpose: [] });
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0]!.kind, "credentials");
});

test("a changed credential file is accepted — flagging is added-only", async () => {
  const r = mkRepo();
  r.write(".env", "TOKEN=one\n");
  const c1 = r.commitAll("env one");
  r.write(".env", "TOKEN=two\n");
  const tip = r.commitAll("env two");
  const inspection = await inspectBody(
    r,
    body([{ oldId: c1, newId: tip, ref: "refs/heads/main" }], ["report-status"], [], r.packBetween(c1, tip)),
    fakeDeps({ [c1]: r.treeOf(c1), [tip]: r.treeOf(tip) }, {}, c1),
    { isDevice: true },
  );
  assert.deepEqual(inspection.addedPaths, []);
  assert.equal(runChecks(inspection, { includedOnPurpose: [] }).length, 0);
});

test("a change-set carrying only paths the baseline already holds is accepted", async () => {
  const r = mkRepo();
  r.write("shared.txt", "one\n");
  r.commitAll("base");
  r.git(["checkout", "-qb", "side"]);
  r.write("shared.txt", "two\n");
  r.commitAll("side edit");
  r.git(["checkout", "-q", "-"]);
  r.write("shared.txt", "main edit\n");
  const c2 = r.commitAll("main edit");
  r.git(["merge", "-X", "theirs", "side", "-m", "merge", "-q"]);
  const tip = r.git(["rev-parse", "HEAD"]);
  const inspection = await inspectBody(
    r,
    body([{ oldId: c2, newId: tip, ref: "refs/heads/main" }], [], [], r.packBetween(c2, tip)),
    fakeDeps({ [c2]: r.treeOf(c2), [tip]: r.treeOf(tip) }, {}, c2),
    { isDevice: true },
  );
  assert.deepEqual(inspection.addedPaths, []);
});

test("a brand-new ref is baselined on main's tip", async () => {
  const r = mkRepo();
  r.write("exists.md", "x\n");
  const main = r.commitAll("main tip");
  const inspection = await inspectBody(
    r,
    body([{ oldId: ZERO, newId: main, ref: "refs/heads/feature" }], [], [], r.packBetween(null, main)),
    fakeDeps({ [main]: r.treeOf(main) }, {}, main),
    { isDevice: true },
  );
  assert.deepEqual(inspection.addedPaths, []);
});

test("deletions are accepted without inspection", async () => {
  const r = mkRepo();
  const parsed = parseReceivePackBody(
    body([{ oldId: "a".repeat(40), newId: ZERO, ref: "refs/heads/old" }], [], [], null),
  );
  const inspection = await inspectPush(fakeDeps({}, {}, null), "p1", null as unknown as PackReader, parsed, {
    isDevice: true,
  });
  assert.deepEqual(inspection.addedPaths, []);
});

test("the tip's own ignore list applies to the push that carries it", async () => {
  const r = mkRepo();
  r.write("keep.md", "k\n");
  const c1 = r.commitAll("base");
  r.write(IGNORE_FILE, "*.mov\n");
  r.write("clip.mov", "fake video\n");
  const tip = r.commitAll("adds ignore + mov");
  const inspection = await inspectBody(
    r,
    body([{ oldId: c1, newId: tip, ref: "refs/heads/main" }], [], [], r.packBetween(c1, tip)),
    fakeDeps({ [c1]: r.treeOf(c1), [tip]: r.treeOf(tip) }, {}, c1),
    { isDevice: true },
  );
  assert.deepEqual(inspection.ignorePatterns, ["*.mov"]);
  const refusals = leftOutCheck(inspection, { includedOnPurpose: [] });
  assert.deepEqual(refusals.map((x) => `${x.path}:${x.kind}`), ["clip.mov:ignored"]);
});

test("an ignore-listed add from the baseline list is refused", async () => {
  const r = mkRepo();
  r.write("keep.md", "k\n");
  r.write(IGNORE_FILE, "*.mov\n");
  const c1 = r.commitAll("base with ignore");
  r.write("clip.mov", "video\n");
  const tip = r.commitAll("adds mov");
  const inspection = await inspectBody(
    r,
    body([{ oldId: c1, newId: tip, ref: "refs/heads/main" }], [], [], r.packBetween(c1, tip)),
    fakeDeps(
      { [c1]: r.treeOf(c1), [tip]: r.treeOf(tip) },
      { [`${c1}:${IGNORE_FILE}`]: Buffer.from("*.mov\n") },
      c1,
    ),
    { isDevice: true },
  );
  const refusals = leftOutCheck(inspection, { includedOnPurpose: [] });
  assert.deepEqual(refusals.map((x) => `${x.path}:${x.kind}`), ["clip.mov:ignored"]);
});

test("an ignore list stored as a delta inside the pack is still read", async () => {
  const r = mkRepo();
  const rules = Array.from({ length: 60 }, (_, i) => `drafts/old-${i}/`).join("\n") + "\n";
  // A near-copy under the same file name (git groups delta candidates by
  // name, then deltas the smaller against the larger), so the root ignore
  // file is stored as a delta of it — asserted below.
  execFileSync("mkdir", ["-p", join(r.repo, "drafts")]);
  r.write("notes.md", "k\n");
  const c1 = r.commitAll("base");
  r.write(IGNORE_FILE, rules + "*.mov\n");
  r.write(`drafts/${IGNORE_FILE}`, rules + "*.mov\n# a longer draft kept for reference\n");
  r.write("clip.mov", "fake video\n");
  const tip = r.commitAll("adds ignore + mov");
  const packPath = r.packBetween(c1, tip);
  // Only meaningful if git really stored the ignore file as a delta.
  execFileSync("git", ["index-pack", packPath], { cwd: r.repo });
  const ignoreId = r.git(["rev-parse", `${tip}:${IGNORE_FILE}`]);
  const line = execFileSync("git", ["verify-pack", "-v", packPath], { cwd: r.repo, encoding: "utf8" })
    .split("\n")
    .find((l) => l.startsWith(ignoreId));
  assert.ok(line && line.trim().split(/\s+/).length >= 7, `ignore file should be a delta: ${line}`);
  const inspection = await inspectBody(
    r,
    body([{ oldId: c1, newId: tip, ref: "refs/heads/main" }], [], [], packPath),
    fakeDeps({ [c1]: r.treeOf(c1), [tip]: r.treeOf(tip) }, {}, c1),
    { isDevice: true },
  );
  assert.ok(inspection.ignorePatterns.includes("*.mov"), `patterns: ${inspection.ignorePatterns.length}`);
  const refusals = leftOutCheck(inspection, { includedOnPurpose: [] });
  assert.deepEqual(refusals.map((x) => `${x.path}:${x.kind}`), ["clip.mov:ignored"]);
});

test("a device include option passes; a service key's does not", async () => {
  const r = mkRepo();
  r.write("keep.md", "k\n");
  const c1 = r.commitAll("base");
  r.write(".env", "TOKEN=x\n");
  const tip = r.commitAll("adds env");
  const mkBody = () =>
    body(
      [{ oldId: c1, newId: tip, ref: "refs/heads/main" }],
      ["push-options"],
      ["goodfolder-include=.env"],
      r.packBetween(c1, tip),
    );
  for (const [isDevice, expectRefused] of [[true, false], [false, true]] as const) {
    const inspection = await inspectBody(
      r,
      mkBody(),
      fakeDeps({ [c1]: r.treeOf(c1), [tip]: r.treeOf(tip) }, {}, c1),
      { isDevice },
    );
    const refusals = leftOutCheck(inspection, { includedOnPurpose: inspection.includedOnPurpose });
    assert.equal(refusals.length > 0, expectRefused, `isDevice=${isDevice}`);
  }
});

test("pushRefusalFor and screenSaveChanges agree on a shared corpus", () => {
  const corpus = [
    ".env", ".env.local", "id_rsa", "id_ed25519", "cert.pem", "keys.p12",
    "cert.pfx", "app.keystore", "store.jks", "credentials", "Credentials",
    "clip.mov", "notes.md", "deck.key", "config.key.json", "dir/.env",
    "build/output.o", "dist/bundle.js", "node_modules/x/index.js",
  ];
  const ignorePatterns = ["*.mov", "dist/"];
  const present = new Set(corpus);
  const changes = corpus.map((path) => ({ path, kind: "added" as const }));
  const screening = screenSaveChanges(changes, { presentInTree: present, ignorePatterns, includedOnPurpose: [] });
  const viaHelper = corpus
    .map((path) => ({ path, hit: pushRefusalFor(path, ignorePatterns, (p) => present.has(p)) }))
    .filter((x) => x.hit !== null)
    .map((x) => ({ path: x.path, kind: x.hit!.kind, pattern: x.hit!.pattern }));
  assert.deepEqual(
    screening.flagged.map((f) => ({ path: f.path, kind: f.kind, pattern: f.pattern })),
    viaHelper,
  );
});
