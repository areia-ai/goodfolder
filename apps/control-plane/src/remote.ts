import {
  findCaseCollisions,
  IGNORE_FILE,
  ignoreRuleFor,
  parseIgnoreFile,
  pushRefusalFor,
  SKIP_CATEGORY_LABEL,
  SKIP_RULES,
  SKIPPED_REPORT_CAP,
  skipRuleFor,
  WARN_PATTERNS,
  warnRuleFor,
  type SaveWarning,
  type SkipCategory,
  type SkippedEntry,
  type WarnMatch,
} from "@goodfolder/shared";
import type { FileChange, RepositoryAdapter, Sql } from "@goodfolder/serverlib";
import { emitWebhookEvent } from "./webhooks.ts";

/** The shape postgres.js accepts for a jsonb parameter, borrowed from it. */
type JsonParameter = Parameters<Sql["json"]>[0];
export const asJson = (value: unknown): JsonParameter => value as JsonParameter;

/**
 * What a service on the other side of the internet can do to a folder.
 *
 * A hosted assistant has no folder on disk, so the verbs that were local —
 * save, restore, undo — become operations on the folder's history: read
 * what stands where, bring the whole tree back to an earlier save as a NEW
 * save, and record a save for what a transport write just landed. Nothing
 * here ever rewrites history; the strongest thing available is a save that
 * puts the tree back the way an earlier one had it.
 *
 * The same functions answer the REST routes and the hosted tool surface, so
 * scope enforcement and billing checks cannot drift between the two.
 */

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size: number;
  sha: string;
}

export interface TreeChange {
  path: string;
  kind: "added" | "changed" | "removed";
  size: number;
}

export interface SaveCounts {
  added: number;
  changed: number;
  removed: number;
}

export function countsOf(changes: readonly TreeChange[]): SaveCounts {
  return {
    added: changes.filter((c) => c.kind === "added").length,
    changed: changes.filter((c) => c.kind === "changed").length,
    removed: changes.filter((c) => c.kind === "removed").length,
  };
}

/**
 * What changed between where the folder stands (`from`) and where it should
 * stand (`to`). Paths only, shas for the compare — never file contents.
 */
export function treeChanges(from: readonly TreeEntry[], to: readonly TreeEntry[]): TreeChange[] {
  const before = new Map(from.filter((e) => e.type === "blob").map((e) => [e.path, e]));
  const after = new Map(to.filter((e) => e.type === "blob").map((e) => [e.path, e]));
  const changes: TreeChange[] = [];
  for (const [path, entry] of after) {
    const had = before.get(path);
    if (!had) changes.push({ path, kind: "added", size: entry.size });
    else if (had.sha !== entry.sha) changes.push({ path, kind: "changed", size: entry.size });
  }
  for (const [path, entry] of before) {
    if (!after.has(path)) changes.push({ path, kind: "removed", size: entry.size });
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return changes;
}

/** How much a single remote revert may carry before it asks for a device. */
export const REMOTE_REVERT_FILE_CAP = 2_000;
export const REMOTE_REVERT_BYTE_CAP = 200 * 1024 * 1024;
/** Bounds the receipt stored with a save; the timeline reads at most this. */
export const RECEIPT_PATH_CAP = 5_000;

export interface RemoteCaller {
  kind: "account" | "service";
  accountId: string;
  email: string;
  /** The folder a service key is bound to, or null for the whole account. */
  boundProjectId: string | null;
  /** The service's name, used as the runner on receipts. */
  serviceName?: string;
  /** The service credential's id, when the caller is one. */
  credentialId?: string;
}

export interface RemoteDeps {
  sql: Sql;
  repos: RepositoryAdapter;
  /** The same gate every other write passes: null means allowed. */
  writeAccessError: (accountId: string) => Promise<{ code: string; message: string; status: number } | null>;
  refreshUsage: (projectId: string) => void;
  labelFor: (
    ai: { summary: string; excerpt: string; truncated: boolean } | undefined,
    userLabel?: string,
  ) => Promise<{ label: string; source: "user" | "agent" }>;
}

export interface FolderSummary {
  id: string;
  name: string;
  role: "owner" | "contributor";
  lastSeq: number | null;
  lastSaveAt: string | null;
}

/** The folders this caller may see, newest first. */
export async function listFolders(deps: RemoteDeps, caller: RemoteCaller): Promise<FolderSummary[]> {
  const rows = await deps.sql`
    SELECT p.id, p.name,
           p.created_at::text AS "createdAt",
           (SELECT MAX(s.seq)::int FROM saves s WHERE s.project_id = p.id) AS "lastSeq",
           (SELECT MAX(s.created_at)::text FROM saves s WHERE s.project_id = p.id) AS "lastSaveAt",
           CASE WHEN p.account_id = ${caller.accountId} THEN 'owner' ELSE 'contributor' END AS role
    FROM projects p
    WHERE p.account_id = ${caller.accountId}
      AND (${caller.boundProjectId}::uuid IS NULL OR p.id = ${caller.boundProjectId}::uuid)
    ORDER BY p.created_at DESC LIMIT 200`;
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    role: "owner",
    lastSeq: row.lastSeq === null || row.lastSeq === undefined ? null : Number(row.lastSeq),
    lastSaveAt: row.lastSaveAt ? String(row.lastSaveAt) : null,
  }));
}

