// The file system behind the GoodFolder window.
//
// GoodFolder's server answers with a flat list of files, each carrying its
// whole path. Every hierarchy a person sees in the dashboard is rebuilt here,
// in the browser, from those paths. That is deliberate: the shape of a folder
// is already in the data, and asking the server to describe it a second way
// would give us two answers that could disagree.
//
// Everything in this file is pure. No React, no fetch, no window — so the
// tree, the sort order, and the address round-trip can all be tested directly.

import { extensionOfPath, previewKindLabel } from "./preview.ts";
import type { ChangeProposal, Folder, FolderFile, SaveRow } from "./gf-api.ts";

/* ------------------------------------------------------------------ Paths */

/** `"./a//b/"` → `"a/b"`. Empty for anything that isn't a usable path. */
export function normalizePath(path: string): string {
  const parts = String(path ?? "")
    .split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..");
  return parts.join("/");
}

/** The last segment: `"a/b/c.txt"` → `"c.txt"`. */
export function baseName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

/** The containing directory: `"a/b/c.txt"` → `"a/b"`, `"c.txt"` → `""`. */
export function directoryName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** `join("a", "b")` → `"a/b"`; an empty parent yields the child alone. */
export function joinPath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

/** Every directory above a path, outermost first, excluding the path itself. */
export function ancestorsOf(path: string): string[] {
  const segments = normalizePath(path).split("/").filter(Boolean);
  const out: string[] = [];
  let at = "";
  for (let i = 0; i < segments.length - 1; i += 1) {
    at = joinPath(at, segments[i]!);
    out.push(at);
  }
  return out;
}

/* ------------------------------------------------------------------- Tree */

interface Bucket {
  directories: Set<string>;
  files: FolderFile[];
}

export interface TreeIndex {
  /** Directory path (`""` is the top of the folder) → its immediate children. */
  entries: Map<string, { directories: string[]; files: FolderFile[] }>;
  /** Directory path → total bytes of every file anywhere beneath it. */
  sizes: Map<string, number>;
  /** Directory path → how many files sit anywhere beneath it. */
  counts: Map<string, number>;
  /** Every file by its normalized path. */
  byPath: Map<string, FolderFile>;
}

/**
 * Rebuild the directory hierarchy from a flat list of files.
 *
 * A directory exists here because a file inside it exists. That is not a
 * shortcut — the engine underneath does not record a directory with nothing
 * in it, so an empty folder genuinely is not part of what a Save protects.
 * The window says so plainly rather than drawing a folder that isn't there.
 */
export function buildTree(files: FolderFile[]): TreeIndex {
  const buckets = new Map<string, Bucket>();
  const byPath = new Map<string, FolderFile>();

  const bucket = (dir: string): Bucket => {
    let found = buckets.get(dir);
    if (!found) {
      found = { directories: new Set(), files: [] };
      buckets.set(dir, found);
    }
    return found;
  };
  bucket("");

  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path) continue;
    const entry = path === file.path ? file : { ...file, path };
    byPath.set(path, entry);

    const segments = path.split("/");
    let parent = "";
    for (let i = 0; i < segments.length - 1; i += 1) {
      const dir = joinPath(parent, segments[i]!);
      bucket(parent).directories.add(dir);
      bucket(dir);
      parent = dir;
    }
    bucket(parent).files.push(entry);
  }

  const sizes = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const [path, file] of byPath) {
    const size = Number(file.size ?? 0);
    for (const dir of [...ancestorsOf(path), ""]) {
      sizes.set(dir, (sizes.get(dir) ?? 0) + size);
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }

  const entries = new Map<string, { directories: string[]; files: FolderFile[] }>();
  for (const [dir, value] of buckets) {
    entries.set(dir, { directories: [...value.directories], files: value.files });
  }
  return { entries, sizes, counts, byPath };
}

/** Total bytes beneath a directory, `0` for one that holds nothing. */
export function directorySize(index: TreeIndex, dir: string): number {
  return index.sizes.get(normalizePath(dir)) ?? 0;
}

/** How many files sit anywhere beneath a directory. */
export function directoryCount(index: TreeIndex, dir: string): number {
  return index.counts.get(normalizePath(dir)) ?? 0;
}

/** True when the path names a directory the tree knows about. */
export function hasDirectory(index: TreeIndex, dir: string): boolean {
  return index.entries.has(normalizePath(dir));
}

/* --------------------------------------------------------- When it changed */

