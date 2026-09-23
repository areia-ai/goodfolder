/**
 * GoodFolder shared domain types — v0.
 *
 * Everything here reflects settled GoodFolder protocol decisions. Git
 * vocabulary never appears in any type that reaches the user-facing surface.
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
 * First-cut classification lists; tighten them using real corpora. ZIP
 * containers (.docx/.xlsx/.pdf) behave like media.
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
// What a folder holds that isn't the person's work
// ---------------------------------------------------------------------------

/**
 * Why a path is left out of a save. Every category is either something the
 * person's own tools rebuild in seconds, or something that should never be
 * handed to a server at all.
 */
export type SkipCategory = "installed" | "rebuildable" | "credentials" | "noise";

/** Plain language for each category — this is what a person actually reads. */
export const SKIP_CATEGORY_LABEL: Record<SkipCategory, string> = {
  installed: "packages the project downloaded",
  rebuildable: "files the project's own tools rebuild",
  credentials: "files that look like they hold passwords or keys",
  noise: "files the computer writes on its own",
};

export interface SkipRule {
  /**
   * An ignore-file pattern. The engine does the matching — this rule set is
   * never re-implemented as a path matcher here, so what a save leaves out
   * and what GoodFolder reports it left out can never disagree.
   */
  pattern: string;
  category: SkipCategory;
  /**
   * Applied only when this path exists in the folder. `dist`, `build`, `out`
   * and `target` are throwaway output in one folder and someone's real work
   * in another, so evidence on disk decides, never the name alone. A rule
   * with no `needs` is one whose name is unmistakable on its own.
   */
  needs?: string;
}

/**
 * The default skip rules, in the order they are written.
 *
 * The governing principle when adding to this list: **when in doubt,
 * protect**. Skipping something by mistake loses a person's work silently;
 * protecting something by mistake only costs a little space. Anything whose
 * name could plausibly belong to a human-made folder needs a `needs` clause.
 */
export const SKIP_RULES: readonly SkipRule[] = [
  // Downloaded packages — restored by re-running the project's own installer.
  { pattern: "node_modules/", category: "installed" },
  { pattern: "bower_components/", category: "installed" },
  { pattern: ".pnpm-store/", category: "installed" },
  { pattern: ".yarn/cache/", category: "installed" },
  { pattern: ".venv/", category: "installed" },
  { pattern: "venv/", category: "installed", needs: "venv/pyvenv.cfg" },

  // Build output and tool caches.
  { pattern: ".next/", category: "rebuildable" },
  { pattern: ".nuxt/", category: "rebuildable" },
  { pattern: ".svelte-kit/", category: "rebuildable" },
  { pattern: ".astro/", category: "rebuildable" },
  { pattern: ".turbo/", category: "rebuildable" },
  { pattern: ".parcel-cache/", category: "rebuildable" },
  { pattern: ".vite/", category: "rebuildable" },
  { pattern: ".gradle/", category: "rebuildable" },
  { pattern: ".terraform/", category: "rebuildable" },
  { pattern: "__pycache__/", category: "rebuildable" },
  { pattern: "*.pyc", category: "rebuildable" },
  { pattern: "*.pyo", category: "rebuildable" },
  { pattern: ".pytest_cache/", category: "rebuildable" },
  { pattern: ".mypy_cache/", category: "rebuildable" },
  { pattern: ".ruff_cache/", category: "rebuildable" },
  { pattern: "dist/", category: "rebuildable", needs: "package.json" },
  { pattern: "build/", category: "rebuildable", needs: "package.json" },
  { pattern: "out/", category: "rebuildable", needs: "package.json" },
  { pattern: "target/", category: "rebuildable", needs: "Cargo.toml" },

  // Credentials. Never `*.key`: that is a Keynote presentation, and dropping
  // someone's slides to catch a private key would be the worse trade.
  { pattern: ".env", category: "credentials" },
  { pattern: ".env.*", category: "credentials" },
  { pattern: "*.pem", category: "credentials" },
  { pattern: "*.p12", category: "credentials" },
  { pattern: "*.pfx", category: "credentials" },
  { pattern: "*.keystore", category: "credentials" },
  { pattern: "*.jks", category: "credentials" },
  { pattern: "credentials", category: "credentials" },
  { pattern: "id_rsa", category: "credentials" },
  { pattern: "id_dsa", category: "credentials" },
  { pattern: "id_ecdsa", category: "credentials" },
  { pattern: "id_ed25519", category: "credentials" },
  { pattern: ".npmrc", category: "credentials" },

  // What the operating system leaves behind.
  { pattern: ".DS_Store", category: "noise" },
  { pattern: "Thumbs.db", category: "noise" },
  { pattern: "desktop.ini", category: "noise" },
  { pattern: "~$*", category: "noise" },
  { pattern: "npm-debug.log*", category: "noise" },
  { pattern: "yarn-error.log*", category: "noise" },
];

/**
 * Written after every skip pattern, so these win. They match the credential
 * shapes above but hold no secret — they are the template a person commits
 * on purpose so the next person knows which values to fill in.
 */