export type FolderLookup =
  | { kind: "one"; id: string; name: string }
  | { kind: "many"; folders: Array<{ id: string; name: string }> }
  | null;

/**
 * A folder by id or by the name someone typed. Names are not unique, so an
 * answer that would have to guess comes back as the list to choose from.
 */
export async function findFolder(
  deps: RemoteDeps,
  caller: RemoteCaller,
  query: string,
): Promise<FolderLookup> {
  const value = query.trim().slice(0, 120);
  if (!value) return null;
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const rows = byId
    ? await deps.sql`
        SELECT id, name FROM projects
        WHERE account_id = ${caller.accountId}
          AND (${caller.boundProjectId}::uuid IS NULL OR id = ${caller.boundProjectId}::uuid)
          AND id = ${value}
        LIMIT 25`
    : await deps.sql`
        SELECT id, name FROM projects
        WHERE account_id = ${caller.accountId}
          AND (${caller.boundProjectId}::uuid IS NULL OR id = ${caller.boundProjectId}::uuid)
          AND lower(name) = lower(${value})
        ORDER BY created_at ASC LIMIT 25`;
  if (rows.length === 0) return null;
  if (rows.length === 1 || byId) return { kind: "one", id: String(rows[0]!.id), name: String(rows[0]!.name) };
  return {
    kind: "many",
    folders: rows.map((row) => ({ id: String(row.id), name: String(row.name) })),
  };
}

export interface TimelineRow {
  seq: number;
  label: string;
  createdAt: string;
  harness: string | null;
  deviceName: string | null;
  commitSha: string;
  addedCount: number;
  changedCount: number;
  removedCount: number;
  topPaths: string[];
  /** `change` is absent on warnings recorded before that field existed. */
  warnings: Array<WarnMatch & { change?: "added" | "changed" }>;
  /** What the device reported leaving out; [] when nothing was reported. */
  skipped: SkippedEntry[];
  skippedTotal: number;
  /** "device" when the save carried the device's left-out report. */
  skippedReportedBy: "device" | null;
}

