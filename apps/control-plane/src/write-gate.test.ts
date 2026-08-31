import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWrite, filesUnder, type TreeEntry } from "./write-gate.ts";

const MB = 1024 * 1024;

const FOLDER: TreeEntry[] = [
  { path: "package.json", type: "blob" },
  { path: "README.md", type: "blob" },
  { path: "notes", type: "blob" },
  { path: "figures", type: "tree" },
  { path: "figures/chart.png", type: "blob" },
];

function allow(request: Parameters<typeof checkWrite>[0]) {
  const result = checkWrite(request);
  assert.equal(result.ok, true, result.ok ? "" : result.refusal.message);
  return result.ok ? result.plan : null!;
}

function deny(request: Parameters<typeof checkWrite>[0]) {
  const result = checkWrite(request);
  assert.equal(result.ok, false, "expected a refusal");
  return result.ok ? null! : result.refusal;
}

test("a plain write is allowed and routed", () => {
  const plan = allow({ tree: FOLDER, writes: [{ path: "figures/summary.md", sizeBytes: 4_000 }] });
  assert.deepEqual(plan, {
    writes: [{ path: "figures/summary.md", sizeBytes: 4_000, target: "git" }],
    removes: [],
  });
});

test("big media goes to the other store, big text does not", () => {
  const media = allow({ tree: FOLDER, writes: [{ path: "figures/cover.jpg", sizeBytes: 4 * MB }] });
  assert.equal(media.writes[0]!.target, "lfs");
  const text = allow({ tree: FOLDER, writes: [{ path: "transcript.md", sizeBytes: 4 * MB }] });
  assert.equal(text.writes[0]!.target, "git");
});

test("past the ceiling is refused, in a size a person reads", () => {
  const refusal = deny({ tree: FOLDER, writes: [{ path: "raw.mov", sizeBytes: 240 * MB }] });
  assert.equal(refusal.code, "too-large");
  assert.equal(refusal.status, 413);
  assert.match(refusal.message, /“raw\.mov” is 240 MB\. The largest file the browser can add is 100 MB\./);
});

test("what a save leaves out cannot be dropped in instead", () => {
  const credentials = deny({ tree: FOLDER, writes: [{ path: ".env", sizeBytes: 90 }] });
  assert.equal(credentials.code, "left-out");
  assert.equal(credentials.message, "GoodFolder leaves out files that look like they hold passwords or keys, and “.env” is one of them.");

  assert.equal(deny({ tree: FOLDER, writes: [{ path: "node_modules/react/index.js", sizeBytes: 12 }] }).code, "left-out");
  // `dist/` only counts as rebuilt output beside a package.json — and there is one.
  assert.equal(deny({ tree: FOLDER, writes: [{ path: "dist/app.js", sizeBytes: 12 }] }).code, "left-out");
  assert.equal(checkWrite({ tree: [], writes: [{ path: "dist/app.js", sizeBytes: 12 }] }).ok, true);
});

test("the example file a person keeps on purpose still goes in", () => {
  allow({ tree: FOLDER, writes: [{ path: ".env.example", sizeBytes: 40 }] });
});

test("a name differing only in case is refused, naming both", () => {
  const refusal = deny({ tree: FOLDER, writes: [{ path: "readme.md", sizeBytes: 10 }] });
  assert.equal(refusal.code, "name-collision");
  assert.equal(refusal.status, 409);
  assert.equal(refusal.message, "“readme.md” is too similar to “README.md”. Choose a different name.");
});

test("two arrivals that collide with each other are refused too", () => {
  assert.equal(
    deny({ tree: FOLDER, writes: [{ path: "a/Notes.md", sizeBytes: 1 }, { path: "a/notes.md", sizeBytes: 1 }] }).code,
    "name-collision",
  );
});

test("changing nothing but a capital letter is a rename, not a collision", () => {
  const plan = allow({
    tree: FOLDER,
    writes: [{ path: "readme.md", sizeBytes: 10 }],
    removes: ["README.md"],
  });
  assert.deepEqual(plan.removes, ["README.md"]);
  assert.equal(plan.writes[0]!.path, "readme.md");
});

