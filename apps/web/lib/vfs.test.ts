import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ancestorsOf,
  baseName,
  breadcrumb,
  buildChangeIndex,
  buildReviewIndex,
  buildTree,
  changedBucket,
  compareNames,
  descendantFiles,
  directoryCount,
  directoryName,
  directorySize,
  filterNodes,
  flattenRows,
  filterRoot,
  folderChildren,
  groupNodes,
  joinPath,
  kindLabel,
  locationHref,
  locationKey,
  locationOf,
  locationQuery,
  normalizePath,
  parentLocation,
  parseLocation,
  rootChildren,
  ROOT_SCOPES,
  sameLocation,
  sortNodes,
  type Location,
  type VfsNode,
} from "./vfs.ts";
import type { ChangeProposal, Folder, FolderFile, SaveRow } from "./gf-api.ts";

function file(path: string, size = 100): FolderFile {
  return { path, size, sha: `sha-${path}`, editable: false, previewable: true };
}

const TREE_FILES = [
  file("README.md", 10),
  file("figures/revenue.xlsx", 200),
  file("figures/old/2024.xlsx", 30),
  file("notes/meeting.md", 5),
];

/* ------------------------------------------------------------------ Paths */

test("normalizePath tidies what a path can arrive as", () => {
  assert.equal(normalizePath("a/b.txt"), "a/b.txt");
  assert.equal(normalizePath("./a//b.txt"), "a/b.txt");
  assert.equal(normalizePath("/a/b.txt/"), "a/b.txt");
  assert.equal(normalizePath("../../etc/passwd"), "etc/passwd");
  assert.equal(normalizePath(""), "");
  assert.equal(normalizePath("///"), "");
});

test("baseName, directoryName and joinPath agree with each other", () => {
  assert.equal(baseName("a/b/c.txt"), "c.txt");
  assert.equal(baseName("c.txt"), "c.txt");
  assert.equal(directoryName("a/b/c.txt"), "a/b");
  assert.equal(directoryName("c.txt"), "");
  assert.equal(joinPath("a/b", "c.txt"), "a/b/c.txt");
  assert.equal(joinPath("", "c.txt"), "c.txt");
});

test("ancestorsOf lists the directories above a path, outermost first", () => {
  assert.deepEqual(ancestorsOf("a/b/c/d.txt"), ["a", "a/b", "a/b/c"]);
  assert.deepEqual(ancestorsOf("d.txt"), []);
});

/* ------------------------------------------------------------------- Tree */

test("buildTree rebuilds the hierarchy from flat paths", () => {
  const index = buildTree(TREE_FILES);
  assert.deepEqual(index.entries.get("")!.directories.sort(), ["figures", "notes"]);
  assert.deepEqual(index.entries.get("")!.files.map((f) => f.path), ["README.md"]);
  assert.deepEqual(index.entries.get("figures")!.directories, ["figures/old"]);
  assert.deepEqual(index.entries.get("figures")!.files.map((f) => f.path), ["figures/revenue.xlsx"]);
  assert.deepEqual(index.entries.get("figures/old")!.directories, []);
  assert.equal(index.byPath.size, 4);
});

test("buildTree rolls size and count all the way up", () => {
  const index = buildTree(TREE_FILES);
  assert.equal(directorySize(index, ""), 245);
  assert.equal(directorySize(index, "figures"), 230);
  assert.equal(directorySize(index, "figures/old"), 30);
  assert.equal(directoryCount(index, ""), 4);
  assert.equal(directoryCount(index, "figures"), 2);
  assert.equal(directorySize(index, "nothing/here"), 0);
});

test("buildTree normalizes paths as it goes", () => {
  const index = buildTree([file("./a//b.txt"), file("/c.txt")]);
  assert.deepEqual([...index.byPath.keys()].sort(), ["a/b.txt", "c.txt"]);
  assert.deepEqual(index.entries.get("")!.directories, ["a"]);
});

test("buildTree survives a file and a directory sharing a name", () => {
  const index = buildTree([file("a"), file("a/b.txt")]);
  const top = index.entries.get("")!;
  assert.deepEqual(top.directories, ["a"]);
  assert.deepEqual(top.files.map((f) => f.path), ["a"]);
});

