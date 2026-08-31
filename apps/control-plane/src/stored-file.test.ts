import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStoredFilePointer } from "./preview.ts";
import { hashBytes, stagingKey, storedFileKey, storedFilePointer } from "./stored-file.ts";

test("what is written is what is read back", () => {
  const bytes = Buffer.from("a small stand-in for a large photo", "utf8");
  const oid = hashBytes(bytes);
  const pointer = storedFilePointer(oid, bytes.byteLength);
  assert.deepEqual(parseStoredFilePointer(pointer), { oid, size: bytes.byteLength });
});

test("the same bytes always get the same name", () => {
  const a = hashBytes(Buffer.from([1, 2, 3]));
  const b = hashBytes(Buffer.from([1, 2, 3]));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, hashBytes(Buffer.from([1, 2, 4])));
});

test("an empty file still has a name and a size", () => {
  const oid = hashBytes(Buffer.alloc(0));
  assert.deepEqual(parseStoredFilePointer(storedFilePointer(oid, 0)), { oid, size: 0 });
});

test("a name that isn't a hash is refused before anything is written", () => {
  assert.throws(() => storedFilePointer("nope", 10));
  assert.throws(() => storedFilePointer("A".repeat(64), 10));
  assert.throws(() => storedFilePointer("a".repeat(64), -1));
  assert.throws(() => storedFilePointer("a".repeat(64), 1.5));
});

test("a project's objects are filed under the project", () => {
  assert.equal(storedFileKey("proj_1", "a".repeat(64)), `proj_1/${"a".repeat(64)}`);
});

test("waiting bytes are not filed where storage is counted", () => {
  const oid = "b".repeat(64);
  // The usage pass reads the object store by key and counts what looks like
  // `<project>/<oid>`. Bytes nobody has accepted must not look like that.
  const counted = /^([0-9a-f-]{36})\/([a-f0-9]{64})$/;
  assert.match(storedFileKey("11111111-2222-3333-4444-555555555555", oid), counted);
  assert.doesNotMatch(stagingKey("11111111-2222-3333-4444-555555555555", oid), counted);
});
