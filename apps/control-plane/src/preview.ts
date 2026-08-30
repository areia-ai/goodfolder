/**
 * Which in-browser preview a file gets, decided purely from its path.
 *
 * Byte storage decides nothing here: files below the routing floor live inline
 * and files at or above it live in object storage behind a small text pointer
 * — both are served by the raw preview endpoint, so the same kinds preview at
 * any size up to PREVIEW_BYTE_CAP.
 *
 * Mirrored (deliberately, not shared) in apps/web/lib/preview.ts — apps/web
 * builds standalone on Cloudflare Pages without workspace dependencies. Both
 * copies are unit-tested; keep the extension sets identical when you touch
 * either.
 */

export type PreviewKind =
  | "text" // UTF-8 text shown as-is; markdown stays the only editable kind
  | "image" // browser-decodable images; svg is only ever rendered via <img>
  | "pdf"
  | "word" // .docx converted to HTML in the browser
  | "sheet" // .xlsx, read-only grid
  | "slides" // .pptx, lightweight slide canvas with an approximation note
  | "video" // browser-native video controls
  | "audio" // browser-native audio controls
  | "quicklook"; // .key/.numbers embedded QuickLook preview, when present

/** Largest file the browser preview will carry, checked before any bytes move. */
export const PREVIEW_BYTE_CAP = 25_000_000;

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

export function previewKindFor(path: string): PreviewKind | null {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  for (const [kind, set] of Object.entries(PREVIEW_EXTENSIONS)) {
    if (set.has(ext)) return kind as PreviewKind;
  }
  return null;
}

const PREVIEW_MIMES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  key: "application/x-iwork-keynote-sffkey",
  numbers: "application/x-iwork-numbers-sffnumbers",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
};

/** Content type for raw bytes of a non-text preview kind; null for text. */
export function previewMimeFor(path: string): string | null {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return PREVIEW_MIMES[base.slice(dot + 1).toLowerCase()] ?? null;
}

const POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";

/**
 * A file at or above the routing floor of an incompressible type is stored as
 * a small text pointer naming its object; the bytes live in object storage
 * under `${projectId}/${oid}`. Returns null for anything stored inline.
 */
export function parseStoredFilePointer(
  content: Buffer,
): { oid: string; size: number } | null {
  if (!content.subarray(0, 80).toString("utf8").startsWith(POINTER_PREFIX)) {
    return null;
  }
  const text = content.toString("utf8");
  const oid = /oid sha256:([0-9a-f]{64})/.exec(text)?.[1];
  const size = Number(/^size (\d+)\s*$/m.exec(text)?.[1]);
  if (!oid || !Number.isSafeInteger(size) || size < 0) return null;
  return { oid, size };
}
