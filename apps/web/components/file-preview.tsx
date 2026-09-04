"use client";

import { useEffect, useState } from "react";
import {
  AudioPreview, ImagePreview, PdfPreview, QuickLookPreview, SheetPreview,
  SlidesPreview, UnsupportedView, VideoPreview, WordPreview,
} from "@/components/file-viewers";
import { PagePreview } from "@/components/page-preview";
import { isRenderablePage } from "@/lib/preview";
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
  folderId,
  onSelect,
  maxHeight,
}: {
  file: OpenedFile;
  /** The folder the file sits in, so a web page can carry in the stylesheet
   *  and pictures beside it. Absent for a file that is not in a folder yet —
   *  a proposed one under review — which renders on its own. */
  folderId?: string | null;
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
    return <TextFile path={file.path} content={file.content} folderId={folderId} maxHeight={maxHeight} />;
  }
  // A file that is text but arrived as bytes: a proposed one, staged outside
  // the folder and read back for review. Nothing else knows how to show it,
  // and a proposed web page not rendering is exactly the thing being reviewed.
  if (file.kind === "text" && file.blob) {
    return <TextFromBytes path={file.path} blob={file.blob} folderId={folderId} maxHeight={maxHeight} />;
  }
  return <UnsupportedView file={file} />;
}

function TextFile({
  path,
  content,
  folderId,
  maxHeight,
}: {
  path: string;
  content: string;
  folderId?: string | null;
  maxHeight?: string;
}) {
  if (isRenderablePage(path)) {
    return <PagePreview folderId={folderId ?? null} path={path} content={content} />;
  }
  return (
    <pre
      className="overflow-auto whitespace-pre-wrap break-words p-6 text-[13px] leading-relaxed"
      style={{ maxHeight: maxHeight ?? "640px" }}
    >
      {content}
    </pre>
  );
}

function TextFromBytes({
  path,
  blob,
  folderId,
  maxHeight,
}: {
  path: string;
  blob: Blob;
  folderId?: string | null;
  maxHeight?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setText(null);
    blob.text().then(
      (read) => {
        if (alive) setText(read);
      },
      () => {
        if (alive) setText("");
      },
    );
    return () => {
      alive = false;
    };
  }, [blob]);
  if (text === null) {
    return (
      <div className="grid min-h-[320px] place-items-center p-8" role="status" aria-live="polite">
        <span className="gf-faint text-[13px]">Opening…</span>
      </div>
    );
  }
  return <TextFile path={path} content={text} folderId={folderId} maxHeight={maxHeight} />;
}
