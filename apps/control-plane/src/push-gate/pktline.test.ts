import assert from "node:assert/strict";
import { test } from "node:test";
import { advertiseNoThin, band, pktLine, readPktLine, FLUSH } from "./pktline.ts";

const ADVERTISEMENT = Buffer.concat([
  pktLine("# service=git-receive-pack\n"),
  FLUSH,
  pktLine(
    "0000000000000000000000000000000000000000 capabilities^{}\0report-status report-status-v2 delete-refs side-band-64k quiet atomic ofs-delta push-options object-format=sha1 agent=git/2.52.0",
  ),
  FLUSH,
]);

test("pkt-line round-trips through readPktLine", () => {
  const buf = Buffer.concat([pktLine("hello"), FLUSH, pktLine(Buffer.from("world"))]);
  const a = readPktLine(buf, 0);
  assert.equal(a.payload?.toString(), "hello");
  const b = readPktLine(buf, a.next);
  assert.equal(b.payload, null);
  const c = readPktLine(buf, b.next);
  assert.equal(c.payload?.toString(), "world");
});

test("advertiseNoThin appends to the first ref line's capability list", () => {
  const out = advertiseNoThin(ADVERTISEMENT);
  // The service line and the flush pass through untouched, framing included.
  const headLen = pktLine("# service=git-receive-pack\n").length + 4;
  assert.deepEqual(out.subarray(0, headLen), ADVERTISEMENT.subarray(0, headLen));
  const line = readPktLine(out, pktLine("# service=git-receive-pack\n").length + 4);
  const text = line.payload!.toString();
  assert.ok(text.endsWith(" no-thin"));
  assert.ok(text.includes("capabilities^{}\0report-status"));
  // The length was recomputed for the longer line.
  assert.equal(line.next, out.length - 4);
  assert.equal(out.subarray(out.length - 4).toString(), "0000");
});

test("advertiseNoThin is idempotent", () => {
  const once = advertiseNoThin(ADVERTISEMENT);
  const twice = advertiseNoThin(once);
  assert.deepEqual(twice, once);
});

test("advertiseNoThin handles a non-empty advertisement", () => {
  const withRefs = Buffer.concat([
    pktLine("# service=git-receive-pack\n"),
    FLUSH,
    pktLine("a".repeat(40) + " refs/heads/main\0report-status side-band-64k ofs-delta"),
    pktLine("b".repeat(40) + " refs/heads/dev"),
    FLUSH,
  ]);
  const out = advertiseNoThin(withRefs);
  const first = readPktLine(out, pktLine("# service=git-receive-pack\n").length + 4);
  assert.ok(first.payload!.toString().includes("ofs-delta no-thin"));
  // The second ref line is untouched.
  const second = readPktLine(out, first.next);
  assert.equal(second.payload!.toString(), "b".repeat(40) + " refs/heads/dev");
});

test("advertiseNoThin leaves non-advertisements alone", () => {
  const junk = Buffer.from("this is not an advertisement");
  assert.deepEqual(advertiseNoThin(junk), junk);
  const partial = pktLine("unterminated") as Buffer;
  assert.deepEqual(advertiseNoThin(partial), partial);
});

test("band wraps a payload in a channel byte", () => {
  const frame = band(2, "hi there\n");
  const { payload } = readPktLine(frame, 0);
  assert.equal(payload![0], 2);
  assert.equal(payload!.subarray(1).toString(), "hi there\n");
});
