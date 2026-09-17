import { findCaseCollisions } from "@goodfolder/shared";
import type { FileChange, RepositoryAdapter, Sql } from "@goodfolder/serverlib";
import { emitWebhookEvent } from "./webhooks.ts";

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
}

export async function loadTimeline(deps: RemoteDeps, projectId: string, limit = 50): Promise<TimelineRow[]> {
  const rows = await deps.sql`
    SELECT s.seq, s.label, s.created_at::text AS "createdAt", s.harness,
           s.commit_sha AS "commitSha", s.added_count AS "addedCount",
           s.changed_count AS "changedCount", s.removed_count AS "removedCount",
           s.top_paths AS "topPaths", d.name AS "deviceName"
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
  | { status: "recorded"; seq: number; label: string; changes: TreeChange[]; counts: SaveCounts }
  | { status: "unchanged"; seq: number; label: string }
  | { status: "refused"; code: string; message: string; httpStatus: number };

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
  });
  return { status: "recorded", seq, label: label.label, changes, counts };
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
  },
): Promise<number> {
  const paths = input.changes.map((change) => change.path).slice(0, RECEIPT_PATH_CAP);
  const topPaths = paths.slice(0, 10);
  const rows = await deps.sql`
    INSERT INTO saves (id, project_id, seq, label, label_source, actor_device_id,
                       changed_paths, commit_sha, added_count, changed_count, removed_count,
                       top_paths, harness)
    SELECT ${crypto.randomUUID()}, ${input.projectId}, COALESCE(MAX(s.seq), 0) + 1,
           ${input.label.slice(0, 120)}, ${input.labelSource}, ${input.actorDeviceId},
           ${deps.sql.json(paths)}, ${input.commitSha}, ${input.counts.added}, ${input.counts.changed}, ${input.counts.removed},
           ${deps.sql.json(topPaths)}, ${input.harness}
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