test("buildTree survives siblings that differ only by case", () => {
  // The case gate means these should never both reach a Save. The window must
  // still draw them rather than losing one or throwing.
  const index = buildTree([file("README.md"), file("readme.md")]);
  assert.equal(index.entries.get("")!.files.length, 2);
});

test("buildTree of an empty folder still has a top level", () => {
  const index = buildTree([]);
  assert.deepEqual(index.entries.get(""), { directories: [], files: [] });
  assert.equal(directoryCount(index, ""), 0);
});

/* --------------------------------------------------------- When it changed */

function save(seq: number, at: string, paths: string[], extra: Partial<SaveRow> = {}): SaveRow {
  return { seq, label: `Save ${seq}`, createdAt: at, changedPaths: paths, ...extra };
}

test("buildChangeIndex keeps the newest Save that touched each file", () => {
  const index = buildChangeIndex([
    save(3, "2026-08-30T10:00:00Z", ["figures/revenue.xlsx"]),
    save(2, "2026-08-29T10:00:00Z", ["figures/revenue.xlsx", "README.md"]),
  ]);
  assert.equal(index.files.get("figures/revenue.xlsx")!.seq, 3);
  assert.equal(index.files.get("README.md")!.seq, 2);
  assert.equal(index.partial, false);
});

test("buildChangeIndex rolls the newest stamp up to each directory", () => {
  const index = buildChangeIndex([
    save(2, "2026-08-30T10:00:00Z", ["figures/old/2024.xlsx"]),
    save(1, "2026-08-01T10:00:00Z", ["figures/revenue.xlsx"]),
  ]);
  assert.equal(index.directories.get("figures")!.seq, 2);
  assert.equal(index.directories.get("figures/old")!.seq, 2);
  assert.equal(index.directories.get("")!.seq, 2);
});

test("buildChangeIndex sorts an out-of-order timeline before folding it", () => {
  const index = buildChangeIndex([
    save(1, "2026-08-01T10:00:00Z", ["a.md"]),
    save(5, "2026-08-30T10:00:00Z", ["a.md"]),
  ]);
  assert.equal(index.files.get("a.md")!.seq, 5);
});

test("buildChangeIndex says when the timeline it read was capped", () => {
  const truncated = buildChangeIndex([save(1, "2026-08-30T10:00:00Z", ["a.md"], { changedPathsTruncated: true })]);
  assert.equal(truncated.partial, true);

  const capped = buildChangeIndex(
    Array.from({ length: 4 }, (_, i) => save(i + 1, "2026-08-30T10:00:00Z", ["a.md"])),
    4,
  );
  assert.equal(capped.partial, true);
});

test("buildChangeIndex falls back to the headline paths, and admits it", () => {
  const index = buildChangeIndex([
    { seq: 1, label: "Save 1", createdAt: "2026-08-30T10:00:00Z", topPaths: ["a.md"] },
  ]);
  assert.equal(index.files.get("a.md")!.seq, 1);
  assert.equal(index.partial, true);
});

/* ------------------------------------------------------ Waiting for review */

function proposal(status: ChangeProposal["status"], paths: string[]): ChangeProposal {
  return {
    id: `p-${paths.join("-")}-${status}`,
    title: "Suggested change",
    explanation: "",
    status,
    createdAt: "2026-08-30T10:00:00Z",
    authorEmail: "someone@example.com",
    suggestions: paths.map((path, i) => ({
      id: `s${i}`,
      path,
      kind: "text_replace" as const,
      before: "",
      replacement: "",
      explanation: "",
      status,
    })),
  };
}

test("buildReviewIndex counts only what is still waiting on a decision", () => {
  const index = buildReviewIndex([
    proposal("open", ["figures/revenue.xlsx"]),
    proposal("needs-review", ["figures/revenue.xlsx"]),
    proposal("accepted", ["figures/revenue.xlsx"]),
    proposal("rejected", ["README.md"]),
  ]);
  assert.equal(index.get("figures/revenue.xlsx"), 2);
  assert.equal(index.get("README.md"), undefined);
  assert.equal(index.get("figures"), 2);
  assert.equal(index.get(""), 2);
});

test("buildReviewIndex counts one proposal once, however many suggestions it carries", () => {
  const index = buildReviewIndex([proposal("open", ["a.md", "a.md"])]);
  assert.equal(index.get("a.md"), 1);
});

/* ------------------------------------------------------------------ Nodes */