export async function loadTimeline(deps: RemoteDeps, projectId: string, limit = 50): Promise<TimelineRow[]> {
  const rows = await deps.sql`
    SELECT s.seq, s.label, s.created_at::text AS "createdAt", s.harness,
           s.commit_sha AS "commitSha", s.added_count AS "addedCount",
           s.changed_count AS "changedCount", s.removed_count AS "removedCount",
           s.top_paths AS "topPaths", s.warnings,
           s.skipped, s.skipped_total AS "skippedTotal", d.name AS "deviceName"
    FROM saves s LEFT JOIN devices d ON d.id = s.actor_device_id
    WHERE s.project_id = ${projectId}
    ORDER BY s.seq DESC LIMIT ${limit}`;
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    seq: Number(row.seq),
    label: String(row.label),
    createdAt: String(row.createdAt),
    harness: row.harness ? String(row.harness) : null,
    deviceName: row.deviceName ? String(row.deviceName) : null,
    commitSha: String(row.commitSha),
    addedCount: Number(row.addedCount ?? 0),
    changedCount: Number(row.changedCount ?? 0),
    removedCount: Number(row.removedCount ?? 0),
    topPaths: Array.isArray(row.topPaths) ? (row.topPaths as string[]) : [],
    warnings: Array.isArray(row.warnings)
      ? (row.warnings as Array<WarnMatch & { change?: "added" | "changed" }>)
      : [],
    skipped: Array.isArray(row.skipped) ? (row.skipped as SkippedEntry[]) : [],
    skippedTotal: Number(row.skippedTotal ?? 0),
    skippedReportedBy: row.skipped === null || row.skipped === undefined ? null : "device",
  }));
}

export async function headOf(deps: RemoteDeps, projectId: string): Promise<string | null> {
  return deps.repos.head(projectId);
}

export async function loadSave(
  deps: RemoteDeps,
  projectId: string,
  seq: number,
): Promise<{ seq: number; label: string; commitSha: string } | null> {
  const rows = await deps.sql`
    SELECT seq, label, commit_sha AS "commitSha" FROM saves
    WHERE project_id = ${projectId} AND seq = ${seq} LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  return { seq: Number(row.seq), label: String(row.label), commitSha: String(row.commitSha) };
}

export async function latestSave(deps: RemoteDeps, projectId: string): Promise<{ seq: number; label: string; commitSha: string } | null> {
  const rows = await deps.sql`
    SELECT seq, label, commit_sha AS "commitSha" FROM saves
    WHERE project_id = ${projectId} ORDER BY seq DESC LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  return { seq: Number(row.seq), label: String(row.label), commitSha: String(row.commitSha) };
}

/**
 * How many saves at the top are one uninterrupted run of the same runner.
 * Mirrors what undo does on a computer: the last save alone, or the string
 * of saves that share its runner. Never the whole timeline — undo must
 * leave an earlier state to return to.
 */
export function runnerRun(
  saves: ReadonlyArray<Pick<TimelineRow, "harness">>,
): number {
  const top = saves[0]?.harness;
  if (!top || saves.length < 2) return 1;
  let n = 1;
  while (n < saves.length - 1 && saves[n]?.harness === top) n++;
  return n;
}

export type RevertOutcome =
  | { status: "applied"; seq: number; label: string; head: string; changes: TreeChange[]; counts: SaveCounts }
  | { status: "unchanged"; seq: number }
  | { status: "refused"; code: string; message: string; httpStatus: number };

export interface RevertTarget {
  seq: number;
  label: string;
  commitSha: string;
}

/** Everything a revert would do, without doing any of it. */
export async function previewRevert(
  deps: RemoteDeps,
  projectId: string,
  target: RevertTarget,
): Promise<
  | { status: "preview"; changes: TreeChange[]; counts: SaveCounts; collisions: Array<{ a: string; b: string }>; target: RevertTarget }
  | { status: "unchanged"; target: RevertTarget; changes: [] }
> {
  const head = await deps.repos.head(projectId);
  const [headTree, targetTree] = await Promise.all([
    deps.repos.tree(projectId),
    deps.repos.tree(projectId, target.commitSha),
  ]);
  if (head === target.commitSha) {
    return { status: "unchanged", target, changes: [] };
  }
  const changes = treeChanges(headTree, targetTree);
  const collisions = findCaseCollisions(
    targetTree.filter((e) => e.type === "blob").map((e) => e.path),
  ).map(({ a, b }) => ({ a, b }));
  return { status: "preview", changes, counts: countsOf(changes), collisions, target };
}

/**
 * Put the whole tree back the way an earlier save had it, as a new save.
 * Refuses rather than guesses when a remote revert would be enormous — a
 * device holding the folder does that work better.
 */