test("a rename into a folder carries the whole change at once", () => {
  const plan = allow({
    tree: FOLDER,
    writes: [{ path: "figures/cover.png", sizeBytes: 900 }],
    removes: ["figures/chart.png"],
  });
  assert.deepEqual(plan.removes, ["figures/chart.png"]);
});

test("taking out something that isn't there changes nothing", () => {
  const refusal = deny({ tree: FOLDER, removes: ["gone.md"] });
  assert.equal(refusal.code, "not-found");
  assert.equal(refusal.status, 404);
  // A folder is not a file, and this gate only takes files out.
  assert.equal(deny({ tree: FOLDER, removes: ["figures"] }).code, "not-found");
});

test("names that escape the folder, or no filesystem keeps, are refused", () => {
  for (const path of [
    "../secrets.md",
    "/etc/passwd",
    "a//b.md",
    "a/./b.md",
    ".git/config",
    ".GIT/hooks/pre-commit",
    "notes ",
    "folder./x.md",
    "back\\slash.md",
    `bell${String.fromCharCode(7)}.md`,
    "x".repeat(513),
  ]) {
    assert.equal(deny({ tree: FOLDER, writes: [{ path, sizeBytes: 1 }] }).code, "path", path);
  }
});

test("the same name twice in one change is refused", () => {
  const refusal = deny({
    tree: FOLDER,
    writes: [{ path: "a.md", sizeBytes: 1 }, { path: "a.md", sizeBytes: 2 }],
  });
  assert.equal(refusal.code, "path");
  assert.equal(refusal.message, "The same name arrived twice. Send each file once.");
});

test("a folder can't become a file, and nothing goes inside a file", () => {
  assert.equal(
    deny({ tree: FOLDER, writes: [{ path: "figures", sizeBytes: 10 }] }).message,
    "“figures” is already a folder here. Choose a different name.",
  );
  assert.equal(
    deny({ tree: FOLDER, writes: [{ path: "notes/today.md", sizeBytes: 10 }] }).message,
    "“notes” is a file, so nothing can go inside it.",
  );
});

test("a file taken out in the same change stops being in the way", () => {
  allow({
    tree: FOLDER,
    writes: [{ path: "notes/today.md", sizeBytes: 10 }],
    removes: ["notes"],
  });
});

test("an empty change is allowed and does nothing", () => {
  assert.deepEqual(allow({ tree: FOLDER }), { writes: [], removes: [] });
});

test("a file already in the folder can still be edited", () => {
  // Someone chose to protect a `.env` from the command line. Refusing to let
  // them edit what is already there would be overruling that after the fact.
  allow({
    tree: [...FOLDER, { path: ".env", type: "blob" }],
    writes: [{ path: ".env", sizeBytes: 120 }],
  });
});

const SIZED = [
  { path: "notes", type: "blob" as const, size: 10 },
  { path: "notes-old", type: "tree" as const, size: 0 },
  { path: "notes-old/a.md", type: "blob" as const, size: 20 },
  { path: "figures", type: "tree" as const, size: 0 },
  { path: "figures/chart.png", type: "blob" as const, size: 30 },
  { path: "figures/deep", type: "tree" as const, size: 0 },
  { path: "figures/deep/b.png", type: "blob" as const, size: 40 },
];

test("choosing a folder chooses everything inside it", () => {
  assert.deepEqual(filesUnder(SIZED, ["figures"]), [
    { path: "figures/chart.png", size: 30 },
    { path: "figures/deep/b.png", size: 40 },
  ]);
});

test("a name that merely starts the same is not chosen", () => {
  assert.deepEqual(filesUnder(SIZED, ["notes"]), [{ path: "notes", size: 10 }]);
});

test("choosing a file and the folder holding it counts it once", () => {
  assert.deepEqual(filesUnder(SIZED, ["figures", "figures/chart.png"]), [
    { path: "figures/chart.png", size: 30 },
    { path: "figures/deep/b.png", size: 40 },
  ]);
});

test("choosing nothing that is there yields nothing", () => {
  assert.deepEqual(filesUnder(SIZED, ["gone", "figures/gone.png"]), []);
});
