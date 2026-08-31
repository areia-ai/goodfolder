/**
 * The one gate every write in the browser goes through.
 *
 * Saving a document, dropping a file onto a listing, renaming, removing, and
 * accepting someone's Change Proposal all end in the same place: bytes at a
 * path in someone's folder. Each of those paths used to check whatever it
 * happened to think of. That is how a folder ends up holding a pair of names
 * that differ only in case, or a `.env` a save would never have taken.
 *
 * So the checks live here, once, and every write asks. The rules themselves
 * are not here — case collisions, what a save leaves out, and where bytes
 * belong are all data in `@goodfolder/shared`, shared with the command line.
 * This decides nothing on its own; it asks in a fixed order and turns the
 * answer into something a person can read.
 */

import {
  ROUTING_CEILING_BYTES,
  SKIP_CATEGORY_LABEL,
  findCaseCollisions,
  routeFile,
  skipRuleFor,
  type StorageTarget,
} from "@goodfolder/shared";
import { safeDocumentPath } from "./collaboration.ts";

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
}

export interface PlannedWrite {
  path: string;
  sizeBytes: number;
  /** Where the bytes belong. Never shown to anyone. */
  target: StorageTarget;
}

export interface WritePlan {
  writes: PlannedWrite[];
  removes: string[];
}

export type RefusalCode =
  | "path"
  | "name-collision"
  | "left-out"
  | "too-large"
  | "not-found";

export interface Refusal {
  code: RefusalCode;
  /** Written for the person who tried, not for a log. */
  message: string;
  status: 400 | 404 | 409 | 413;
}

export type GateResult =
  | { ok: true; plan: WritePlan }
  | { ok: false; refusal: Refusal };

export interface WriteRequest {
  /** Everything the folder holds now. */
  tree: readonly TreeEntry[];
  writes?: ReadonlyArray<{ path: string; sizeBytes: number }>;
  /** Paths this change takes out. A rename is a write and a remove together. */
  removes?: readonly string[];
}

/**
 * Check a whole change at once, and either refuse it or say where each file
 * belongs. Everything is judged against the folder as it will stand *after*
 * the change, which is the only way a rename that alters nothing but a
 * capital letter can be told apart from a collision.
 */
export function checkWrite(request: WriteRequest): GateResult {
  const writes = request.writes ?? [];
  const removes = request.removes ?? [];

  for (const path of [...writes.map((w) => w.path), ...removes]) {
    if (safeDocumentPath(path) !== path || !usableName(path)) {
      return refuse("path", 400, `“${clip(path)}” isn’t a name a folder can hold. Choose a different one.`);
    }
  }

  const writtenPaths = writes.map((w) => w.path);
  if (new Set(writtenPaths).size !== writtenPaths.length) {
    return refuse("path", 400, "The same name arrived twice. Send each file once.");
  }

  const present = new Map(request.tree.map((entry) => [entry.path, entry.type]));
  for (const path of removes) {
    if (present.get(path) !== "blob") {
      return refuse("not-found", 404, `“${baseName(path)}” isn’t in this folder any more. Nothing was changed.`);
    }
  }

  const going = new Set(removes);
  const atTop = (candidate: string) => present.has(candidate) && !going.has(candidate);

  for (const write of writes) {
    // Only what is arriving. A file already in the folder got there some
    // other way — someone chose to protect it — and editing it is not the
    // moment to overrule that.
    if (present.get(write.path) === "blob") continue;
    const skipped = skipRuleFor(write.path, atTop);
    if (skipped) {
      return refuse(
        "left-out",
        400,
        `GoodFolder leaves out ${SKIP_CATEGORY_LABEL[skipped.category]}, and “${baseName(write.path)}” is one of them.`,
      );
    }
  }

  const plan: WritePlan = { writes: [], removes: [...removes] };
  for (const write of writes) {
    const decision = routeFile(write.path, write.sizeBytes);
    if (decision.reason === "over-ceiling") {
      return refuse(
        "too-large",
        413,
        `“${baseName(write.path)}” is ${megabytes(write.sizeBytes)}. The largest file the browser can add is ${megabytes(ROUTING_CEILING_BYTES)}.`,
      );
    }
    plan.writes.push({ path: write.path, sizeBytes: write.sizeBytes, target: decision.target });
  }

  // Something already here as a folder can't also become a file, and nothing
  // can go inside a file. Gitea would refuse both — it would just do it in a
  // language nobody outside this building reads.
  for (const write of writes) {
    if (present.get(write.path) === "tree") {
      return refuse("name-collision", 409, `“${baseName(write.path)}” is already a folder here. Choose a different name.`);
    }
    for (const ancestor of ancestorsOf(write.path)) {
      if (present.get(ancestor) === "blob" && !going.has(ancestor)) {
        return refuse("name-collision", 409, `“${baseName(ancestor)}” is a file, so nothing can go inside it.`);
      }
    }
  }

  // The whole folder, as it will stand. A pair of names differing only in
  // case is legal on some computers and quietly merges on others, so it can
  // never enter a folder's history — not by a save, not by an accepted
  // proposal, not by anything.
  const after = [
    ...request.tree
      .filter((entry) => entry.type === "blob" && !going.has(entry.path))
      .map((entry) => entry.path),
    ...writtenPaths,
  ];
  const collisions = findCaseCollisions(after);
  if (collisions.length > 0) {
    const { a, b } = collisions[0]!;
    const arriving = new Set(writtenPaths);
    const [named, other] = arriving.has(b) ? [b, a] : [a, b];
    return refuse("name-collision", 409, `“${named}” is too similar to “${other}”. Choose a different name.`);
  }

  return { ok: true, plan };
}

/**
 * The files a person has actually chosen. Clicking a folder means everything
 * inside it; the name alone is not enough, because `notes` and `notes-old`
 * share a beginning and only one of them was picked.
 */
export function filesUnder(
  tree: ReadonlyArray<{ path: string; type: "blob" | "tree"; size: number }>,
  chosen: readonly string[],
): Array<{ path: string; size: number }> {
  const picked = new Map<string, number>();
  for (const name of chosen) {
    for (const entry of tree) {
      if (entry.type !== "blob") continue;
      if (entry.path === name || entry.path.startsWith(`${name}/`)) picked.set(entry.path, entry.size);
    }
  }
  return [...picked]
    .map(([path, size]) => ({ path, size }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

function refuse(code: RefusalCode, status: Refusal["status"], message: string): GateResult {
  return { ok: false, refusal: { code, message, status } };
}

/**
 * `safeDocumentPath` already turns away the shapes that escape a folder.
 * These are the ones that survive it and still can't be a name: the engine's
 * own directory, characters no filesystem will keep, and names ending in a
 * space or a dot, which Windows silently trims into a different file.
 */
function usableName(path: string): boolean {
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return path
    .split("/")
    .every((segment) => segment.toLowerCase() !== ".git" && !/[ .]$/.test(segment));
}

function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

function baseName(path: string): string {
  return clip(path.split("/").pop() || path);
}

function clip(value: string): string {
  return value.length > 80 ? `${value.slice(0, 79)}…` : value;
}

function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}
