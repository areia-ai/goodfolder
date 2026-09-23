/**
 * Turn a quarantined receive-pack body into what the checks need: the ref
 * updates, the paths the push newly adds, the ignore list the new state
 * carries, and every object id involved. Nothing here trusts the sender —
 * the pack and the repository trees are the only witnesses.
 */

import { gunzipSync } from "node:zlib";
import { parseIgnoreFile, IGNORE_FILE } from "@goodfolder/shared";
import type { TreeEntry } from "../remote.ts";
import { readPktLine, PushGateError } from "./pktline.ts";
import { PackReader } from "./pack.ts";
import { ignorePatternsAt, type RemoteDeps } from "../remote.ts";

const ZERO = "0".repeat(40);

export interface RefUpdate {
  ref: string;
  oldId: string;
  newId: string;
}

export interface ReceivePackBody {
  commands: RefUpdate[];
  capabilities: string[];
  pushOptions: string[];
  /** Byte offset of the PACK signature, or -1 for a probe (flush only). */
  packOffset: number;
}

/**
 * Parse the pkt-line header of a receive-pack request body. A body that is
 * only a flush (the probe git sends ahead of large pushes) or carries no
 * commands answers `commands: []` and is forwarded unchecked.
 */
export function parseReceivePackBody(body: Buffer, gzip = false): ReceivePackBody {
  const buf = gzip ? gunzipSync(body) : body;
  const commands: RefUpdate[] = [];
  let capabilities: string[] = [];
  let off = 0;
  let first = true;
  for (;;) {
    const { payload, next } = readPktLine(buf, off);
    off = next;
    if (payload === null) break;
    let text = payload.toString("utf8");
    if (first) {
      first = false;
      const nul = text.indexOf("\0");
      if (nul >= 0) {
        capabilities = text.slice(nul + 1).split(" ").filter(Boolean);
        text = text.slice(0, nul);
      }
    }
    const m = /^([0-9a-f]{40}) ([0-9a-f]{40}) (\S+)$/.exec(text);
    if (!m) throw new PushGateError("unreadable", "malformed ref update line");
    commands.push({ oldId: m[1]!, newId: m[2]!, ref: m[3]! });
  }
  if (capabilities.includes("object-format=sha256")) {
    throw new PushGateError("unreadable", "sha256 object format is not supported");
  }
  const pushOptions: string[] = [];
  if (commands.length > 0 && capabilities.includes("push-options")) {
    // Option pkt-lines run until the next flush; the PACK follows.
    for (;;) {
      const { payload, next } = readPktLine(buf, off);
      off = next;
      if (payload === null) break;
      pushOptions.push(payload.toString("utf8"));
    }
  }
  const packOffset =
    commands.length === 0 || buf.subarray(off, off + 4).toString("ascii") !== "PACK" ? -1 : off;
  return { commands, capabilities, pushOptions, packOffset };
}

export interface PushInspection {
  refs: RefUpdate[];
  /** Paths the push adds relative to each ref's baseline, de-duplicated. */
  addedPaths: string[];
  /** Every path the new state holds that we can see (baseline ∪ in-pack). */
  presentPaths: ReadonlySet<string>;
  /** The new tip's ignore list (from the pack when it landed, else the old tip's). */
  ignorePatterns: string[];
  /** Every blob id an in-pack tree references, by full path. */
  blobIds: ReadonlyMap<string, string>;
  /** In-pack commit ids reachable from the new tips. */
  commitIds: string[];
  /** In-pack tree ids walked. */
  treeIds: string[];
  /** Honoured `goodfolder-include=` push options (device credentials only). */
  includedOnPurpose: string[];
  packBytes: number;
}

interface ParsedCommit {
  tree: string;
  parents: string[];
}

function parseCommit(content: Buffer): ParsedCommit {
  const head = content.subarray(0, content.indexOf("\n\n")).toString("utf8");
  let tree = "";
  const parents: string[] = [];
  for (const line of head.split("\n")) {
    if (line.startsWith("tree ")) tree = line.slice(5, 45);
    else if (line.startsWith("parent ")) parents.push(line.slice(7, 47));
  }
  return { tree, parents };
}

interface TreeItem {
  mode: string;
  name: string;
  id: string;
}

function parseTree(content: Buffer): TreeItem[] {
  const items: TreeItem[] = [];
  let p = 0;
  while (p < content.length) {
    const sp = content.indexOf(0x20, p);
    const mode = content.subarray(p, sp).toString("ascii");
    const nul = content.indexOf(0, sp);
    const name = content.subarray(sp + 1, nul).toString("utf8");
    const id = content.subarray(nul + 1, nul + 21).toString("hex");
    items.push({ mode, name, id });
    p = nul + 21;
  }
  return items;
}