function folder(id: string, name: string, extra: Partial<Folder> = {}): Folder {
  return { id, name, ...extra };
}

test("rootChildren turns GoodFolders into folders you can open", () => {
  const nodes = rootChildren([
    folder("f1", "Q3 Report", { lastSaveAt: "2026-08-30T10:00:00Z", lastSeq: 24, openProposalCount: 2 }),
    folder("f2", "Recipe Book"),
  ]);
  assert.equal(nodes[0]!.kind, "folder");
  assert.equal(nodes[0]!.name, "Q3 Report");
  assert.equal(nodes[0]!.size, null, "a GoodFolder's byte size is not something we know here");
  assert.deepEqual(nodes[0]!.changed, { at: "2026-08-30T10:00:00Z", seq: 24 });
  assert.equal(nodes[0]!.reviewCount, 2);
  assert.equal(nodes[1]!.changed, null);
});

test("folderChildren lists one directory's immediate children, decorated", () => {
  const index = buildTree(TREE_FILES);
  const changed = buildChangeIndex([save(7, "2026-08-30T10:00:00Z", ["figures/revenue.xlsx"])]);
  const review = buildReviewIndex([proposal("open", ["figures/revenue.xlsx"])]);
  const nodes = folderChildren(index, "f1", "figures", { changed, review });

  const directory = nodes.find((n) => n.kind === "directory")!;
  assert.equal(directory.name, "old");
  assert.equal(directory.size, 30);

  const sheet = nodes.find((n) => n.kind === "file")!;
  assert.equal(sheet.name, "revenue.xlsx");
  assert.equal(sheet.changed!.seq, 7);
  assert.equal(sheet.reviewCount, 1);
});

test("folderChildren of an unknown directory is empty, not an error", () => {
  assert.deepEqual(folderChildren(buildTree(TREE_FILES), "f1", "nowhere"), []);
});

test("descendantFiles reaches everything beneath a directory", () => {
  const index = buildTree(TREE_FILES);
  assert.equal(descendantFiles(index, "f1", "").length, 4);
  assert.deepEqual(
    descendantFiles(index, "f1", "figures").map((n) => n.path).sort(),
    ["figures/old/2024.xlsx", "figures/revenue.xlsx"],
  );
});

test("descendantFiles does not treat a name prefix as a directory", () => {
  const index = buildTree([file("figures/a.md"), file("figures-old/b.md")]);
  assert.deepEqual(descendantFiles(index, "f1", "figures").map((n) => n.path), ["figures/a.md"]);
});

/* ------------------------------------------------------- Kind, sort, group */

test("kindLabel names each row in words", () => {
  const index = buildTree(TREE_FILES);
  const [directory] = folderChildren(index, "f1", "figures");
  assert.equal(kindLabel(directory!), "Folder");
  assert.equal(kindLabel(rootChildren([folder("f1", "Q3")])[0]!), "GoodFolder");
  assert.equal(kindLabel(folderChildren(index, "f1", "")[2]!), "Markdown document");
});

test("compareNames orders numbers the way a person reads them", () => {
  const names = ["file10.md", "file2.md", "File1.md"].sort(compareNames);
  assert.deepEqual(names, ["File1.md", "file2.md", "file10.md"]);
});

test("sortNodes keeps folders above files in both directions", () => {
  const index = buildTree(TREE_FILES);
  const nodes = folderChildren(index, "f1", "");
  for (const direction of ["asc", "desc"] as const) {
    const sorted = sortNodes(nodes, "name", direction);
    const firstFile = sorted.findIndex((n) => n.kind === "file");
    const lastDirectory = sorted.map((n) => n.kind).lastIndexOf("directory");
    assert.ok(lastDirectory < firstFile, `folders drift below files sorting ${direction}`);
  }
});

test("sortNodes orders by size, and by when something last changed", () => {
  const index = buildTree(TREE_FILES);
  const changed = buildChangeIndex([
    save(2, "2026-08-30T10:00:00Z", ["notes/meeting.md"]),
    save(1, "2026-08-01T10:00:00Z", ["README.md"]),
  ]);
  const files = folderChildren(index, "f1", "", { changed }).filter((n) => n.kind === "file");
  const bigger = sortNodes(folderChildren(index, "f1", ""), "size", "desc")
    .filter((n) => n.kind === "directory")
    .map((n) => n.name);
  assert.deepEqual(bigger, ["figures", "notes"]);
  assert.deepEqual(sortNodes(files, "changed", "desc").map((n) => n.name), ["README.md"]);
});

