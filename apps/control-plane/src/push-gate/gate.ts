/**
 * The push gate's decisions and how they are spoken back to the client.
 * The gate itself is a list of `PushCheck`s run over a `PushInspection` —
 * today that is one check (the leave-out rules); a later scrub check slots
 * in beside it without touching the plumbing.
 */

import { randomUUID } from "node:crypto";
import { pushRefusalFor } from "@goodfolder/shared";
import type { PushInspection } from "./inspect.ts";
import { pktLine, band, FLUSH } from "./pktline.ts";

export interface RefusalPath {
  path: string;
  kind: "credentials" | "ignored";
  pattern: string;
  reason: string;
}

export interface PushRefusal {
  code: "left-out" | "unreadable" | "too-large";
  refusalId: string;
  paths: RefusalPath[];
  total: number;
}

export interface CheckContext {
  includedOnPurpose: readonly string[];
}

/**
 * A gate check: look at what the push lands and return the paths it must
 * not carry. `ctx` is for check-independent inputs (deliberate includes).
 */
export type PushCheck = (
  inspection: PushInspection,
  ctx: CheckContext,
) => RefusalPath[];

/** The one shared rule: credentials first, then the folder's ignore list. */
export const leftOutCheck: PushCheck = (inspection, ctx) => {
  const deliberate = new Set(ctx.includedOnPurpose);
  const refusals: RefusalPath[] = [];
  for (const path of inspection.addedPaths) {
    if (deliberate.has(path)) continue;
    const hit = pushRefusalFor(path, inspection.ignorePatterns, (p) =>
      inspection.presentPaths.has(p),
    );
    if (!hit) continue;
    refusals.push({
      path,
      kind: hit.kind,
      pattern: hit.pattern,
      reason:
        hit.kind === "credentials"
          ? `looks like it holds passwords or keys (rule: ${hit.pattern})`
          : `on this folder's ignore list (${hit.pattern})`,
    });
  }
  return refusals;
};

export const PUSH_CHECKS: PushCheck[] = [leftOutCheck];

export function runChecks(inspection: PushInspection, ctx: CheckContext): RefusalPath[] {
  return PUSH_CHECKS.flatMap((check) => check(inspection, ctx));
}

const FIRST_LINE: Record<PushRefusal["code"], (n: number) => string> = {
  "left-out": (n) => `GoodFolder refused this save: ${n} file${n === 1 ? " is" : "s are"} left out by this folder's rules.`,
  unreadable: () => "GoodFolder could not check this save: its contents were unreadable.",
  "too-large": () => "This save is too large to check in one go. Save it in parts.",
};

const LAST_LINE: Record<PushRefusal["code"], string> = {
  "left-out": "Nothing from this save was kept. Take these files out and save again.",
  unreadable: "Nothing from this save was kept. Try saving again, or save it in parts.",
  "too-large": "Nothing from this save was kept. Save it in parts.",
};

const SHOWN = 50;
const JSON_PATHS = 200;

/** The band-2 text a refused push prints on the person's terminal. */
export function refusalText(refusal: PushRefusal): string {
  const lines: string[] = [FIRST_LINE[refusal.code](refusal.total)];
  for (const p of refusal.paths.slice(0, SHOWN)) {
    lines.push(`  ${p.path} — ${p.reason}`);
  }
  const rest = refusal.total - Math.min(refusal.total, SHOWN);
  if (rest > 0) lines.push(`  …and ${rest} more`);
  lines.push(LAST_LINE[refusal.code]);
  lines.push(`goodfolder-refusal ${JSON.stringify({
    code: refusal.code,
    refusalId: refusal.refusalId,
    paths: refusal.paths.slice(0, JSON_PATHS).map(({ path, kind, pattern, reason }) => ({ path, kind, pattern, reason })),
    total: refusal.total,
  })}`);
  return lines.join("\n") + "\n";
}

export function makeRefusal(code: PushRefusal["code"], paths: RefusalPath[]): PushRefusal {
  return { code, refusalId: randomUUID(), paths, total: paths.length };
}

/** `unpack ok` + `ng` per ref — the report-status a refused push answers. */
export function refusalReportStatus(
  refs: readonly { ref: string }[],
  code: string,
): Buffer[] {
  const lines = [pktLine("unpack ok")];
  for (const r of refs) lines.push(pktLine(`ng ${r.ref} ${code}: see messages above`));
  lines.push(FLUSH);
  return lines;
}

/** report-status for an upstream that failed after we already said 200. */
export function upstreamFailureStatus(refs: readonly { ref: string }[]): Buffer[] {
  return [
    pktLine("unpack error service unavailable"),
    ...refs.map((r) => pktLine(`ng ${r.ref} service unavailable`)),
    FLUSH,
  ];
}

export { pktLine, band, FLUSH };

// ---------------------------------------------------------------------------
// The plumbing half: spooling, the work queue, and the inspection pass.
// ---------------------------------------------------------------------------

import { createWriteStream, createReadStream } from "node:fs";
import { open as openFile, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { randomUUID as newId } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Transform } from "node:stream";
import { parseReceivePackBody, inspectPush, type RefUpdate } from "./inspect.ts";
import { PackReader } from "./pack.ts";
import { PushGateError } from "./pktline.ts";
import type { RemoteDeps } from "../remote.ts";

