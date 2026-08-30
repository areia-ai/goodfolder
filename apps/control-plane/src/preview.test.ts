import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_BYTE_CAP,
  parseStoredFilePointer,
  previewKindFor,
  previewMimeFor,
} from "./preview.ts";

test("previewKindFor covers the document and image kinds", () => {
  assert.equal(previewKindFor("notes.md"), "text");
  assert.equal(previewKindFor("src/app.tsx"), "text");
  assert.equal(previewKindFor("photos/cat.JPG"), "image");
  assert.equal(previewKindFor("logo.svg"), "image");
  assert.equal(previewKindFor("logo.avif"), "image");
  assert.equal(previewKindFor("scan.tiff"), "image");
  assert.equal(previewKindFor("scan.PDF"), "pdf");
  assert.equal(previewKindFor("Proposal.docx"), "word");
  assert.equal(previewKindFor("Budget FY26.xlsx"), "sheet");
  assert.equal(previewKindFor("Pitch v3.pptx"), "slides");
  assert.equal(previewKindFor("Demo.mp4"), "video");
  assert.equal(previewKindFor("Interview.m4a"), "audio");
  assert.equal(previewKindFor("Deck.key"), "quicklook");
  assert.equal(previewKindFor("Plan.numbers"), "quicklook");
});

test("a folder someone is building an app in reads as text", () => {
  for (const path of ["api/server.py", "cmd/main.go", "src/lib.rs", "deploy.sh",
                      "schema.sql", "Cargo.toml", "app/Model.java", "web/App.vue"]) {
    assert.equal(previewKindFor(path), "text", path);
  }
  // Still nothing the browser cannot honestly show.
  assert.equal(previewKindFor("app.wasm"), null);
  assert.equal(previewKindFor("Dockerfile"), null); // no extension, as before
});

test("previewKindFor refuses anything the browser cannot show", () => {
  // legacy office formats
  assert.equal(previewKindFor("old-report.doc"), null);
  assert.equal(previewKindFor("old-sheet.xls"), null);
  assert.equal(previewKindFor("old-deck.ppt"), null);
  // design/media/archive types
  assert.equal(previewKindFor("mockup.psd"), null);
  assert.equal(previewKindFor("bundle.zip"), null);
  assert.equal(previewKindFor("disk.dmg"), null);
  // no or odd extensions
  assert.equal(previewKindFor("Makefile"), null);
  assert.equal(previewKindFor("archive.tar.gz"), null); // gz is not listed
  assert.equal(previewKindFor("folder/"), null);
});

test("previewMimeFor answers real content types and none for text", () => {
  assert.equal(previewMimeFor("a.png"), "image/png");
  assert.equal(previewMimeFor("b.svg"), "image/svg+xml");
  assert.equal(previewMimeFor("scan.tif"), "image/tiff");
  assert.equal(previewMimeFor("c.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(previewMimeFor("d.pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(previewMimeFor("e.key"), "application/x-iwork-keynote-sffkey");
  assert.equal(previewMimeFor("demo.mp4"), "video/mp4");
  assert.equal(previewMimeFor("interview.m4a"), "audio/mp4");
  assert.equal(previewMimeFor("notes.md"), null);
  assert.equal(previewMimeFor("old.doc"), null);
});

test("parseStoredFilePointer reads the object name and true size", () => {
  const pointer = Buffer.from(
    "version https://git-lfs.github.com/spec/v1\n" +
      "oid sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n" +
      "size 2457600\n",
    "utf8",
  );
  assert.deepEqual(parseStoredFilePointer(pointer), {
    oid: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    size: 2457600,
  });
});

test("parseStoredFilePointer returns null for inline bytes", () => {
  assert.equal(parseStoredFilePointer(Buffer.from("%PNG\n....", "utf8")), null);
  assert.equal(parseStoredFilePointer(Buffer.from("just some text", "utf8")), null);
  assert.equal(
    parseStoredFilePointer(Buffer.from("version https://git-lfs.github.com/spec/v1\noid sha256:nope\n")),
    null,
  );
});

test("preview byte cap stays at 25 MB", () => {
  assert.equal(PREVIEW_BYTE_CAP, 25_000_000);
});
