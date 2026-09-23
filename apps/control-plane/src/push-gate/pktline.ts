/**
 * pkt-line plumbing for the smart-HTTP push protocol. A pkt-line is a
 * 4-hex-digit length followed by that many - 4 bytes of payload; `0000`
 * is a flush. Side-band wraps each chunk as a pkt-line whose first byte
 * is the channel (1 = data, 2 = progress, 3 = fatal).
 */

export const FLUSH = Buffer.from("0000");

export function pktLine(payload: Buffer | string): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  return Buffer.concat([Buffer.from((body.length + 4).toString(16).padStart(4, "0"), "ascii"), body]);
}

/** A side-band chunk: channel byte + payload, framed as one pkt-line. */
export function band(channel: 1 | 2 | 3, payload: Buffer | string): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  return pktLine(Buffer.concat([Buffer.from([channel]), body]));
}

/** A progress (band 2) line. */
export function progress(text: string): Buffer {
  return band(2, text);
}

export interface PktLine {
  /** Payload, or null for a flush. */
  payload: Buffer | null;
  /** Offset of the next pkt-line in the buffer. */
  next: number;
}

/** Read one pkt-line starting at `off`. Throws on malformed framing. */
export function readPktLine(buf: Buffer, off: number): PktLine {
  if (off + 4 > buf.length) throw new PushGateError("unreadable", "truncated pkt-line");
  const head = buf.subarray(off, off + 4).toString("ascii");
  const len = parseInt(head, 16);
  if (Number.isNaN(len) || !/^[0-9a-fA-F]{4}$/.test(head)) {
    throw new PushGateError("unreadable", "malformed pkt-line length");
  }
  if (len === 0) return { payload: null, next: off + 4 };
  if (len < 4 || off + len > buf.length) throw new PushGateError("unreadable", "pkt-line overruns the body");
  return { payload: buf.subarray(off + 4, off + len), next: off + len };
}

export class PushGateError extends Error {
  constructor(
    public code: "left-out" | "unreadable" | "too-large",
    message: string,
  ) {
    super(message);
    this.name = "PushGateError";
  }
}

/**
 * Append ` no-thin` to the capability list carried on the first ref
 * pkt-line of a receive-pack advertisement (`# service=` line + flush +
 * ref lines). Idempotent; handles the empty-repo `capabilities^{}` line.
 * Anything that does not look like an advertisement is returned untouched.
 */
export function advertiseNoThin(buf: Buffer): Buffer {
  try {
    let off = 0;
    for (;;) {
      const { payload, next } = readPktLine(buf, off);
      off = next;
      if (payload === null) continue;
      const nul = payload.indexOf(0);
      if (nul < 0) continue; // the `# service=` line and further ref lines
      const caps = payload.subarray(nul + 1).toString("utf8");
      if (caps.split(" ").includes("no-thin")) return buf;
      const rewritten = Buffer.concat([payload, Buffer.from(" no-thin", "ascii")]);
      return Buffer.concat([
        buf.subarray(0, off - payload.length - 4),
        pktLine(rewritten),
        buf.subarray(off),
      ]);
    }
  } catch {
    return buf;
  }
}