export const KEEP_PATTERNS: readonly string[] = [
  "!.env.example",
  "!.env.sample",
  "!.env.template",
  "!.env.defaults",
];

/** Pathspecs that find credential-shaped files, for the save-time notice. */
export const CREDENTIAL_PATHSPECS: readonly string[] = SKIP_RULES.filter(
  (r) => r.category === "credentials",
).map((r) => `:(glob)**/${r.pattern}`);

/** Look up which category a pattern belongs to, for explaining a skipped path. */
export function categoryOfPattern(pattern: string): SkipCategory | null {
  return SKIP_RULES.find((r) => r.pattern === pattern)?.category ?? null;
}

/**
 * Which rule caught a path, and why it is left out.
 */
export interface SkipMatch {
  path: string;
  pattern: string;
  category: SkipCategory;
}

/**
 * Ask whether a save would leave one path out.
 *
 * On a person's own computer nothing calls this: `apps/cli` hands the rules
 * to the engine and asks the engine both what a save contains and what it
 * left out, so the two answers come from one place and cannot disagree.
 *
 * A server has no folder to ask. It still has to refuse to take in the very
 * things a save exists to leave out — a dragged-in `.env`, a folder of
 * downloaded packages — so the rules need a reader here too. This is that
 * reader, and it lives beside the rules rather than beside the server, so
 * there is one of it. It answers about a *file* path: a directory rule is
 * matched against the path's folders, never its last segment.
 *
 * `exists` reports whether a path is present at the top of the folder, for
 * the rules that only apply on evidence. `dist` is throwaway output next to
 * a `package.json` and someone's real work without one.
 */
export function skipRuleFor(
  path: string,
  exists: (candidate: string) => boolean,
): SkipMatch | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  for (const keep of KEEP_PATTERNS) {
    if (matchesName(segments, keep.slice(1))) return null;
  }
  for (const rule of SKIP_RULES) {
    if (rule.needs !== undefined && !exists(rule.needs)) continue;
    if (matchesPattern(segments, rule.pattern)) {
      return { path, pattern: rule.pattern, category: rule.category };
    }
  }
  return null;
}

/** A name pattern matches a file or a folder, at any depth. */
function matchesName(segments: readonly string[], glob: string): boolean {
  const re = globToRegExp(glob);
  return segments.some((segment) => re.test(segment));
}

function matchesPattern(segments: readonly string[], pattern: string): boolean {
  const directoryOnly = pattern.endsWith("/");
  const body = directoryOnly ? pattern.slice(0, -1) : pattern;
  if (body.includes("/")) {
    // Written with a slash inside, so it is anchored at the top of the folder.
    const parts = body.split("/");
    if (parts.length > segments.length) return false;
    if (directoryOnly && parts.length === segments.length) return false;
    return parts.every((part, i) => globToRegExp(part).test(segments[i]!));
  }
  // A folder rule never matches the file's own name, only a folder above it.
  const candidates = directoryOnly ? segments.slice(0, -1) : segments;
  return matchesName(candidates, body);
}

const GLOB_CACHE = new Map<string, RegExp>();

/**
 * `*` is the only wildcard the rules use, and it never crosses a `/`.
 * Anything else in a pattern is a literal.
 */
function globToRegExp(glob: string, caseInsensitive = false): RegExp {
  const key = caseInsensitive ? `i${glob}` : glob;
  const cached = GLOB_CACHE.get(key);
  if (cached) return cached;
  const source = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  const re = new RegExp(`^${source}$`, caseInsensitive ? "i" : "");
  GLOB_CACHE.set(key, re);
  return re;
}

/**
 * Every rule, in a shape the reader above understands. A rule that reached
 * for anything more would be matched by the engine on a person's computer
 * and missed by the server, which is the drift these rules exist to prevent.
 * It is checked here, at load, so it cannot be introduced quietly.
 */
for (const pattern of [...SKIP_RULES.map((r) => r.pattern), ...KEEP_PATTERNS]) {
  const body = pattern.replace(/^!/, "").replace(/\/$/, "");
  if (!body || /[?\[\]{}!\\]/.test(body) || body.includes("**")) {
    throw new Error(`skip rule "${pattern}" is not a shape skipRuleFor can match`);
  }
}

// ---------------------------------------------------------------------------
// The warn tier — saved, but named like a secret
// ---------------------------------------------------------------------------

/**
 * A saved file whose name suggests it might hold a secret.
 * `pattern` is the warn pattern that caught it.
 */
export interface WarnMatch {
  path: string;
  pattern: string;
}

/**
 * A warn-tier match tied to what the save did to the file. `change` is
 * absent on saves recorded before the field existed.
 */
export interface SaveWarning extends WarnMatch {
  change: "added" | "changed";
}

/**
 * Would this path have been left out if it had arrived through a save?
 * The one rule the push gate and the post-push screen share: credentials
 * first, then the folder's own ignore list. A hit names what caught it.
 */
