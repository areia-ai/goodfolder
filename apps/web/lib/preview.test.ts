import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatBytes,
  previewKindFor,
  previewKindLabel,
} from "./preview.ts";

test("previewKindFor covers the formats people actually keep", () => {
  assert.equal(previewKindFor("notes.md"), "text");
  assert.equal(previewKindFor("photos/Cat.JPG"), "image");
  assert.equal(previewKindFor("icon.svg"), "image");
  assert.equal(previewKindFor("IMG_0001.heic"), "image");
  assert.equal(previewKindFor("archive-scan.tiff"), "image");
  assert.equal(previewKindFor("Contract.pdf"), "pdf");
  assert.equal(previewKindFor("Proposal.docx"), "word");
  assert.equal(previewKindFor("Budget.xlsx"), "sheet");
  assert.equal(previewKindFor("Pitch.pptx"), "slides");
  assert.equal(previewKindFor("demo.mp4"), "video");
  assert.equal(previewKindFor("interview.m4a"), "audio");
  assert.equal(previewKindFor("Deck.key"), "quicklook");
  assert.equal(previewKindFor("Plan.numbers"), "quicklook");
});

test("previewKindFor refuses what the browser cannot show", () => {
  for (const path of ["report.doc", "sheet.xls", "deck.ppt", "art.psd", "bundle.zip", "Makefile"]) {
    assert.equal(previewKindFor(path), null, path);
  }
});

test("previewKindLabel speaks in human type names", () => {
  assert.equal(previewKindLabel("a.docx"), "Word document");
  assert.equal(previewKindLabel("IMG_0001.heic"), "iPhone photo");
  assert.equal(previewKindLabel("a.doc"), "Word document (older format)");
  assert.equal(previewKindLabel("a.xyz"), "XYZ file");
  assert.equal(previewKindLabel("Makefile"), "File");
});

test("formatBytes stays honest at every scale", () => {
  assert.equal(formatBytes(12), "12 B");
  assert.equal(formatBytes(820 * 1024), "820 KB");
  assert.equal(formatBytes(3.5 * 1024 * 1024), "3.5 MB");
  assert.equal(formatBytes(-1), "");
});