/** The gate's posture, from `GF_PUSH_GATE`. */
export type GateMode = "enforce" | "observe" | "off";

export function gateModeFrom(value: string | undefined): GateMode {
  return value === "observe" || value === "off" ? value : "enforce";
}

/** How many pushes may be checked at once; the rest wait for a slot. */
export class SlotLimiter {
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async acquire(): Promise<() => void> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running += 1;
    return () => {
      this.running -= 1;
      this.waiting.shift()?.();
    };
  }
}

export async function sweepSpoolDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const name of await readdir(dir)) {
    await unlink(join(dir, name)).catch(() => {});
  }
}

/**
 * Copy the request body to `spoolPath`, through the quota meter. Over the
 * byte cap the write is cut short and reported `too-large`; the file is the
 * caller's to delete.
 */
export async function spoolBody(
  req: IncomingMessage,
  spoolPath: string,
  through: Transform[],
  maxBytes: number,
): Promise<number> {
  let bytes = 0;
  const counter = new (await import("node:stream")).Transform({
    transform(chunk, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        cb(new PushGateError("too-large", "save body over the push cap"));
        return;
      }
      cb(null, chunk);
    },
  });
  const out = createWriteStream(spoolPath);
  try {
    await pipeline(req, counter, ...through, out);
  } catch (error) {
    out.destroy();
    throw error;
  }
  return bytes;
}

/** Decompress a spooled gzip body to a second file, for parsing only. */
async function gunzipSpool(source: string, dest: string): Promise<void> {
  await pipeline(createReadStream(source), createGunzip(), createWriteStream(dest));
}

export interface GateDecision {
  /** Commands seen, or [] when the body carried none (forwarded unchecked). */
  refs: RefUpdate[];
  capabilities: string[];
  inspection: PushInspection | null;
  refusal: PushRefusal | null;
  includedOnPurpose: string[];
  packBytes: number;
}

/**
 * Parse and inspect a spooled push. `isDevice` decides whether
 * `goodfolder-include=` options mean anything. Throws PushGateError
 * `unreadable` when the body cannot be trusted.
 */
export async function decidePush(
  deps: RemoteDeps,
  projectId: string,
  spoolPath: string,
  opts: { gzip: boolean; isDevice: boolean },
): Promise<GateDecision> {
  let parsePath = spoolPath;
  let parsed;
  if (opts.gzip) {
    parsePath = `${spoolPath}.inflated`;
    await gunzipSpool(spoolPath, parsePath).catch((e) => {
      throw new PushGateError("unreadable", `gzip body could not be read: ${e.message}`);
    });
  }
  try {
    // The parser only needs the command section — everything up to the
    // PACK signature — so the head window is bounded instead of buffering
    // the whole body (4MB still covers ~50k ref updates).
    const HEAD_CAP = 4 << 20;
    const fh = await openFile(parsePath, "r");
    let windowBuf: Buffer;
    let size: number;
    try {
      size = (await fh.stat()).size;
      windowBuf = Buffer.alloc(Math.min(size, HEAD_CAP));
      let off = 0;
      while (off < windowBuf.length) {
        const { bytesRead } = await fh.read(windowBuf, off, windowBuf.length - off, off);
        if (bytesRead === 0) break;
        off += bytesRead;
      }
      windowBuf = windowBuf.subarray(0, off);
    } finally {
      await fh.close();
    }
    try {
      parsed = parseReceivePackBody(windowBuf, false);
    } catch (e) {
      if (size > windowBuf.length) {
        throw new PushGateError("unreadable", "command section exceeds the head window");
      }
      throw e;
    }
    if (parsed.commands.length > 0 && parsed.packOffset < 0 && size > windowBuf.length) {
      throw new PushGateError("unreadable", "pack signature not within the head window");
    }
    const decision: GateDecision = {
      refs: parsed.commands,
      capabilities: parsed.capabilities,
      inspection: null,
      refusal: null,
      includedOnPurpose: [],
      packBytes: parsed.packOffset >= 0 ? size - parsed.packOffset : 0,
    };
    if (parsed.commands.length === 0 || parsed.packOffset < 0) return decision;
    const pack = await PackReader.open(parsePath, parsed.packOffset);
    try {
      const inspection = await inspectPush(deps, projectId, pack, parsed, { isDevice: opts.isDevice });
      inspection.packBytes = decision.packBytes;
      decision.inspection = inspection;
      decision.includedOnPurpose = inspection.includedOnPurpose;
      const refusals = runChecks(inspection, { includedOnPurpose: inspection.includedOnPurpose });
      if (refusals.length > 0) {
        decision.refusal = makeRefusal("left-out", refusals);
      }
      return decision;
    } finally {
      await pack.close();
    }
  } finally {
    if (parsePath !== spoolPath) await unlink(parsePath).catch(() => {});
  }
}

/** A fresh spool path under `dir`. */
export async function newSpoolPath(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return join(dir, `push-${newId()}.bin`);
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

export { createReadStream };
