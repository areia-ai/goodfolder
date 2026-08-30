// Which in-browser preview a file gets, decided purely from its path.
//
// Mirrored from apps/control-plane/src/preview.ts — apps/web builds
// standalone on Cloudflare Pages without workspace dependencies. Both copies
// are unit-tested; keep the extension sets identical when you touch either.
//
// Byte storage never decides the kind: small files and files kept as a
// pointer to the folder's full stored copy preview the same way, so a phone
// photo previews exactly like a screenshot.

export type PreviewKind =
  | "text" // shown as-is; markdown stays the only editable kind
  | "image" // svg is only ever rendered through <img>, never inlined
  | "pdf"
  | "word" // converted to HTML in the browser, shown in a sandboxed frame
  | "sheet" // read-only grid
  | "slides" // lightweight slide canvas with an honest approximation note
  | "video" // browser-native video controls
  | "audio" // browser-native audio controls
  | "quicklook"; // embedded preview snapshot inside Apple app files

const PREVIEW_EXTENSIONS: Record<PreviewKind, ReadonlySet<string>> = {
  text: new Set([
    "md", "markdown", "txt", "json", "csv", "tsv", "html", "css", "js", "jsx", "ts",
    "tsx", "yaml", "yml",
    // A folder someone is building an app in is still a folder. These read
    // as plain text like everything else here — shown, never run.
    "mjs", "cjs", "mts", "cts", "scss", "sass", "less", "vue", "svelte", "astro",
    "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cc",
    "cs", "php", "sh", "bash", "zsh", "fish", "sql", "toml", "ini", "cfg", "conf",
    "xml", "graphql", "gql", "prisma", "lua", "dart", "ex", "exs", "tf", "proto",
    "jsonl", "ndjson", "log", "patch", "lock", "gradle", "properties", "editorconfig",
  ]),
  image: new Set([
    "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico", "heic",
    "heif", "tif", "tiff",
  ]),
  pdf: new Set(["pdf"]),
  word: new Set(["docx"]),
  sheet: new Set(["xlsx"]),
  slides: new Set(["pptx"]),
  video: new Set(["mp4", "m4v", "webm", "ogv", "mov"]),
  audio: new Set(["mp3", "wav", "m4a", "ogg", "oga", "flac", "aac"]),
  quicklook: new Set(["key", "numbers"]),
};

/** Files the browser simply cannot display — named honestly, never faked. */
export const LEGACY_OFFICE_EXTENSIONS = new Set(["doc", "xls", "ppt"]);

/** Rows/cols rendered before the sheet grid truncates with a visible note. */
export const SHEET_ROW_CAP = 200;
export const SHEET_COL_CAP = 40;
/** Slides listed before the outline preview stops counting text lines. */
export const SLIDE_LINE_CAP = 8;

export function extensionOfPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function previewKindFor(path: string): PreviewKind | null {
  const ext = extensionOfPath(path);
  if (!ext) return null;
  for (const [kind, set] of Object.entries(PREVIEW_EXTENSIONS)) {
    if (set.has(ext)) return kind as PreviewKind;
  }
  return null;
}

/** Human type name for fallback states: "Word document", "Image", … */
export function previewKindLabel(path: string): string {
  const ext = extensionOfPath(path);
  const labels: Record<string, string> = {
    md: "Markdown document", markdown: "Markdown document", txt: "Text file",
    csv: "CSV file", json: "JSON file",
    png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", webp: "Image",
    svg: "Image", avif: "Image", bmp: "Image", ico: "Image",
    heic: "iPhone photo", heif: "Photo",
    tif: "Image", tiff: "Image",
    pdf: "PDF", docx: "Word document", xlsx: "Spreadsheet", pptx: "Slides",
    key: "Keynote presentation", numbers: "Numbers spreadsheet",
    mp4: "Video", m4v: "Video", webm: "Video", ogv: "Video", mov: "Video",
    mp3: "Audio recording", wav: "Audio recording", m4a: "Audio recording", ogg: "Audio recording",
    oga: "Audio recording", flac: "Audio recording", aac: "Audio recording",
    doc: "Word document (older format)", xls: "Spreadsheet (older format)",
    ppt: "Slides (older format)",
  };
  if (labels[ext]) return labels[ext];
  return ext ? `${ext.toUpperCase()} file` : "File";
}

/** "12 B" / "820 KB" / "3.4 MB" / "11.8 GB" — for captions and the status bar. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  // A storage limit is read in gigabytes. Four figures of megabytes is the
  // same number said in a way nobody checks against their plan.
  if (gb < 1024) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  return `${(gb / 1024).toFixed(1)} TB`;
}