/**
 * Walk what the push lands: every commit in the pack reachable from the new
 * tips, every in-pack tree beneath them, and the paths they add over each
 * ref's baseline (the old tip's tree, or main's for a new ref).
 */
export async function inspectPush(
  deps: RemoteDeps,
  projectId: string,
  pack: PackReader,
  parsed: ReceivePackBody,
  opts: { isDevice: boolean },
): Promise<PushInspection> {
  const blobIds = new Map<string, string>();
  const commitIds: string[] = [];
  const treeIds: string[] = [];
  const added = new Set<string>();
  const present = new Set<string>();
  let ignorePatterns: string[] = [];
  const ignoreBlobId = { id: null as string | null };
  let baselineForIgnore: { tree: TreeEntry[]; ref: string } | null = null;

  for (const cmd of parsed.commands) {
    if (cmd.newId === ZERO) continue; // deletion — nothing lands

    // Baseline: the ref's old tip, or main's head for a brand-new ref.
    const baselineRef = cmd.oldId !== ZERO ? cmd.oldId : await deps.repos.head(projectId);
    const baselineTree: TreeEntry[] = baselineRef
      ? await deps.repos.tree(projectId, baselineRef).catch(() => [] as TreeEntry[])
      : [];
    const baseline = new Set(baselineTree.filter((e) => e.type === "blob").map((e) => e.path));
    for (const p of baseline) present.add(p);
    if (!baselineForIgnore && baselineTree.length && baselineRef) {
      baselineForIgnore = { tree: baselineTree, ref: baselineRef };
    }

    // New commits in the pack reachable from this tip; their in-pack trees.
    const tipIndex = await pack.indexOfId(cmd.newId);
    const perRef = new Set<string>();
    if (tipIndex >= 0) {
      const seen = new Set<number>();
      const queue = [tipIndex];
      while (queue.length) {
        const i = queue.shift()!;
        if (seen.has(i)) continue;
        seen.add(i);
        const resolved = await pack.resolve(i);
        if (resolved.type !== "commit") continue;
        commitIds.push(await pack.idOf(i));
        const commit = parseCommit(resolved.content);
        if (commit.tree) {
          await walkTree(pack, commit.tree, "", perRef, blobIds, treeIds, ignoreBlobId);
        }
        for (const parent of commit.parents) {
          const pi = await pack.indexOfId(parent);
          if (pi >= 0 && !seen.has(pi)) queue.push(pi);
        }
      }
    }
    for (const p of perRef) {
      present.add(p);
      if (!baseline.has(p)) added.add(p);
    }
  }

  // The ignore list the NEW state carries: from the pack when the push
  // rewrote it and that blob actually landed, else whatever the baseline
  // already held.
  let ignoreFromPack: string[] | null = null;
  if (ignoreBlobId.id) {
    const bi = await pack.indexOfId(ignoreBlobId.id);
    if (bi >= 0) {
      try {
        ignoreFromPack = parseIgnoreFile((await pack.readBlob(bi)).toString("utf8")).patterns;
      } catch {
        ignoreFromPack = null;
      }
    }
  }
  if (ignoreFromPack !== null) {
    ignorePatterns = ignoreFromPack;
  } else if (baselineForIgnore && baselineForIgnore.tree.some((e) => e.type === "blob" && e.path === IGNORE_FILE)) {
    ignorePatterns = await ignorePatternsAt(deps, projectId, baselineForIgnore.tree, baselineForIgnore.ref);
  }

  const includedOnPurpose = opts.isDevice
    ? parsed.pushOptions
        .filter((o) => o.startsWith("goodfolder-include=") && !o.includes("\n"))
        .map((o) => o.slice("goodfolder-include=".length))
        .slice(0, 100)
    : [];

  return {
    refs: parsed.commands,
    addedPaths: [...added].sort(),
    presentPaths: present,
    ignorePatterns,
    blobIds,
    commitIds,
    treeIds,
    includedOnPurpose,
    packBytes: 0,
  };
}

async function walkTree(
  pack: PackReader,
  treeId: string,
  prefix: string,
  paths: Set<string>,
  blobIds: Map<string, string>,
  treeIds: string[],
  ignoreBlobId: { id: string | null },
): Promise<void> {
  const ti = await pack.indexOfId(treeId);
  if (ti < 0) return; // the tree stayed remote — only in-pack trees add paths
  const resolved = await pack.resolve(ti);
  if (resolved.type !== "tree") return;
  treeIds.push(treeId);
  for (const item of parseTree(resolved.content)) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.mode === "40000") {
      await walkTree(pack, item.id, path, paths, blobIds, treeIds, ignoreBlobId);
    } else if (item.mode === "160000") {
      continue; // a linked outside history — never content we gate on
    } else {
      paths.add(path);
      blobIds.set(path, item.id);
      if (path === IGNORE_FILE) ignoreBlobId.id = item.id;
    }
  }
}