export interface ChangeStamp {
  /** ISO timestamp of the Save that last touched this path. */
  at: string;
  /** The Save's number, so "changed in Save #24" can be said out loud. */
  seq: number;
}

export interface ChangeIndex {
  files: Map<string, ChangeStamp>;
  directories: Map<string, ChangeStamp>;
  /**
   * True when the timeline we read from was capped, so a file with no stamp
   * may well have changed — we just cannot see that far back. The window says
   * "—" rather than inventing a date.
   */
  partial: boolean;
}

export const EMPTY_CHANGE_INDEX: ChangeIndex = {
  files: new Map(),
  directories: new Map(),
  partial: false,
};

/**
 * Fold a timeline into "when did each file last change".
 *
 * Saves arrive newest first, so the first stamp a path gets is the right one.
 * The server caps both the number of Saves and the paths inside each, and
 * `partial` carries that fact forward instead of hiding it.
 */
export function buildChangeIndex(saves: SaveRow[], timelineLimit = 100): ChangeIndex {
  const files = new Map<string, ChangeStamp>();
  const directories = new Map<string, ChangeStamp>();
  let partial = saves.length >= timelineLimit;

  const ordered = [...saves].sort((a, b) => Number(b.seq ?? 0) - Number(a.seq ?? 0));
  for (const save of ordered) {
    if (save.changedPathsTruncated) partial = true;
    const paths = Array.isArray(save.changedPaths) ? save.changedPaths : [];
    if (paths.length === 0 && Array.isArray(save.topPaths)) {
      // A compact timeline carries only the headline paths. Better than
      // nothing, and the `partial` flag already says the picture is not whole.
      partial = true;
    }
    const stamp: ChangeStamp = { at: save.createdAt, seq: Number(save.seq ?? 0) };
    const known = paths.length > 0 ? paths : (save.topPaths ?? []);
    for (const raw of known) {
      const path = normalizePath(raw);
      if (!path || files.has(path)) continue;
      files.set(path, stamp);
      for (const dir of [...ancestorsOf(path), ""]) {
        if (!directories.has(dir)) directories.set(dir, stamp);
      }
    }
  }
  return { files, directories, partial };
}

/* ------------------------------------------------------ Waiting for review */

/** Path → how many proposals are still waiting on a decision for it. */
export type ReviewIndex = Map<string, number>;