test("sortNodes sinks what it does not know to the bottom, whichever way you sort", () => {
  const known: VfsNode = {
    kind: "file", id: "a", folderId: "f", path: "a.md", file: file("a.md"),
    name: "a.md", size: 1, changed: { at: "2026-08-30T10:00:00Z", seq: 1 }, reviewCount: 0,
  };
  const unknown: VfsNode = { ...known, id: "b", path: "b.md", name: "b.md", changed: null };
  for (const direction of ["asc", "desc"] as const) {
    const sorted = sortNodes([unknown, known], "changed", direction);
    assert.equal(sorted[1]!.name, "b.md", `an unknown date floated up sorting ${direction}`);
  }
});

test("sortNodes falls back to the name so the order never wobbles", () => {
  const index = buildTree([file("b.md", 5), file("a.md", 5), file("c.md", 5)]);
  const sorted = sortNodes(folderChildren(index, "f1", ""), "size", "asc");
  assert.deepEqual(sorted.map((n) => n.name), ["a.md", "b.md", "c.md"]);
});

test("changedBucket puts a date in the same words Finder does", () => {
  const now = Date.parse("2026-08-30T12:00:00Z");
  assert.equal(changedBucket({ at: "2026-08-30T10:00:00Z", seq: 1 }, now), "Today");
  assert.equal(changedBucket({ at: "2026-08-29T10:00:00Z", seq: 1 }, now), "Yesterday");
  assert.equal(changedBucket({ at: "2026-08-26T10:00:00Z", seq: 1 }, now), "Previous 7 days");
  assert.equal(changedBucket({ at: "2026-08-10T10:00:00Z", seq: 1 }, now), "Previous 30 days");
  assert.equal(changedBucket({ at: "2025-01-10T10:00:00Z", seq: 1 }, now), "Earlier");
  assert.equal(changedBucket(null, now), "Not known");
});

test("groupNodes keeps the sort order inside each group", () => {
  const index = buildTree(TREE_FILES);
  const nodes = sortNodes(folderChildren(index, "f1", ""), "name");
  assert.deepEqual(groupNodes(nodes, "none").map((g) => g.nodes.length), [3]);
  const byKind = groupNodes(nodes, "kind");
  assert.deepEqual(byKind.map((g) => g.label), ["Folder", "Markdown document"]);
  assert.deepEqual(byKind[0]!.nodes.map((n) => n.name), ["figures", "notes"]);
});

test("groupNodes orders date buckets by recency, not alphabetically", () => {
  const now = Date.parse("2026-08-30T12:00:00Z");
  const index = buildTree([file("new.md"), file("old.md")]);
  const changed = buildChangeIndex([
    save(2, "2026-08-30T10:00:00Z", ["new.md"]),
    save(1, "2020-01-01T10:00:00Z", ["old.md"]),
  ]);
  const groups = groupNodes(folderChildren(index, "f1", "", { changed }), "changed", now);
  assert.deepEqual(groups.map((g) => g.label), ["Today", "Earlier"]);
});

/* ----------------------------------------------------------------- Search */

test("filterNodes matches a name, or anywhere in the path", () => {
  const index = buildTree(TREE_FILES);
  const nodes = descendantFiles(index, "f1", "");
  assert.deepEqual(filterNodes(nodes, "REVENUE").map((n) => n.name), ["revenue.xlsx"]);
  assert.deepEqual(filterNodes(nodes, "figures/old").map((n) => n.name), ["2024.xlsx"]);
  assert.equal(filterNodes(nodes, "   ").length, 4);
});

/* ---------------------------------------------------------------- Address */

test("parseLocation reads the root when no folder is named", () => {
  assert.deepEqual(parseLocation(""), { folderId: null, dir: "", file: null, scope: "all" });
  assert.deepEqual(parseLocation("?path=figures"), { folderId: null, dir: "", file: null, scope: "all" });
});

test("parseLocation keeps the meaning the Site tools already rely on", () => {
  const at = parseLocation("?folder=f1&file=figures%2Frevenue.xlsx");
  assert.equal(at.folderId, "f1");
  assert.equal(at.file, "figures/revenue.xlsx");
  assert.equal(at.dir, "figures", "an open file implies the directory holding it");
});