export async function applyRevert(
  deps: RemoteDeps,
  input: {
    projectId: string;
    accountId: string;
    actorDeviceId: string;
    actorName: string;
    target: RevertTarget;
    label: string;
    harness: string | null;
    /**
     * The change the save receipt should describe, when the caller already
     * looked (the undo preview). Recomputed when absent.
     */
    changes?: TreeChange[];
  },
): Promise<RevertOutcome> {
  const denied = await deps.writeAccessError(input.accountId);
  if (denied) {
    return { status: "refused", code: denied.code, message: denied.message, httpStatus: denied.status };
  }
  const preview = input.changes
    ? null
    : await previewRevert(deps, input.projectId, input.target);
  if (preview && preview.status === "unchanged") {
    const latest = await latestSave(deps, input.projectId);
    return { status: "unchanged", seq: latest?.seq ?? 0 };
  }
  const changes = input.changes ?? preview!.changes;
  if (changes.length === 0) {
    const latest = await latestSave(deps, input.projectId);
    return { status: "unchanged", seq: latest?.seq ?? 0 };
  }
  const bytes = changes.reduce((sum, change) => sum + change.size, 0);
  if (changes.length > REMOTE_REVERT_FILE_CAP || bytes > REMOTE_REVERT_BYTE_CAP) {
    return {
      status: "refused",
      code: "too-large",
      message:
        "That would move too many files for a remote restore. Run it on a computer that holds the folder instead.",
      httpStatus: 413,
    };
  }
  const collisions = findCaseCollisions(
    (await deps.repos.tree(input.projectId, input.target.commitSha))
      .filter((e) => e.type === "blob")
      .map((e) => e.path),
  );
  if (collisions.length > 0) {
    return {
      status: "refused",
      code: "name-collision",
      message: collided(collisions[0]!.a, collisions[0]!.b),
      httpStatus: 409,
    };
  }

  const changesForEngine: FileChange[] = [];
  for (const change of changes) {
    if (change.kind === "removed") {
      changesForEngine.push({ operation: "remove", path: change.path });
      continue;
    }
    const file = await deps.repos.readFile(input.projectId, change.path, input.target.commitSha);
    if (!file) {
      return {
        status: "refused",
        code: "not-found",
        message: `“${change.path}” could not be read from that save. Nothing was changed.`,
        httpStatus: 404,
      };
    }
    changesForEngine.push({ operation: "write", path: change.path, content: file.content });
  }

  const head = await deps.repos.head(input.projectId);
  let written: { commitSha: string };
  try {
    written = await deps.repos.changeFiles({
      projectId: input.projectId,
      changes: changesForEngine,
      message: input.label.slice(0, 80),
      expectedHead: head,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "newer-work") {
      return {
        status: "refused",
        code: "newer-work",
        message: "Newer work arrived while this was being prepared. Look at the latest save and try again.",
        httpStatus: 409,
      };
    }
    throw error;
  }
  const counts = countsOf(changes);
  const seq = await recordSaveRow(deps, {
    projectId: input.projectId,
    accountId: input.accountId,
    actorDeviceId: input.actorDeviceId,
    actorName: input.actorName,
    label: input.label,
    labelSource: "user",
    commitSha: written.commitSha,
    changes,
    counts,
    harness: input.harness,
  });
  return { status: "applied", seq, label: input.label, head: written.commitSha, changes, counts };
}

export type RecordOutcome =
  | { status: "recorded"; seq: number; label: string; changes: TreeChange[]; counts: SaveCounts; warnings: SaveWarning[]; flagged: FlaggedPath[]; skipped: SkippedEntry[]; skippedTotal: number; skippedReportedBy: "device" | null }
  | { status: "unchanged"; seq: number; label: string }
  | { status: "refused"; code: string; message: string; httpStatus: number };

/**
 * An added path a save should never have carried: shaped like a credential,
 * or on the folder's own ignore list. `deliberate` means the device said it
 * was included on purpose (a `protect`), which is informational — the flag
 * is raised either way, because the device is not the only writer.
 */
export interface FlaggedPath {
  path: string;
  pattern: string;
  kind: "credentials" | "ignored";
  deliberate: boolean;
}

export interface SaveScreening {
  warnings: SaveWarning[];
  flagged: FlaggedPath[];
}

/**
 * Screen what a save did to the paths it touched. The warn tier covers
 * ADDED and CHANGED paths — a secret-named file that changes is news again
 * — while the flag tier stays added-only: a changed file was let in by an
 * earlier decision. Removed paths are never evaluated. Pure: the caller
 * supplies the new tree's path set and the parsed ignore list, so this is
 * the same check a folder-token save and a service save both run.
 */
export function screenSaveChanges(
  changes: readonly Pick<TreeChange, "path" | "kind">[],
  input: {
    /** Every blob path in the new tree (for evidence-gated rules). */
    presentInTree: ReadonlySet<string>;
    ignorePatterns: readonly string[];
    includedOnPurpose: readonly string[];
  },
): SaveScreening {
  const deliberate = new Set(input.includedOnPurpose);
  const warnings: SaveWarning[] = [];
  const flagged: FlaggedPath[] = [];
  for (const change of changes) {
    if (change.kind === "removed") continue;
    const warn = warnRuleFor(change.path);
    if (warn) warnings.push({ ...warn, change: change.kind });
    if (change.kind !== "added") continue;
    const refusal = pushRefusalFor(change.path, input.ignorePatterns, (candidate) =>
      input.presentInTree.has(candidate),
    );
    if (refusal) {
      flagged.push({ path: change.path, pattern: refusal.pattern, kind: refusal.kind, deliberate: deliberate.has(change.path) });
    }
  }
  return { warnings, flagged };
}

const SKIPPED_SOURCES = new Set<SkippedEntry["source"]>(["built-in", "ignore-list", "their-own"]);

/**
 * Read the device's left-out report out of a save request body. The server
 * never sees the files themselves — the device is the only witness — so this
 * is sanitized and stored, never trusted for enforcement. Null means the
 * body carried no report at all (an older client, a browser save).
 */
export function readSkippedReport(
  body: unknown,
): { entries: SkippedEntry[]; total: number } | null {
  if (typeof body !== "object" || body === null) return null;
  const skipped = (body as { skipped?: unknown }).skipped;
  if (!Array.isArray(skipped)) return null;
  const entries: SkippedEntry[] = [];
  for (const item of skipped.slice(0, SKIPPED_REPORT_CAP)) {
    if (typeof item !== "object" || item === null) continue;
    const { path, source, category, pattern, reason } = item as Record<string, unknown>;
    if (typeof path !== "string" || path.length === 0) continue;
    if (!SKIPPED_SOURCES.has(source as SkippedEntry["source"])) continue;
    const entry: SkippedEntry = {
      path: path.slice(0, 512),
      source: source as SkippedEntry["source"],
      pattern: typeof pattern === "string" ? pattern.slice(0, 200) : "",
      reason: typeof reason === "string" ? reason.slice(0, 200) : "",
    };
    if (typeof category === "string" && category in SKIP_CATEGORY_LABEL) {
      entry.category = category as SkipCategory;
    }
    entries.push(entry);
  }
  const rawTotal = Math.floor(Number((body as { skippedTotal?: unknown }).skippedTotal)) || 0;
  const total = Math.max(entries.length, Math.min(10_000_000, rawTotal));
  return { entries, total };
}

/**
 * Raise the alarm for a save that carried paths it should have left out.
 * Never fails the save — it is an audit row, a loud server log, and a
 * webhook, in that order of importance.
 */
export async function reportFlaggedSave(
  deps: RemoteDeps,
  input: {
    projectId: string;
    accountId: string;
    /** Null when the alarm follows a push that was never recorded as a save. */
    seq: number | null;
    /** The head the push landed, when known. */
    head?: string;
    actor: string;
    flagged: FlaggedPath[];
    /** The gate posture the push went through, for the alarm's detail. */
    gate?: "enforce" | "observe" | "off" | null;
    /** The gate's would-refusal id, when observe mode noted one. */
    refusalId?: string | null;
  },
): Promise<void> {
  if (input.flagged.length === 0) return;
  try {
    await deps.sql`
      INSERT INTO audit_log (actor, action, detail)
      VALUES (${input.actor}, 'save.flagged', ${deps.sql.json(asJson({
        projectId: input.projectId,
        seq: input.seq,
        head: input.head ?? null,
        gate: input.gate ?? null,
        refusalId: input.refusalId ?? null,
        flagged: input.flagged,
      }))})`;
  } catch (error) {
    console.error("save.flagged audit row failed:", error);
  }
  const what = input.seq !== null ? `save #${input.seq}` : "a push";
  console.error(
    `⚠ ${what} in folder ${input.projectId} added files GoodFolder leaves out by default: ` +
      input.flagged.map((f) => `${f.path} (${f.kind}: ${f.pattern})`).join(", "),
  );
  void emitWebhookEvent(deps.sql, {
    accountId: input.accountId,
    projectId: input.projectId,
    event: "save.flagged",
    data: {
      seq: input.seq,
      head: input.head ?? null,
      gate: input.gate ?? null,
      refusalId: input.refusalId ?? null,
      flagged: input.flagged,
    },
  }).catch(() => {});
}

/**
 * Screen what a push actually landed. Runs after the transport answer has
 * been relayed, so it never delays or changes what the client sees — and
 * it catches the bypass that matters: a push that is never recorded as a
 * save. Anything failing inside is logged, never thrown.
 */
export async function screenLandedPush(
  deps: RemoteDeps,
  input: {
    projectId: string;
    accountId: string;
    /** The head before the push; null when there was none or it was unreadable. */
    before: string | null;
    actor: string;
    /** The gate posture the push went through — reported with the alarm. */
    gate?: "enforce" | "observe" | "off";
    /** The gate's would-refusal id, when observe mode noted one. */
    refusalId?: string | null;
    /** Paths the pusher deliberately included (device credentials only). */
    includedOnPurpose?: readonly string[];
  },
): Promise<void> {
  try {
    const after = await deps.repos.head(input.projectId);
    if (!after || after === input.before) return;
    const newTree = await deps.repos.tree(input.projectId, after);
    const baseTree = input.before ? await deps.repos.tree(input.projectId, input.before) : [];
    const changes = treeChanges(baseTree, newTree);
    // Only additions can flag — the flag tier never re-judges a changed file.
    if (!changes.some((c) => c.kind === "added")) return;
    const ignorePatterns = await ignorePatternsAt(deps, input.projectId, newTree, after);
    const screening = screenSaveChanges(changes, {
      presentInTree: new Set(newTree.filter((e) => e.type === "blob").map((e) => e.path)),
      ignorePatterns,
      includedOnPurpose: input.includedOnPurpose ?? [],
    });
    if (screening.flagged.length && input.gate === "enforce") {
      console.error(
        `gate miss: a push through the enforcing gate still landed flagged files in ${input.projectId}: ` +
          screening.flagged.map((f) => `${f.path} (${f.kind}: ${f.pattern})`).join(", "),
      );
    }
    await reportFlaggedSave(deps, {
      projectId: input.projectId,
      accountId: input.accountId,
      seq: null,
      head: after,
      actor: input.actor,
      flagged: screening.flagged,
      gate: input.gate ?? null,
      refusalId: input.refusalId ?? null,
    });
  } catch (error) {
    console.error("post-push screen failed:", error);
  }
}

/**
 * Read the ignore list a tree carries. Missing file, unreadable tree —
 * anything — answers an absent list rather than failing the save.
 */
async function ignoreFileAt(
  deps: RemoteDeps,
  projectId: string,
  tree: readonly TreeEntry[],
  ref: string,
): Promise<{
  present: boolean;
  patterns: string[];
  invalid: Array<{ line: number; text: string; reason: string }>;
}> {
  if (!tree.some((e) => e.type === "blob" && e.path === IGNORE_FILE)) {
    return { present: false, patterns: [], invalid: [] };
  }
  const file = await deps.repos.readFile(projectId, IGNORE_FILE, ref);
  if (!file) return { present: false, patterns: [], invalid: [] };
  const parsed = parseIgnoreFile(file.content.toString("utf8"));
  return { present: true, patterns: parsed.patterns, invalid: parsed.invalid };
}

export async function ignorePatternsAt(
  deps: RemoteDeps,
  projectId: string,
  tree: readonly TreeEntry[],
  ref: string,
): Promise<string[]> {
  return (await ignoreFileAt(deps, projectId, tree, ref)).patterns;
}

/**
 * The leave-out rules a folder stands under, as the server sees them: the
 * built-in rules, the warn tier, and the folder's own `.goodfolderignore`
 * read at the current head. A device's own per-computer settings are the
 * one source the server cannot see — `deviceOnly` says so.
 */
export async function exclusionsFor(
  deps: RemoteDeps,
  projectId: string,
): Promise<{
  at: string | null;
  ignoreFile: {
    present: boolean;
    patterns: string[];
    invalid: Array<{ line: number; text: string; reason: string }>;
  };
  builtIn: {
    skip: Array<{ pattern: string; category: SkipCategory; label: string; needs?: string }>;
    warn: string[];
  };
  deviceOnly: string;
}> {
  const head = await deps.repos.head(projectId);
  const ignoreFile = head
    ? await ignoreFileAt(deps, projectId, await deps.repos.tree(projectId, head), head)
    : { present: false, patterns: [], invalid: [] };
  return {
    at: head,
    ignoreFile,
    builtIn: {
      skip: SKIP_RULES.map((rule) => ({
        pattern: rule.pattern,
        category: rule.category,
        label: SKIP_CATEGORY_LABEL[rule.category],
        ...(rule.needs !== undefined ? { needs: rule.needs } : {}),
      })),
      warn: [...WARN_PATTERNS],
    },
    deviceOnly:
      'A device can also leave out files through the project\'s own settings on that computer; those aren\'t listed here, and appear in a save\'s skipped list with source "their-own".',
  };
}

/**
 * Record a save for whatever state the folder stands in now. This is what a
 * service calls after a transport write landed: the receipt is computed
 * from the tree the write produced against the last recorded save, so the
 * timeline describes the change without the service sending a file list.
 */
export async function recordRemoteSave(
  deps: RemoteDeps,
  input: {
    projectId: string;
    accountId: string;
    actorDeviceId: string;
    actorName: string;
    label?: string;
    harness: string | null;
    /** For account callers that produce their own label upstream. */
    labelOverride?: { label: string; source: "user" | "agent" };
    /**
     * The state the caller believes it just wrote. When present and the
     * folder stands somewhere else, nothing is recorded — the caller is
     * looking at a stale picture.
     */
    expectedHead?: string | null;
    /** Paths the device deliberately protected despite the defaults. */
    includedOnPurpose?: string[];
    /** The device's left-out report, already sanitized by the caller. */
    skippedReport?: { entries: SkippedEntry[]; total: number } | null;
  },
): Promise<RecordOutcome> {
  const denied = await deps.writeAccessError(input.accountId);
  if (denied) {
    return { status: "refused", code: denied.code, message: denied.message, httpStatus: denied.status };
  }
  const head = await deps.repos.head(input.projectId);
  if (!head) return { status: "unchanged", seq: 0, label: "Nothing has been saved yet." };
  if (input.expectedHead && input.expectedHead !== head) {
    return {
      status: "refused",
      code: "newer-work",
      message: "The folder stands somewhere else than the change you described. Look at the latest save and try again.",
      httpStatus: 409,
    };
  }
  const latest = await latestSave(deps, input.projectId);
  if (latest && latest.commitSha === head) {
    return { status: "unchanged", seq: latest.seq, label: latest.label };
  }
  const headTree = await deps.repos.tree(input.projectId);
  const baseTree = latest ? await deps.repos.tree(input.projectId, latest.commitSha) : [];
  const changes = treeChanges(baseTree, headTree);
  const counts = countsOf(changes);
  if (changes.length === 0) {
    return { status: "unchanged", seq: latest?.seq ?? 0, label: latest?.label ?? "Nothing has been saved yet." };
  }
  // What the save changed is read from the trees themselves — the caller's
  // own list is not trusted to describe what landed.
  let screening: SaveScreening = { warnings: [], flagged: [] };
  try {
    const present = new Set(headTree.filter((e) => e.type === "blob").map((e) => e.path));
    const ignorePatterns = await ignorePatternsAt(deps, input.projectId, headTree, head);
    screening = screenSaveChanges(
      changes,
      { presentInTree: present, ignorePatterns, includedOnPurpose: input.includedOnPurpose ?? [] },
    );
  } catch (error) {
    console.error("save screening failed; recording without it:", error);
  }
  const label =
    input.labelOverride ??
    (await deps.labelFor(
      {
        summary: `${counts.added} added, ${counts.changed} changed, ${counts.removed} removed`,
        excerpt: headTree
          .filter((e) => e.type === "blob")
          .slice(0, 40)
          .map((e) => e.path)
          .join("\n"),
        truncated: headTree.length > 40,
      },
      input.label,
    ));
  const seq = await recordSaveRow(deps, {
    projectId: input.projectId,
    accountId: input.accountId,
    actorDeviceId: input.actorDeviceId,
    actorName: input.actorName,
    label: label.label,
    labelSource: label.source,
    commitSha: head,
    changes,
    counts,
    harness: input.harness,
    warnings: screening.warnings,
    skippedReport: input.skippedReport,
  });
  // The alarm itself is raised where the push lands (screenLandedPush), so
  // a push that is never recorded still fires it.
  return { status: "recorded", seq, label: label.label, changes, counts, warnings: screening.warnings, flagged: screening.flagged,
    skipped: input.skippedReport?.entries ?? [],
    skippedTotal: input.skippedReport?.total ?? 0,
    skippedReportedBy: input.skippedReport ? "device" : null };
}

async function recordSaveRow(
  deps: RemoteDeps,
  input: {
    projectId: string;
    accountId: string;
    actorDeviceId: string;
    actorName: string;
    label: string;
    labelSource: "user" | "agent";
    commitSha: string;
    changes: TreeChange[];
    counts: SaveCounts;
    harness: string | null;
    warnings?: SaveWarning[];
    /** The device's left-out report; absent or null means the save carried none. */
    skippedReport?: { entries: SkippedEntry[]; total: number } | null | undefined;
  },
): Promise<number> {
  const paths = input.changes.map((change) => change.path).slice(0, RECEIPT_PATH_CAP);
  const topPaths = paths.slice(0, 10);
  const rows = await deps.sql`
    INSERT INTO saves (id, project_id, seq, label, label_source, actor_device_id,
                       changed_paths, commit_sha, added_count, changed_count, removed_count,
                       top_paths, harness, warnings, skipped, skipped_total)
    SELECT ${crypto.randomUUID()}, ${input.projectId}, COALESCE(MAX(s.seq), 0) + 1,
           ${input.label.slice(0, 120)}, ${input.labelSource}, ${input.actorDeviceId},
           ${deps.sql.json(paths)}, ${input.commitSha}, ${input.counts.added}, ${input.counts.changed}, ${input.counts.removed},
           ${deps.sql.json(topPaths)}, ${input.harness}, ${deps.sql.json(asJson(input.warnings ?? []))},
           ${input.skippedReport ? deps.sql.json(asJson(input.skippedReport.entries)) : null},
           ${input.skippedReport ? input.skippedReport.total : null}
    FROM saves s WHERE s.project_id = ${input.projectId}
    RETURNING seq`;
  const seq = Number(rows[0]!.seq);
  await deps.sql`UPDATE devices SET cursor_save_seq = ${seq} WHERE id = ${input.actorDeviceId}`;
  deps.refreshUsage(input.projectId);
  void emitWebhookEvent(deps.sql, {
    accountId: input.accountId,
    projectId: input.projectId,
    event: "save.created",
    data: {
      seq,
      label: input.label,
      runner: input.actorName,
      harness: input.harness,
      added: input.counts.added,
      changed: input.counts.changed,
      removed: input.counts.removed,
    },
  }).catch(() => {});
  return seq;
}

function collided(a: string, b: string): string {
  return `“${a}” is too similar to “${b}”. Choose a different name.`;
}
