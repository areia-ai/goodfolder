/**
 * Writing a file whose bytes are too big to sit inline.
 *
 * Above the routing floor a file's bytes live in object storage and the
 * folder holds a three-line note naming them. `preview.ts` reads that note;
 * this writes it. The round trip between the two is tested, because a note
 * this cannot read back is a file nobody can open.
 *
 * The object's name is the hash of its own bytes, so the same file uploaded
 * twice lands in the same place and the second write costs nothing extra.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand, type S3Client } from "@goodfolder/serverlib";

const POINTER_VERSION = "version https://git-lfs.github.com/spec/v1";

export interface StoredFile {
  /** The bytes' own hash, and the name they are filed under. */
  oid: string;
  size: number;
  /** What goes in the folder in place of the bytes. */
  pointer: Buffer;
}

/** The note that stands in for a file's bytes. Pure. */
export function storedFilePointer(oid: string, size: number): Buffer {
  if (!/^[0-9a-f]{64}$/.test(oid)) throw new Error("stored file needs a sha256 name");
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("stored file needs a real size");
  return Buffer.from(`${POINTER_VERSION}\noid sha256:${oid}\nsize ${size}\n`, "utf8");
}

/** Where a project's object lives. The one place this shape is written. */
export function storedFileKey(projectId: string, oid: string): string {
  return `${projectId}/${oid}`;
}

/**
 * Where bytes wait while a proposal to add them is open.
 *
 * Deliberately not the shape above: the pass that works out what an account
 * is storing reads the object store by key, and matches only the shape above.
 * Bytes nobody has accepted are nobody's storage, so they must not be counted
 * — and the only way to be sure of that is for them not to look like it.
 */
export function stagingKey(projectId: string, oid: string): string {
  return `staging/${projectId}/${oid}`;
}

export function hashBytes(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Put a file's bytes in object storage and hand back the note to write in
 * its place. Safe to call twice with the same bytes: the name is the hash,
 * so the second call overwrites the object with itself.
 */
export async function putStoredFile(input: {
  s3: S3Client;
  bucket: string;
  projectId: string;
  content: Buffer;
  contentType?: string | undefined;
}): Promise<StoredFile> {
  const oid = hashBytes(input.content);
  await input.s3.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: storedFileKey(input.projectId, oid),
      Body: input.content,
      ...(input.contentType ? { ContentType: input.contentType } : {}),
    }),
  );
  return { oid, size: input.content.byteLength, pointer: storedFilePointer(oid, input.content.byteLength) };
}

/** The same hash, taken a chunk at a time so a large file never sits in memory. */
export async function hashFile(sourcePath: string): Promise<string> {
  const digest = createHash("sha256");
  await pipeline(createReadStream(sourcePath), digest);
  return digest.digest("hex");
}

/**
 * The same as `putStoredFile`, for bytes that are already on disk. Nothing
 * is read into memory at either step: the hash is taken a chunk at a time,
 * and the bytes are handed to storage as a stream.
 */
export async function putStoredFileFromPath(input: {
  s3: S3Client;
  bucket: string;
  projectId: string;
  sourcePath: string;
  size: number;
  contentType?: string | undefined;
}): Promise<StoredFile> {
  const oid = await hashFile(input.sourcePath);
  await input.s3.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: storedFileKey(input.projectId, oid),
      Body: createReadStream(input.sourcePath),
      ContentLength: input.size,
      ...(input.contentType ? { ContentType: input.contentType } : {}),
    }),
  );
  return { oid, size: input.size, pointer: storedFilePointer(oid, input.size) };
}

/** Accept staged bytes into the folder proper, and let go of the copy. */
export async function acceptStagedFile(input: {
  s3: S3Client;
  bucket: string;
  projectId: string;
  oid: string;
  size: number;
}): Promise<StoredFile> {
  await input.s3.send(
    new CopyObjectCommand({
      Bucket: input.bucket,
      Key: storedFileKey(input.projectId, input.oid),
      CopySource: `${input.bucket}/${stagingKey(input.projectId, input.oid)}`,
    }),
  );
  await forgetStagedFile(input);
  return { oid: input.oid, size: input.size, pointer: storedFilePointer(input.oid, input.size) };
}

/** Drop staged bytes — accepted and copied on, turned down, or timed out. */
export async function forgetStagedFile(input: {
  s3: S3Client;
  bucket: string;
  projectId: string;
  oid: string;
}): Promise<void> {
  await input.s3
    .send(new DeleteObjectCommand({ Bucket: input.bucket, Key: stagingKey(input.projectId, input.oid) }))
    .catch(() => {
      // Already gone is the outcome we wanted. A sweep that stops on the
      // first missing object leaves everything behind it.
    });
}