test("parseLocation lets an open file settle a disagreement about the directory", () => {
  const at = parseLocation("?folder=f1&path=notes&file=figures/revenue.xlsx");
  assert.equal(at.dir, "figures");
});

test("locationQuery writes folder, path and file, and nothing else", () => {
  assert.equal(locationQuery({ folderId: null, dir: "", file: null, scope: "all" }), "");
  assert.equal(locationQuery({ folderId: "f1", dir: "", file: null, scope: "all" }), "?folder=f1");
  assert.equal(locationQuery({ folderId: "f1", dir: "figures", file: null, scope: "all" }), "?folder=f1&path=figures");
  assert.equal(
    locationQuery({ folderId: "f1", dir: "figures", file: "figures/a b.md", scope: "all" }),
    "?folder=f1&path=figures&file=figures%2Fa+b.md",
  );
  assert.equal(locationHref({ folderId: "f1", dir: "", file: null, scope: "all" }), "/dashboard?folder=f1");
});

test("an address survives a round trip through the browser", () => {
  const places: Location[] = [
    { folderId: null, dir: "", file: null, scope: "all" },
    { folderId: "f1", dir: "", file: null, scope: "all" },
    { folderId: "f1", dir: "figures/old", file: null, scope: "all" },
    { folderId: "f1", dir: "figures", file: "figures/revenue.xlsx", scope: "all" },
  ];
  for (const place of places) {
    assert.deepEqual(parseLocation(locationQuery(place)), place);
    assert.ok(sameLocation(parseLocation(locationQuery(place)), place));
  }
});

test("locationKey names a place, so it can remember how it was shown", () => {
  assert.equal(locationKey({ folderId: null, dir: "", file: null, scope: "all" }), "root");
  assert.equal(locationKey({ folderId: "f1", dir: "", file: null, scope: "all" }), "f1");
  assert.equal(locationKey({ folderId: "f1", dir: "figures", file: null, scope: "all" }), "f1:figures");
  assert.equal(
    locationKey({ folderId: "f1", dir: "figures", file: "figures/a.md", scope: "all" }),
    "f1:figures",
    "opening a file does not change which place you are in",
  );
});

test("parentLocation walks back out one step at a time", () => {
  const deep: Location = { folderId: "f1", dir: "figures", file: "figures/a.md", scope: "all" };
  const closed = parentLocation(deep)!;
  assert.deepEqual(closed, { folderId: "f1", dir: "figures", file: null, scope: "all" });
  assert.deepEqual(parentLocation(closed), { folderId: "f1", dir: "", file: null, scope: "all" });
  assert.deepEqual(parentLocation({ folderId: "f1", dir: "", file: null, scope: "all" }), { folderId: null, dir: "", file: null, scope: "all" });
  assert.equal(parentLocation({ folderId: null, dir: "", file: null, scope: "all" }), null);
});

test("locationOf sends you where opening a thing should send you", () => {
  const index = buildTree(TREE_FILES);
  const nodes = folderChildren(index, "f1", "figures");
  assert.deepEqual(locationOf(nodes.find((n) => n.kind === "directory")!), {
    folderId: "f1", dir: "figures/old", file: null, scope: "all",
  });
  assert.deepEqual(locationOf(nodes.find((n) => n.kind === "file")!), {
    folderId: "f1", dir: "figures", file: "figures/revenue.xlsx", scope: "all",
  });
  assert.deepEqual(locationOf(rootChildren([folder("f1", "Q3")])[0]!), {
    folderId: "f1", dir: "", file: null, scope: "all",
  });
});

test("breadcrumb names every step back to the root", () => {
  const crumbs = breadcrumb({ folderId: "f1", dir: "figures/old", file: "figures/old/2024.xlsx", scope: "all" }, "Q3 Report");
  assert.deepEqual(crumbs.map((c) => c.label), ["GoodFolder", "Q3 Report", "figures", "old", "2024.xlsx"]);
  assert.deepEqual(crumbs[2]!.location, { folderId: "f1", dir: "figures", file: null, scope: "all" });
  assert.deepEqual(breadcrumb({ folderId: null, dir: "", file: null, scope: "all" }, null).map((c) => c.label), ["GoodFolder"]);
});

