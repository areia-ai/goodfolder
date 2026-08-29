/**
 * GoodFolder shared domain types — v0.
 *
 * Everything here reflects decisions already settled in
 * TECHNICAL_PROPOSAL.md / LOG.md. Git vocabulary never appears in any type
 * that reaches the user-facing surface.
 */

export const GF_PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Storage routing
// ---------------------------------------------------------------------------

/** Where a file's bytes live. Never surfaced to users. */
export type StorageTarget = "git" | "lfs";

export const ROUTING_FLOOR_BYTES = 1 * 1024 * 1024; // below: everything in git
export const ROUTING_CEILING_BYTES = 100 * 1024 * 1024; // above: everything in lfs

export type RoutingReason =
  | "under-floor"
  | "compressible-type"
  | "incompressible-type"
  | "over-ceiling"
  | "unknown-type-size-fallback";

export interface RoutingDecision {
  path: string;
  sizeBytes: number;
  target: StorageTarget;
  reason: RoutingReason;
}

/**
 * First-cut classification lists (open item in LOG.md; tighten from real
 * corpora). ZIP containers (.docx/.xlsx/.pdf) behave like media.
 */
const INCOMPRESSIBLE_EXTENSIONS = new Set([
  // images
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "tif", "tiff",
  "ico", "bmp", "psd", "ai", "raw", "dng",
  // audio
  "mp3", "wav", "aac", "ogg", "flac", "m4a", "aiff",
  // video
  "mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "prores", "braw",
  // zip containers
  "zip", "docx", "xlsx", "pptx", "pdf", "7z", "rar", "jar", "apk", "ipa",
  "epub", "odt", "ods", "odp",
  // archives / disk
  "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "dmg",
]);

const COMPRESSIBLE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "ndjson", "yaml",
  "yml", "xml", "svg", "html", "htm", "css", "scss", "js", "mjs", "cjs",
  "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt", "swift", "c",
  "h", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "fish", "sql", "toml",
  "ini", "cfg", "conf", "env", "gitignore", "log", "srt", "vtt", "fountain",
]);

export function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(idx + 1).toLowerCase() : "";
}

