/**
 * A bounded-memory PACK v2/v3 reader, for quarantined push bodies.
 *
 * Memory contract: commits, trees and tags are fully inflated (they are
 * small by nature); delta instruction streams likewise. Blob bytes are
 * inflated only to find their end and then discarded — blobs fetched on
 * demand by offset (the ignore-file lookup) are bounded by the caller.
 *
 * I/O contract: the object pass reads the pack once, front to back,
 * through one reusable sliding window. Objects whose compressed stream
 * fits in the window inflate with a single inflateSync; anything larger
 * falls back to a streaming inflate fed from the same window.
 */

import { createHash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import { createInflate, inflateSync } from "node:zlib";
import { once } from "node:events";
import { PushGateError } from "./pktline.ts";

/** The most a single on-demand blob read will retain. */
export const MAX_ONDEMAND_BLOB = 64 * 1024;
/** Sliding window over the pack file; the whole pass reads through it. */
const WINDOW_BYTES = 4 << 20;
/** Objects up to this inflated size decode in one synchronous call. */
const SYNC_INFLATE_MAX = 1 << 20;

const TYPE_NAMES: Record<number, "commit" | "tree" | "blob" | "tag" | "ofs-delta" | "ref-delta"> = {
  1: "commit",
  2: "tree",
  3: "blob",
  4: "tag",
  6: "ofs-delta",
  7: "ref-delta",
};

export interface PackEntry {
  index: number;
  offset: number;
  /** The stored type — deltas resolve to their base's type on read. */
  type: "commit" | "tree" | "blob" | "tag" | "ofs-delta" | "ref-delta";
  /** Inflated size in bytes (delta objects: the delta stream's size). */
  size: number;
  dataOffset: number;
  baseOffset?: number | undefined;
  baseId?: string | undefined;
}

type RootType = "commit" | "tree" | "blob" | "tag" | "unknown";

export class PackReader {
  private readonly resolving = new Set<number>();
  /** Entry index by pack offset, for offset-delta bases. */
  private readonly byOffset = new Map<number, number>();
  /** What each entry rebuilds, per the pass; see `open`. */
  private readonly rootTypes: RootType[] = [];
  /** Resolved content of commit/tree/tag deltas, so chains resolve once. */
  private readonly resolvedCache = new Map<number, { type: "commit" | "tree" | "tag"; content: Buffer }>();
  /** End of pack content (exclusive of the trailing checksum). */
  private fileEnd = 0;
  private readonly win = Buffer.allocUnsafe(WINDOW_BYTES);
  private winStart = 0;
  private winLen = 0;

  private constructor(
    private fh: FileHandle,
    public readonly entries: PackEntry[],
    private readonly contents: Map<number, Buffer>,
    private readonly ids: Map<number, string>,
    private readonly byId: Map<string, number>,
  ) {}

  /**
   * Verify the checksum and read the object table. Blob contents are not
   * retained; commits, trees, tags and delta streams are.
   */
  static async open(path: string, packStart = 0): Promise<PackReader> {
    const fh = await open(path, "r");
    try {
      const stat = await fh.stat();
      const end = stat.size - 20;
      if (end - packStart < 12) throw new PushGateError("unreadable", "pack too short");

      // Trailing SHA-1 over everything before it.
      const hash = createHash("sha1");
      {
        const buf = Buffer.allocUnsafe(1 << 20);
        let pos = packStart;
        while (pos < end) {
          const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, end - pos), pos);
          if (bytesRead === 0) throw new PushGateError("unreadable", "pack truncated");
          hash.update(buf.subarray(0, bytesRead));
          pos += bytesRead;
        }
      }
      const want = Buffer.alloc(20);
      await fh.read(want, 0, 20, end);
      if (!hash.digest().equals(want)) throw new PushGateError("unreadable", "bad pack checksum");

      const head = Buffer.alloc(12);
      await fh.read(head, 0, 12, packStart);
      if (head.subarray(0, 4).toString("ascii") !== "PACK") throw new PushGateError("unreadable", "no PACK signature");
      const version = head.readUInt32BE(4);
      if (version !== 2 && version !== 3) throw new PushGateError("unreadable", `pack version ${version}`);
      const count = head.readUInt32BE(8);
      if (count > 20_000_000) throw new PushGateError("unreadable", "implausible object count");

      const reader = new PackReader(fh, [], new Map(), new Map(), new Map());
      reader.fileEnd = end;
      let pos = packStart + 12;
      for (let i = 0; i < count; i++) {
        const { type, size, dataOffset, baseOffset, baseId } = await reader.readObjectHeader(pos);
        // What a delta ultimately rebuilds: known at once for an offset
        // delta (its base came earlier), and for a ref delta whose base is
        // already hashed; otherwise "unknown" until the pass ends.
        let root: RootType;
        if (type === "ofs-delta") {
          const bi = reader.byOffset.get(baseOffset!);
          root = bi === undefined ? "unknown" : reader.rootTypes[bi]!;
        } else if (type === "ref-delta") {
          const bi = reader.byId.get(baseId!);
          root = bi === undefined ? "unknown" : reader.rootTypes[bi]!;
        } else {
          root = type;
        }
        // Blob contents — and deltas that rebuild blobs — are never kept.
        // An unknown-root delta is kept only while small, so memory stays
        // bounded whichever way it resolves.
        const isDelta = type === "ofs-delta" || type === "ref-delta";
        const keep = isDelta
          ? root === "commit" || root === "tree" || root === "tag" || (root === "unknown" && size <= MAX_ONDEMAND_BLOB)
          : type !== "blob";
        // Non-delta objects get their id hashed on the way through, kept
        // or not — a delta base or a tree entry can point at any of them.
        const wantHash = type === "commit" || type === "tree" || type === "blob" || type === "tag";
        const { data, used, hash: objectHash } = await reader.inflateAt(dataOffset, keep, wantHash ? `${type} ${size}\0` : null, size);
        if (data !== null && data.length !== size) {
          throw new PushGateError("unreadable", "inflated size mismatch");
        }
        reader.entries.push({ index: i, offset: pos, type, size, dataOffset, baseOffset, baseId });
        reader.byOffset.set(pos, i);
        reader.rootTypes.push(root);
        if (data !== null) reader.contents.set(i, data);
        if (wantHash && objectHash) {
          reader.ids.set(i, objectHash);
          reader.byId.set(objectHash, i);
        }
        pos = dataOffset + used;
      }
      await reader.resolveStructure();
      return reader;
    } catch (error) {
      await fh.close().catch(() => {});
      throw error;
    }
  }

  /**
   * Bytes at `offset`, up to `need`, from the sliding window. Sequential
   * callers slide it forward; the rare backward read (a delta base behind
   * the cursor) resets it. Never returns past the pack's content end.
   */
  private async view(offset: number, need: number, min = need): Promise<Buffer> {
    const end = Math.min(offset + need, this.fileEnd);
    if (offset >= end) return Buffer.alloc(0);
    // Only slide when fewer than `min` bytes are already in view — asking
    // for "as much as you have" must not copy the window on every object.
    const minEnd = Math.min(offset + min, this.fileEnd);
    if (offset < this.winStart || minEnd > this.winStart + this.winLen) {
      const wEnd = this.winStart + this.winLen;
      if (offset >= this.winStart && offset < wEnd) {
        // Slide: keep the overlap, read forward into the freed space.
        const kept = wEnd - offset;
        this.win.copyWithin(0, offset - this.winStart, wEnd - this.winStart);
        this.winStart = offset;
        this.winLen = kept;
      } else {
        this.winStart = offset;
        this.winLen = 0;
      }
      while (this.winLen < this.win.length && this.winStart + this.winLen < end) {
        const { bytesRead } = await this.fh.read(
          this.win, this.winLen, this.win.length - this.winLen, this.winStart + this.winLen,
        );
        if (bytesRead === 0) break;
        this.winLen += bytesRead;
      }
    }
    const avail = Math.min(this.winLen - (offset - this.winStart), end - offset);
    if (avail <= 0) return Buffer.alloc(0);
    return this.win.subarray(offset - this.winStart, offset - this.winStart + avail);
  }

  private async byteAt(pos: number): Promise<number> {
    const b = await this.view(pos, 1);
    if (b.length === 0) throw new PushGateError("unreadable", "short read");
    return b[0]!;
  }

  private async readObjectHeader(
    pos: number,
  ): Promise<{ type: PackEntry["type"]; size: number; dataOffset: number; baseOffset?: number | undefined; baseId?: string | undefined }> {
    let p = pos;
    let byte = await this.byteAt(p++);
    const typeNum = (byte >> 4) & 7;
    const type = TYPE_NAMES[typeNum];
    if (!type) throw new PushGateError("unreadable", `unknown object type ${typeNum}`);
    let size = byte & 0x0f;
    let shift = 4;
    while (byte & 0x80) {
      byte = await this.byteAt(p++);
      size += (byte & 0x7f) << shift;
      shift += 7;
      if (shift > 63) throw new PushGateError("unreadable", "size varint overflow");
    }
    let baseOffset: number | undefined;
    let baseId: string | undefined;
    if (type === "ofs-delta") {
      byte = await this.byteAt(p++);
      let ofs = byte & 0x7f;
      while (byte & 0x80) {
        byte = await this.byteAt(p++);
        ofs = ((ofs + 1) << 7) | (byte & 0x7f);
      }
      baseOffset = pos - ofs;
      if (baseOffset < 0) throw new PushGateError("unreadable", "ofs-delta before pack start");
    } else if (type === "ref-delta") {
      const id = await this.view(p, 20);
      if (id.length < 20) throw new PushGateError("unreadable", "short read");
      baseId = id.toString("hex");
      p += 20;
    }
    return { type, size, dataOffset: p, baseOffset, baseId };
  }

  /**
   * Inflate the zlib stream starting at `start`. `keep` decides whether the
   * inflated bytes are retained; `used` reports compressed bytes consumed so
   * the caller can find the next object. Kept objects try inflateSync on the
   * window first; anything else streams through it without retention.
   */
  private async inflateAt(
    start: number,
    keep: boolean,
    hashHeader: string | null,
    size = Number.POSITIVE_INFINITY,
  ): Promise<{ data: Buffer | null; used: number; hash: string | null }> {
    // Small objects — kept or not — inflate in one call from the window; the
    // output is bounded by SYNC_INFLATE_MAX and dropped at once when not
    // kept. Only large blobs take the streaming path.
    if (keep || size <= SYNC_INFLATE_MAX) {
      // Worst-case deflate expansion is ~5 bytes per 16 KB plus a header.
      const needed = Number.isFinite(size) ? size + (size >> 12) + 64 : this.win.length;
      const slice = await this.view(start, this.win.length, Math.min(needed, this.win.length));
      try {
        // info:true returns the engine so we can read how much of the
        // input the compressed stream consumed (bytesWritten).
        // Size the output chunk to the object: the default 16 KB chunk per
        // call is most of the garbage on a push of many small files.
        const chunkSize = Number.isFinite(size) ? Math.max(64, Math.min(size + 64, SYNC_INFLATE_MAX)) : 16 * 1024;
        const { buffer, engine } = inflateSync(slice, { info: true, chunkSize } as never) as unknown as {
          buffer: Buffer;
          engine: { bytesWritten: number };
        };
        const digest = hashHeader === null ? null : createHash("sha1").update(hashHeader);
        digest?.update(buffer);
        return { data: keep ? buffer : null, used: engine.bytesWritten, hash: digest?.digest("hex") ?? null };
      } catch {
        /* the compressed stream runs past the window, or is bad — the
           streaming pass below reports which */
      }
    }
    const inflate = createInflate();
    const chunks: Buffer[] = [];
    const digest = hashHeader === null ? null : createHash("sha1").update(hashHeader);
    let failed: Error | null = null;
    let ended = false;
    let markEnded!: () => void;
    const endedPromise = new Promise<void>((resolve) => (markEnded = resolve));
    const consume = (async () => {
      try {
        for await (const c of inflate) {
          const b = c as Buffer;
          if (keep) chunks.push(b);
          digest?.update(b);
        }
        ended = true;
      } catch (e) {
        failed = e as Error;
        ended = true;
      } finally {
        markEnded();
      }
    })();
    let pos = start;
    while (!ended) {
      const piece = await this.view(pos, this.win.length);
      if (piece.length === 0) break;
      pos += piece.length;
      if (!inflate.write(piece)) {
        // Writable backpressure — but once the deflate stream has ended the
        // writable side never drains again, so waiting on "drain" alone
        // deadlocks. Wake on either.
        await Promise.race([once(inflate, "drain").catch(() => {}), endedPromise]);
      } else {
        await new Promise((r) => setImmediate(r));
      }
    }
    inflate.end();
    await consume.catch(() => {});
    inflate.destroy();
    if (failed) throw new PushGateError("unreadable", `inflate failed: ${(failed as Error).message}`);
    if (!ended) throw new PushGateError("unreadable", "truncated object stream");
    return {
      data: keep ? Buffer.concat(chunks) : null,
      used: inflate.bytesWritten,
      hash: digest ? digest.digest("hex") : null,
    };
  }

  get count(): number {
    return this.entries.length;
  }

  /** The sha1 of entry `i`, resolving deltas as needed. */
  async idOf(i: number): Promise<string> {
    const known = this.ids.get(i);
    if (known) return known;
    if (this.resolving.has(i)) throw new PushGateError("unreadable", "delta cycle");
    this.resolving.add(i);
    try {
      const resolved = await this.resolve(i);
      const id = objectId(resolved.type, resolved.content);
      this.ids.set(i, id);
      this.byId.set(id, i);
      return id;
    } finally {
      this.resolving.delete(i);
    }
  }

  /** Inflated content of a non-delta object already kept, or null. */
  cached(i: number): Buffer | null {
    return this.contents.get(i) ?? null;
  }

  /**
   * Fully resolved {type, content}. Delta bases outside the pack (a thin
   * pack) or unreadable entries surface as `unreadable`.
   */
  async resolve(i: number): Promise<{ type: "commit" | "tree" | "blob" | "tag"; content: Buffer }> {
    const entry = this.entries[i]!;
    if (entry.type !== "ofs-delta" && entry.type !== "ref-delta") {
      const kept = this.contents.get(i);
      if (kept) return { type: entry.type, content: kept };
      // A full object that was not retained — needed as a delta base or
      // asked for directly. Re-inflate it; one object at a time.
      const { data } = await this.inflateAt(entry.dataOffset, true, null);
      return { type: entry.type, content: data! };
    }
    const cachedDelta = this.resolvedCache.get(i);
    if (cachedDelta) return cachedDelta;
    const delta = this.contents.get(i) ?? (await this.inflateAt(entry.dataOffset, true, null)).data!;
    const baseIndex = this.baseIndexOf(entry);
    if (baseIndex < 0) {
      throw new PushGateError("unreadable", entry.type === "ofs-delta" ? "ofs-delta base missing" : "ref-delta base outside the pack");
    }
    if (this.resolving.has(baseIndex)) throw new PushGateError("unreadable", "delta cycle");
    this.resolving.add(i);
    try {
      const base = await this.resolve(baseIndex);
      const content = applyDelta(base.content, delta);
      if (base.type !== "blob") {
        const out = { type: base.type, content };
        this.resolvedCache.set(i, out);
        this.contents.delete(i); // the rebuilt object replaces its delta stream
        return out;
      }
      return { type: base.type, content };
    } finally {
      this.resolving.delete(i);
    }
  }

  private baseIndexOf(entry: PackEntry): number {
    const bi = entry.type === "ofs-delta" ? this.byOffset.get(entry.baseOffset!) : this.byId.get(entry.baseId!);
    return bi ?? -1;
  }

  /**
   * After the pass: give every commit/tree/tag delta its id, so lookups are
   * a map hit. Ref deltas whose base only appeared later settle here too;
   * the loop runs until nothing new resolves. Deltas that rebuild blobs are
   * left alone — their ids are never needed by the checks.
   */
  private async resolveStructure(): Promise<void> {
    for (let progress = true; progress; ) {
      progress = false;
      for (const entry of this.entries) {
        if (entry.type !== "ofs-delta" && entry.type !== "ref-delta") continue;
        if (this.ids.has(entry.index)) continue;
        let root = this.rootTypes[entry.index]!;
        if (root === "unknown") {
          const bi = this.baseIndexOf(entry);
          if (bi < 0 || this.rootTypes[bi] === "unknown") continue;
          root = this.rootTypes[bi]!;
          this.rootTypes[entry.index] = root;
          progress = true;
          if (root === "blob") {
            this.contents.delete(entry.index);
            continue;
          }
          // A structural delta dropped for size is re-read by `resolve`.
        }
        if (root === "blob") continue;
        const resolved = await this.resolve(entry.index);
        const id = objectId(resolved.type, resolved.content);
        this.ids.set(entry.index, id);
        this.byId.set(id, entry.index);
        progress = true;
      }
    }
    // With `no-thin` advertised every base must be inside the pack; a delta
    // still pointing outside it cannot be checked, so it is not accepted.
    if (this.rootTypes.includes("unknown")) {
      throw new PushGateError("unreadable", "delta base outside the pack");
    }
  }

  /** An object id to its entry index, or -1. Commit/tree/tag ids are all known after open. */
  async indexOfId(id: string): Promise<number> {
    const hit = this.byId.get(id);
    if (hit !== undefined) return hit;
    return this.findSmallBlobDelta(id);
  }

  /**
   * The one lookup that may need a blob delta's id: a small file the gate
   * must read (the ignore list). Scans blob deltas one at a time, skipping
   * any whose delta or rebuilt size is over MAX_ONDEMAND_BLOB, so memory
   * stays bounded. Results are remembered.
   */
  private async findSmallBlobDelta(id: string): Promise<number> {
    for (const entry of this.entries) {
      if (entry.type !== "ofs-delta" && entry.type !== "ref-delta") continue;
      if (this.ids.has(entry.index) || this.rootTypes[entry.index] !== "blob") continue;
      if (entry.size > MAX_ONDEMAND_BLOB) continue;
      try {
        const delta = (await this.inflateAt(entry.dataOffset, true, null)).data!;
        if (deltaTargetSize(delta) > MAX_ONDEMAND_BLOB) continue;
        const baseIndex = this.baseIndexOf(entry);
        if (baseIndex < 0 || this.entries[baseIndex]!.size > SYNC_INFLATE_MAX) continue;
        const base = await this.resolve(baseIndex);
        const got = objectId("blob", applyDelta(base.content, delta));
        this.ids.set(entry.index, got);
        this.byId.set(got, entry.index);
        if (got === id) return entry.index;
      } catch {
        /* unreadable candidates are skipped; the caller falls back */
      }
    }
    return -1;
  }

  /**
   * Read a blob's content on demand (e.g. the ignore file) regardless of
   * the retention rule, bounded at MAX_ONDEMAND_BLOB.
   */
  async readBlob(i: number): Promise<Buffer> {
    const entry = this.entries[i]!;
    const kept = this.contents.get(i);
    if (kept) return kept;
    if (entry.size > MAX_ONDEMAND_BLOB) {
      throw new PushGateError("unreadable", "blob too large to read back");
    }
    if (entry.type === "blob") {
      const { data } = await this.inflateAt(entry.dataOffset, true, null);
      return data!;
    }
    const resolved = await this.resolve(i);
    if (resolved.type !== "blob") throw new PushGateError("unreadable", "not a blob");
    return resolved.content;
  }

  /** Every entry index of a stored (unresolved) type. */
  commitsInPack(): number[] {
    return this.entries.filter((e) => e.type === "commit").map((e) => e.index);
  }

  async close(): Promise<void> {
    await this.fh.close().catch(() => {});
  }
}