test("a sidebar place is a place: it survives the address", () => {
  for (const scope of ROOT_SCOPES) {
    const place: Location = { folderId: null, dir: "", file: null, scope };
    assert.deepEqual(parseLocation(locationQuery(place)), place, scope);
  }
  assert.equal(locationQuery({ folderId: null, dir: "", file: null, scope: "all" }), "");
  assert.equal(locationQuery({ folderId: null, dir: "", file: null, scope: "review" }), "?in=review");
});

test("an unrecognised sidebar place falls back to all folders", () => {
  assert.equal(parseLocation("?in=nonsense").scope, "all");
});

test("opening a folder leaves the sidebar place behind", () => {
  assert.equal(parseLocation("?in=review&folder=f1").scope, "all");
  assert.equal(locationKey({ folderId: null, dir: "", file: null, scope: "review" }), "root:review");
});

test("filterRoot narrows the root the way each sidebar place says", () => {
  const nodes = rootChildren([
    folder("f1", "Mine", { lastSaveAt: "2026-08-30T10:00:00Z", lastSeq: 3, openProposalCount: 2 }),
    folder("f2", "Theirs", { role: "contributor" }),
    folder("f3", "Untouched"),
  ]);
  assert.deepEqual(filterRoot(nodes, "all").map((n) => n.name), ["Mine", "Theirs", "Untouched"]);
  assert.deepEqual(filterRoot(nodes, "shared").map((n) => n.name), ["Theirs"]);
  assert.deepEqual(filterRoot(nodes, "review").map((n) => n.name), ["Mine"]);
  assert.deepEqual(filterRoot(nodes, "recent").map((n) => n.name), ["Mine"]);
});

test("breadcrumb names the sidebar place you are standing in", () => {
  const crumbs = breadcrumb({ folderId: null, dir: "", file: null, scope: "review" }, null);
  assert.deepEqual(crumbs.map((c) => c.label), ["GoodFolder", "Waiting for review"]);
});

/* ------------------------------------------------------------------ Rows */

test("flattenRows folds an opened directory in under its own row", () => {
  const index = buildTree(TREE_FILES);
  const rows = flattenRows({
    nodes: folderChildren(index, "f1", ""),
    index, folderId: "f1",
    expanded: new Set(["figures"]),
    sort: "name", direction: "asc",
  });
  assert.deepEqual(rows.map((row) => `${"·".repeat(row.level)}${row.node.name}`), [
    "figures", "·old", "·revenue.xlsx", "notes", "README.md",
  ]);
  assert.equal(rows[0]!.expanded, true);
  assert.equal(rows[1]!.expanded, false, "a directory inside an opened one starts closed");
  assert.equal(rows[4]!.expandable, false, "a file has nothing to open");
});

test("flattenRows opens more than one level at a time", () => {
  const index = buildTree(TREE_FILES);
  const rows = flattenRows({
    nodes: folderChildren(index, "f1", ""),
    index, folderId: "f1",
    expanded: new Set(["figures", "figures/old"]),
    sort: "name", direction: "asc",
  });
  assert.deepEqual(rows.map((row) => row.node.name), [
    "figures", "old", "2024.xlsx", "revenue.xlsx", "notes", "README.md",
  ]);
});

test("flattenRows sorts every level, not only the top", () => {
  const index = buildTree(TREE_FILES);
  const rows = flattenRows({
    nodes: folderChildren(index, "f1", ""),
    index, folderId: "f1",
    expanded: new Set(["figures"]),
    sort: "name", direction: "desc",
  });
  // Descending, but folders still sit above files at every level — so inside
  // `figures` the directory comes first and the sheet follows it.
  assert.deepEqual(rows.map((row) => row.node.name), [
    "notes", "figures", "old", "revenue.xlsx", "README.md",
  ]);
});

test("flattenRows stops opening at a depth it can draw", () => {
  const deep = buildTree([file("a/b/c/d/e/f.txt")]);
  const rows = flattenRows({
    nodes: folderChildren(deep, "f1", ""),
    index: deep, folderId: "f1",
    expanded: new Set(["a", "a/b", "a/b/c", "a/b/c/d"]),
    sort: "name", direction: "asc",
    maxDepth: 2,
  });
  assert.deepEqual(rows.map((row) => row.node.name), ["a", "b", "c"]);
  assert.equal(rows[2]!.expandable, false, "the deepest row drawn cannot be opened further");
});