export function buildReviewIndex(proposals: ChangeProposal[]): ReviewIndex {
  const counts: ReviewIndex = new Map();
  for (const proposal of proposals) {
    if (proposal.status !== "open" && proposal.status !== "needs-review") continue;
    const seen = new Set<string>();
    for (const suggestion of proposal.suggestions ?? []) {
      const path = normalizePath(suggestion.path);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      counts.set(path, (counts.get(path) ?? 0) + 1);
      for (const dir of [...ancestorsOf(path), ""]) {
        counts.set(dir, (counts.get(dir) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/* ------------------------------------------------------------------ Nodes */

export interface NodeBase {
  /** Stable across renders, unique inside one listing. */
  id: string;
  name: string;
  /** Bytes. `null` where we honestly do not know — a GoodFolder at the root. */
  size: number | null;
  changed: ChangeStamp | null;
  reviewCount: number;
}

export interface GoodFolderNode extends NodeBase {
  kind: "folder";
  folderId: string;
  folder: Folder;
}

export interface DirectoryNode extends NodeBase {
  kind: "directory";
  folderId: string;
  path: string;
  /** Files anywhere beneath, not just immediate children. */
  fileCount: number;
}

export interface FileNode extends NodeBase {
  kind: "file";
  folderId: string;
  path: string;
  file: FolderFile;
}

export type VfsNode = GoodFolderNode | DirectoryNode | FileNode;

export interface Decoration {
  changed?: ChangeIndex | null;
  review?: ReviewIndex | null;
}

/** The root listing: every GoodFolder on the account, as folders. */
export function rootChildren(folders: Folder[]): GoodFolderNode[] {
  return folders.map((folder) => ({
    kind: "folder",
    id: `folder:${folder.id}`,
    folderId: folder.id,
    folder,
    name: folder.name,
    // A GoodFolder's byte size is not in the folder list, and guessing it from
    // one open folder would be worse than an honest blank.
    size: null,
    changed: folder.lastSaveAt
      ? { at: folder.lastSaveAt, seq: Number(folder.lastSeq ?? 0) }
      : null,
    reviewCount: Number(folder.openProposalCount ?? 0),
  }));
}

/** The slice of the root a sidebar place shows. */
export function filterRoot(nodes: GoodFolderNode[], scope: RootScope): GoodFolderNode[] {
  if (scope === "shared") return nodes.filter((node) => node.folder.role === "contributor");
  if (scope === "review") return nodes.filter((node) => node.reviewCount > 0);
  if (scope === "recent") return nodes.filter((node) => node.changed !== null);
  return nodes;
}

/** One directory's immediate children, unsorted. */
export function folderChildren(
  index: TreeIndex,
  folderId: string,
  dir: string,
  decoration: Decoration = {},
): VfsNode[] {
  const at = normalizePath(dir);
  const entry = index.entries.get(at);
  if (!entry) return [];
  const directories = entry.directories.map<DirectoryNode>((path) => ({
    kind: "directory",
    id: `dir:${folderId}:${path}`,
    folderId,
    path,
    name: baseName(path),
    size: directorySize(index, path),
    fileCount: directoryCount(index, path),
    changed: decoration.changed?.directories.get(path) ?? null,
    reviewCount: decoration.review?.get(path) ?? 0,
  }));
  const files = entry.files.map<FileNode>((file) => fileNode(folderId, file, decoration));
  return [...directories, ...files];
}

export function fileNode(folderId: string, file: FolderFile, decoration: Decoration = {}): FileNode {
  const path = normalizePath(file.path);
  return {
    kind: "file",
    id: `file:${folderId}:${path}`,
    folderId,
    path,
    file,
    name: baseName(path),
    size: Number(file.size ?? 0),
    changed: decoration.changed?.files.get(path) ?? null,
    reviewCount: decoration.review?.get(path) ?? 0,
  };
}

/** Every file beneath a directory, for a recursive search. */
export function descendantFiles(
  index: TreeIndex,
  folderId: string,
  dir: string,
  decoration: Decoration = {},
): FileNode[] {
  const at = normalizePath(dir);
  const prefix = at ? `${at}/` : "";
  const out: FileNode[] = [];
  for (const [path, file] of index.byPath) {
    if (at && !path.startsWith(prefix)) continue;
    out.push(fileNode(folderId, file, decoration));
  }
  return out;
}

/* ------------------------------------------------------- Kind, sort, group */

/** The written type of a node: "Folder", "Image", "Word document", … */
export function kindLabel(node: VfsNode): string {
  if (node.kind === "folder") return "GoodFolder";
  if (node.kind === "directory") return "Folder";
  return previewKindLabel(node.path);
}

/** Lower-case extension, used to pick a glyph. Empty for anything else. */
export function extensionOf(node: VfsNode): string {
  return node.kind === "file" ? extensionOfPath(node.path) : "";
}

export type SortKey = "name" | "kind" | "size" | "changed" | "review";
export type SortDirection = "asc" | "desc";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** `"file2"` before `"file10"`, the way every file manager orders names. */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}

function rank(node: VfsNode): number {
  // Folders above files, in every sort and both directions. Finder offers this
  // as a preference; Drive, Dropbox and SharePoint simply always do it, and
  // that is the expectation someone arrives with.
  return node.kind === "file" ? 1 : 0;
}

/**
 * One comparator for every column.
 *
 * Two rules hold whatever the column: folders stay above files, and a node
 * whose value is unknown sinks to the bottom in both directions. A file with
 * no known change date is not "the oldest" — we just cannot see it, and
 * flipping the sort should not float it to the top as though we could.
 */
export function sortNodes(nodes: VfsNode[], key: SortKey, direction: SortDirection = "asc"): VfsNode[] {
  const flip = direction === "desc" ? -1 : 1;
  return [...nodes].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;

    let result = 0;
    let aKnown = true;
    let bKnown = true;

    if (key === "name") {
      result = compareNames(a.name, b.name);
    } else if (key === "kind") {
      result = compareNames(kindLabel(a), kindLabel(b));
    } else if (key === "size") {
      aKnown = a.size !== null;
      bKnown = b.size !== null;
      if (aKnown && bKnown) result = (a.size ?? 0) - (b.size ?? 0);
    } else if (key === "changed") {
      aKnown = a.changed !== null;
      bKnown = b.changed !== null;
      if (aKnown && bKnown) {
        result = Date.parse(a.changed!.at) - Date.parse(b.changed!.at);
        if (!Number.isFinite(result) || result === 0) result = a.changed!.seq - b.changed!.seq;
      }
    } else {
      result = a.reviewCount - b.reviewCount;
    }

    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (result !== 0) return result * flip;
    return compareNames(a.name, b.name);
  });
}

export type GroupKey = "none" | "kind" | "changed";

export interface NodeGroup {
  /** Stable id for React and for remembering which groups are collapsed. */
  id: string;
  label: string;
  nodes: VfsNode[];
}

const DAY = 86_400_000;

/** "Today", "Previous 7 days", "Earlier", "Not known" — Finder's date buckets. */
export function changedBucket(stamp: ChangeStamp | null, now = Date.now()): string {
  if (!stamp) return "Not known";
  const age = now - Date.parse(stamp.at);
  if (!Number.isFinite(age)) return "Not known";
  if (age < DAY) return "Today";
  if (age < 2 * DAY) return "Yesterday";
  if (age < 7 * DAY) return "Previous 7 days";
  if (age < 30 * DAY) return "Previous 30 days";
  return "Earlier";
}

const CHANGED_ORDER = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Earlier", "Not known"];

/** Split an already-sorted listing into groups, keeping the order within each. */
export function groupNodes(nodes: VfsNode[], key: GroupKey, now = Date.now()): NodeGroup[] {
  if (key === "none") return [{ id: "all", label: "", nodes }];
  const buckets = new Map<string, VfsNode[]>();
  for (const node of nodes) {
    const label = key === "kind" ? kindLabel(node) : changedBucket(node.changed, now);
    const bucket = buckets.get(label);
    if (bucket) bucket.push(node);
    else buckets.set(label, [node]);
  }
  const labels = [...buckets.keys()].sort((a, b) => {
    if (key === "changed") return CHANGED_ORDER.indexOf(a) - CHANGED_ORDER.indexOf(b);
    return compareNames(a, b);
  });
  return labels.map((label) => ({ id: `group:${label}`, label, nodes: buckets.get(label)! }));
}

/* ------------------------------------------------------------------ Rows */

export interface ListRow {
  node: VfsNode;
  /** How deep the disclosure triangles have taken you. Top level is 0. */
  level: number;
  expandable: boolean;
  expanded: boolean;
}

/**
 * The list view's rows, with any opened directory's children folded in
 * underneath it.
 *
 * Opening a directory in place, rather than only by going into it, is the
 * thing a list view is for — it is how you compare two folders' worth of
 * files without losing your place.
 */
export function flattenRows(input: {
  nodes: VfsNode[];
  index: TreeIndex;
  folderId: string;
  expanded: ReadonlySet<string>;
  sort: SortKey;
  direction: SortDirection;
  decoration?: Decoration;
  /** A guard against a hierarchy deep enough to run out of stack. */
  maxDepth?: number;
}): ListRow[] {
  const maxDepth = input.maxDepth ?? 24;
  const out: ListRow[] = [];

  const walk = (nodes: VfsNode[], level: number) => {
    for (const node of sortNodes(nodes, input.sort, input.direction)) {
      const expandable = node.kind === "directory" && level < maxDepth;
      const expanded = expandable && input.expanded.has((node as DirectoryNode).path);
      out.push({ node, level, expandable, expanded });
      if (expanded) {
        walk(
          folderChildren(input.index, input.folderId, (node as DirectoryNode).path, input.decoration),
          level + 1,
        );
      }
    }
  };
  walk(input.nodes, 0);
  return out;
}

/* ----------------------------------------------------------------- Search */

/** Case-insensitive substring match on the name, then on the whole path. */
export function matchesQuery(node: VfsNode, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (node.name.toLowerCase().includes(needle)) return true;
  return node.kind !== "folder" && node.path.toLowerCase().includes(needle);
}

export function filterNodes(nodes: VfsNode[], query: string): VfsNode[] {
  if (!query.trim()) return nodes;
  return nodes.filter((node) => matchesQuery(node, query));
}

/* ---------------------------------------------------------------- Address */

/**
 * Where the window is pointing.
 *
 * This is written into the browser address, and the address is read by the
 * Site tools an assistant uses (`lib/webmcp.ts` reads `folder` and `file`).
 * `folder` and `file` therefore keep their exact existing meaning forever;
 * `path` is the one addition. How things are *displayed* — the view, the sort —
 * deliberately stays out, because it is a preference, not a place.
 */
export interface Location {
  /** `null` at the root, where the GoodFolders themselves are listed. */
  folderId: string | null;
  /** Directory inside the folder. `""` is the folder's own top level. */
  dir: string;
  /** The file being read, if one is open. */
  file: string | null;
  /**
   * Which slice of the root is being shown. Only meaningful at the root, and
   * carried in the address because the sidebar's places are places: clicking
   * one and pressing Back should come back here.
   */
  scope: RootScope;
}

/** The root, and the three narrower ways of looking at it. */
export type RootScope = "all" | "shared" | "review" | "recent";

export const ROOT_SCOPES: readonly RootScope[] = ["all", "shared", "review", "recent"];

export const ROOT_SCOPE_LABEL: Record<RootScope, string> = {
  all: "All folders",
  shared: "Shared with you",
  review: "Waiting for review",
  recent: "Recently changed",
};

export const ROOT_LOCATION: Location = { folderId: null, dir: "", file: null, scope: "all" };

export function parseLocation(search: string | URLSearchParams): Location {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const folderId = params.get("folder");
  if (!folderId) {
    const asked = params.get("in");
    const scope = ROOT_SCOPES.find((value) => value === asked) ?? "all";
    return { ...ROOT_LOCATION, scope };
  }
  const file = params.get("file");
  const cleanFile = file ? normalizePath(file) : "";
  // An open file always implies the directory it lives in, whether or not the
  // address said so. One less way for the two to disagree.
  const dir = cleanFile ? directoryName(cleanFile) : normalizePath(params.get("path") ?? "");
  return { folderId, dir, file: cleanFile || null, scope: "all" };
}

export function locationQuery(location: Location): string {
  const params = new URLSearchParams();
  if (location.folderId) {
    params.set("folder", location.folderId);
    if (location.dir) params.set("path", location.dir);
    if (location.file) params.set("file", location.file);
  } else if (location.scope !== "all") {
    params.set("in", location.scope);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The address to navigate to, ready for `history.pushState`. */
export function locationHref(location: Location, pathname = "/dashboard"): string {
  return `${pathname}${locationQuery(location)}`;
}

export function sameLocation(a: Location, b: Location): boolean {
  return a.folderId === b.folderId && a.dir === b.dir && a.file === b.file && a.scope === b.scope;
}

/** A stable key for remembering how one place was last displayed. */
export function locationKey(location: Location): string {
  if (!location.folderId) return location.scope === "all" ? "root" : `root:${location.scope}`;
  return location.dir ? `${location.folderId}:${location.dir}` : location.folderId;
}

/** One step up: a file → its directory, a directory → its parent, a folder → root. */
export function parentLocation(location: Location): Location | null {
  if (!location.folderId) return null;
  if (location.file) return { ...location, file: null };
  if (location.dir) return { ...location, dir: directoryName(location.dir), file: null };
  return ROOT_LOCATION;
}

/** Where opening a node takes you. A file stays in its directory and opens. */
export function locationOf(node: VfsNode): Location {
  const base = { scope: "all" as const };
  if (node.kind === "folder") return { ...base, folderId: node.folderId, dir: "", file: null };
  if (node.kind === "directory") return { ...base, folderId: node.folderId, dir: node.path, file: null };
  return { ...base, folderId: node.folderId, dir: directoryName(node.path), file: node.path };
}

export interface Crumb {
  label: string;
  location: Location;
}

/** `GoodFolder ▸ Q3 Report ▸ figures ▸ revenue.xlsx`, each part navigable. */
export function breadcrumb(location: Location, folderName: string | null, rootLabel = "GoodFolder"): Crumb[] {
  const crumbs: Crumb[] = [{ label: rootLabel, location: ROOT_LOCATION }];
  if (!location.folderId) {
    if (location.scope !== "all") crumbs.push({ label: ROOT_SCOPE_LABEL[location.scope], location });
    return crumbs;
  }
  crumbs.push({
    label: folderName ?? "Folder",
    location: { folderId: location.folderId, dir: "", file: null, scope: "all" },
  });
  let at = "";
  for (const segment of location.dir.split("/").filter(Boolean)) {
    at = joinPath(at, segment);
    crumbs.push({ label: segment, location: { folderId: location.folderId, dir: at, file: null, scope: "all" } });
  }
  if (location.file) {
    crumbs.push({ label: baseName(location.file), location });
  }
  return crumbs;
}