export function pushRefusalFor(
  path: string,
  ignorePatterns: readonly string[],
  exists: (p: string) => boolean,
): { kind: "credentials" | "ignored"; pattern: string } | null {
  const skipped = skipRuleFor(path, exists);
  if (skipped && skipped.category === "credentials") {
    return { kind: "credentials", pattern: skipped.pattern };
  }
  const ignored = ignoreRuleFor(path, ignorePatterns);
  if (ignored) return { kind: "ignored", pattern: ignored };
  return null;
}

/**
 * One left-out path, with who asked for it and why, in plain language.
 * `source` is "built-in" for the default rules, "ignore-list" for the
 * folder's own `.goodfolderignore`, and "their-own" for anything the
 * project's other settings exclude.
 */
export interface SkippedEntry {
  path: string;
  source: "built-in" | "ignore-list" | "their-own";
  category?: SkipCategory;
  pattern: string;
  reason: string;
}

/**
 * The most skipped paths a save may report. The server never sees skipped
 * files, so this is the device's own word — capped because it is stored.
 */
export const SKIPPED_REPORT_CAP = 200;

/**
 * Names worth a raised eyebrow, not a refusal. These are deliberately looser
 * than the credential rules above — "Secret Santa.xlsx" warns where `.env`
 * refuses — because a warning costs a line of output and a wrong skip loses
 * someone's work.
 */
export const WARN_PATTERNS: readonly string[] = [
  "*secret*",
  "*password*",
  "*credential*",
  "*.key.*",
];

/**
 * Ask whether a saved path has a name that suggests secrets. Only the last
 * segment is read, case-insensitively, so `Passwords.xlsx` and
 * `Secret Santa.xlsx` warn while `Deck.key` does not. Anything a save would
 * leave out anyway returns null — the skip already said so, louder.
 */
export function warnRuleFor(path: string): WarnMatch | null {
  const last = path.split("/").filter(Boolean).pop();
  if (!last) return null;
  if (skipRuleFor(path, () => false)) return null;
  for (const pattern of WARN_PATTERNS) {
    if (globToRegExp(pattern, true).test(last)) return { path, pattern };
  }
  return null;
}

// ---------------------------------------------------------------------------
// A folder's own ignore list
// ---------------------------------------------------------------------------

/**
 * The file a person (or `goodfolder ignore`) writes to leave more things
 * out. It lives in the folder itself, so it syncs to every device — the one
 * list that is deliberately not managed per-machine.
 */
export const IGNORE_FILE = ".goodfolderignore";

/**
 * Check one line of the ignore file. Answers a plain-language reason it
 * cannot be used, or null when it can. The limits are the same ones
 * SKIP_RULES keep: `*` is the only wildcard, so the engine and this reader
 * can never disagree about what a line means.
 */
export function validateIgnorePattern(pattern: string): string | null {
  const p = pattern.trim();
  if (!p) return "is empty";
  if (p.startsWith("#")) return "is a comment, not a pattern";
  if (p.startsWith("!")) return "starts with ! — this list can't carry exceptions";
  if (p.startsWith("/")) return "starts with / — write it relative to the top of the folder";
  const body = p.endsWith("/") ? p.slice(0, -1) : p;
  if (!body) return "is only a slash";
  if (body.includes("**")) return "uses ** — the only wildcard here is *";
  const bad = /[?[\]{}\\]/.exec(body);
  if (bad) return `uses "${bad[0]}" — the only wildcard here is *`;
  if (body.split("/").some((part) => !part)) return "has an empty part — write it with single slashes";
  // The list must never switch itself off: a pattern that matched this file
  // would hide the very list that produced it.
  if (matchesPattern([IGNORE_FILE], p)) return `would leave out ${IGNORE_FILE} itself`;
  return null;
}

/**
 * Read an ignore file's text into the lines that count. Blank lines and
 * `#` comments are skipped, repeats collapse to one, and each unusable line
 * is reported with where it was so both the command line and the server can
 * say so — and ignore it identically.
 */
export function parseIgnoreFile(text: string): {
  patterns: string[];
  invalid: Array<{ line: number; text: string; reason: string }>;
} {
  const patterns: string[] = [];
  const invalid: Array<{ line: number; text: string; reason: string }> = [];
  const seen = new Set<string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    const reason = validateIgnorePattern(line);
    if (reason !== null) {
      invalid.push({ line: i + 1, text: line, reason });
      continue;
    }
    if (seen.has(line)) continue;
    seen.add(line);
    patterns.push(line);
  }
  return { patterns, invalid };
}

/**
 * Which line of a folder's ignore list caught a path — the last one that
 * matches, same as the engine's own order. Answers the pattern text, or
 * null. Matching is exactly the one `matchesPattern` the skip rules use, so
 * the two readers can never drift.
 */
export function ignoreRuleFor(path: string, patterns: readonly string[]): string | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  let winner: string | null = null;
  for (const pattern of patterns) {
    if (matchesPattern(segments, pattern)) winner = pattern;
  }
  return winner;
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
