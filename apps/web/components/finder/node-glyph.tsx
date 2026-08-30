"use client";

import {
  AudioIcon, DocumentIcon, FileIcon, FolderIcon, ImageIcon, PdfIcon,
  SheetIcon, SlidesIcon, TerminalIcon, VideoIcon,
} from "@/components/icons";
import { extensionOfPath, previewKindFor } from "@/lib/preview";
import type { VfsNode } from "@/lib/vfs";

/**
 * Source files read as text, but a page glyph on a Python file says the wrong
 * thing about what is inside. They get their own mark.
 */
const SOURCE = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "py", "rb", "go", "rs",
  "java", "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "php", "sh", "bash",
  "zsh", "fish", "sql", "lua", "dart", "ex", "exs", "tf", "proto", "vue",
  "svelte", "astro", "scss", "sass", "less", "css", "html", "json", "yaml",
  "yml", "toml", "ini", "cfg", "conf", "xml", "graphql", "gql", "prisma",
]);

export function glyphFor(node: VfsNode) {
  if (node.kind === "folder" || node.kind === "directory") return FolderIcon;
  const kind = previewKindFor(node.path);
  if (kind === "image") return ImageIcon;
  if (kind === "pdf") return PdfIcon;
  if (kind === "sheet") return SheetIcon;
  if (kind === "slides") return SlidesIcon;
  if (kind === "video") return VideoIcon;
  if (kind === "audio") return AudioIcon;
  if (kind === "word") return DocumentIcon;
  if (kind === "text") return SOURCE.has(extensionOfPath(node.path)) ? TerminalIcon : DocumentIcon;
  return FileIcon;
}

/** The mark beside a name. Folders carry a tint so they read first. */
export function NodeGlyph({ node, className = "" }: { node: VfsNode; className?: string }) {
  const Glyph = glyphFor(node);
  const isFolder = node.kind !== "file";
  return (
    <span className={`gf-win-glyph ${isFolder ? "gf-win-glyph-tint" : ""} ${className}`} aria-hidden="true">
      <Glyph />
    </span>
  );
}