function objectId(type: string, content: Buffer): string {
  const hash = createHash("sha1");
  hash.update(`${type} ${content.length}\0`);
  hash.update(content);
  return hash.digest("hex");
}

/** The rebuilt size a delta stream declares (its second varint). */
function deltaTargetSize(delta: Buffer): number {
  let p = 0;
  const varint = (): number => {
    let v = 0;
    let shift = 0;
    for (;;) {
      if (p >= delta.length) throw new PushGateError("unreadable", "delta truncated");
      const b = delta[p++]!;
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(b & 0x80)) return v;
    }
  };
  varint();
  return varint();
}

/** Classic git delta application: source/target size varints + copy/insert ops. */
export function applyDelta(base: Buffer, delta: Buffer): Buffer {
  let p = 0;
  const varint = (): number => {
    let v = 0;
    let shift = 0;
    for (;;) {
      if (p >= delta.length) throw new PushGateError("unreadable", "delta truncated");
      const b = delta[p++]!;
      v |= (b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) return v;
    }
  };
  const srcSize = varint();
  if (srcSize !== base.length) throw new PushGateError("unreadable", "delta base size mismatch");
  const dstSize = varint();
  const out = Buffer.alloc(dstSize);
  let w = 0;
  while (p < delta.length) {
    const op = delta[p++]!;
    if (op & 0x80) {
      let offset = 0;
      let length = 0;
      for (let i = 0; i < 4; i++) if (op & (1 << i)) offset |= delta[p++]! << (8 * i);
      for (let i = 0; i < 3; i++) if (op & (0x10 << i)) length |= delta[p++]! << (8 * i);
      if (length === 0) length = 0x10000;
      base.copy(out, w, offset, offset + length);
      w += length;
    } else if (op > 0) {
      delta.copy(out, w, p, p + op);
      w += op;
      p += op;
    } else {
      throw new PushGateError("unreadable", "bad delta opcode");
    }
  }
  if (w !== dstSize) throw new PushGateError("unreadable", "delta produced wrong size");
  return out;
}