/** Deterministic routing rule. Same input, same target, every device. */
export function routeFile(path: string, sizeBytes: number): RoutingDecision {
  if (sizeBytes < ROUTING_FLOOR_BYTES) {
    return { path, sizeBytes, target: "git", reason: "under-floor" };
  }
  if (sizeBytes > ROUTING_CEILING_BYTES) {
    return { path, sizeBytes, target: "lfs", reason: "over-ceiling" };
  }
  const ext = extensionOf(path);
  if (INCOMPRESSIBLE_EXTENSIONS.has(ext)) {
    return { path, sizeBytes, target: "lfs", reason: "incompressible-type" };
  }
  if (COMPRESSIBLE_EXTENSIONS.has(ext)) {
    return { path, sizeBytes, target: "git", reason: "compressible-type" };
  }
  return { path, sizeBytes, target: "lfs", reason: "unknown-type-size-fallback" };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * One record per path. The on-disk manifest is sorted by normalizedPath,
 * line-oriented, with no global header fields (measured: global fields are
 * what make two-device manifest writes conflict).
 */
export interface ManifestEntry {
  /** Forward-slash, NFC-normalized, lowercased-casing-preserved unique key */
  normalizedPath: string;
  /** Exactly as the user's filesystem spelled it */
  originalPath: string;
  sizeBytes: number;
  sha256: string;
  storage: StorageTarget;
  executable: boolean;
  symlinkTarget?: string;
}

// ---------------------------------------------------------------------------
// Case collisions
// ---------------------------------------------------------------------------

/**
 * A pair of paths differing only in case is legal on case-sensitive
 * filesystems and corrupts every case-insensitive one at checkout. Save must
 * refuse the whole save, naming both files, before anything enters history.
 */
export interface CaseCollision {
  a: string;
  b: string;
}

export function findCaseCollisions(paths: readonly string[]): CaseCollision[] {
  const seen = new Map<string, string>();
  const collisions: CaseCollision[] = [];
  for (const p of [...paths].sort()) {
    const key = p.toLowerCase();
    const prior = seen.get(key);
    if (prior !== undefined && prior !== p) {
      collisions.push({ a: prior, b: p });
    } else {
      seen.set(key, p);
    }
  }
  return collisions;
}

// ---------------------------------------------------------------------------
// Saves, devices, projects
// ---------------------------------------------------------------------------

export type ActorKind = "user" | "agent";
export type CollisionKind =
  | "none"
  | "auto-merged"
  | "text-overlap"
  | "binary-conflict";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Device {
  id: string;
  projectId: string;
  name: string;
  kind: ActorKind;
  createdAt: string;
  /** Last save this device confirmed it holds — basis for sync and truncation safety */
  cursorSaveSeq: number | null;
}

export interface SaveRecord {
  id: string;
  projectId: string;
  seq: number;
  label: string;
  labelSource: ActorKind;
  actorDeviceId: string;
  createdAt: string;
  changedPaths: string[];
  collision?: CollisionKind;
}

// ---------------------------------------------------------------------------
// Save receipts — the structured facts behind every save's label.
//
// The label is the human voice; the receipt is the evidence beneath it:
// who acted and through which tool, what changed in counts, and the few
// paths that matter most. Both the CLI output and dashboard cards render
// from this record.
// ---------------------------------------------------------------------------

export interface SaveCounts {
  added: number;
  changed: number;
  removed: number;
}

/** What a save read looks like over the API. */
export interface SaveReceipt {
  /** Raw client identity from the MCP handshake ("claude-code", "codex").
   *  Null means a person ran the command directly. */
  harness: string | null;
  /** Friendly folder-token name ("Carlos's MacBook"). */
  deviceName: string | null;
  counts: SaveCounts | null;
  topPaths: string[];
}

/**
 * Map an MCP clientInfo.name to the name a person recognizes.
 * Unknown names pass through trimmed; empty stays null.
 */
export function friendlyHarness(name?: string | null): string | null {
  if (!name) return null;
  const n = String(name).toLowerCase();
  const known: Array<[RegExp, string]> = [
    [/claude/, "Claude Code"],
    [/codex/, "Codex"],
    [/cursor/, "Cursor"],
    [/opencode/, "OpenCode"],
    [/gemini/, "Gemini CLI"],
    [/cline/, "Cline"],
    [/windsurf/, "Windsurf"],
    [/vscode/, "VS Code"],
  ];
  for (const [re, label] of known) if (re.test(n)) return label;
  const trimmed = String(name).trim().slice(0, 40);
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : null;
}

// ---------------------------------------------------------------------------
// AI labels
// ---------------------------------------------------------------------------

/**
 * Bounded context sent for label generation. The excerpt is capped
 * client-side (~2000 tokens); media files contribute names and sizes only,
 * never bytes. A failed label must never block the checkpoint.
 */
export interface AiLabelContext {
  /** One-line change stat, e.g. "2 added, 1 modified" */
  summary: string;
  /** Capped text-diff excerpt; empty for pure-media saves */
  excerpt: string;
  /** True when the excerpt was truncated to fit the budget */
  truncated: boolean;
}

export const LABEL_EXCERPT_CHAR_BUDGET = 8000; // ≈2000 tokens at ~4 chars/token

export function fallbackLabel(ctx: AiLabelContext): string {
  return ctx.summary || "Saved changes";
}

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  code:
    | "case-collision"
    | "quota-exceeded"
    | "unauthorized"
    | "project-scope"
    | "conflict"
    | "not-found"
    | "invalid";
  message: string;
  detail?: CaseCollision[] | Record<string, unknown>;
}
