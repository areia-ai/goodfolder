"use client";

import {
  AudioPreview, ImagePreview, PdfPreview, QuickLookPreview, SheetPreview,
  SlidesPreview, UnsupportedView, VideoPreview, WordPreview,
} from "@/components/file-viewers";
import type { OpenedFile } from "@/lib/gf-api";

/**
 * One file, shown the way its type deserves.
 *
 * The choice used to be written out inside the document surface, which meant
 * anywhere else that wanted to show a file — a column, a gallery, a glance —
 * had to write the same ladder again and could drift from it. It is one
 * component now, and every place a file is looked at goes through it.
 */
export function FilePreview({
  file,
  onSelect,
  maxHeight,
}: {
  file: OpenedFile;
  /** A sheet reports the cell you picked, so a comment can be anchored to it. */
  onSelect?: (value: string) => void;
  /** Caps the plain-text view; a glance wants a different bound to a page. */
  maxHeight?: string;
}) {
  if (file.blob) {
    if (file.kind === "image") return <ImagePreview path={file.path} blob={file.blob} />;
    if (file.kind === "pdf") return <PdfPreview path={file.path} blob={file.blob} />;
    if (file.kind === "word") return <WordPreview path={file.path} blob={file.blob} />;
    if (file.kind === "sheet") return <SheetPreview path={file.path} blob={file.blob} onSelect={onSelect} />;
    if (file.kind === "slides") return <SlidesPreview path={file.path} blob={file.blob} />;
    if (file.kind === "video") return <VideoPreview path={file.path} blob={file.blob} />;
    if (file.kind === "audio") return <AudioPreview path={file.path} blob={file.blob} />;
    if (file.kind === "quicklook") return <QuickLookPreview path={file.path} blob={file.blob} />;
  }
  if (file.kind === "text" && file.content !== undefined) {
    return (
      <pre
        className="overflow-auto whitespace-pre-wrap break-words p-6 text-[13px] leading-relaxed"
        style={{ maxHeight: maxHeight ?? "640px" }}
      >
        {file.content}
      </pre>
    );
  }
  return <UnsupportedView file={file} />;
}
