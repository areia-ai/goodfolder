import { git, findGitDir } from "./git.ts";

/**
 * Per-save stage timings. Populated when GOODFOLDER_TRACE=1; rendered as one
 * tidy line at the end of a save so performance work stays observable.
 */
const enabled = (): boolean => process.env.GOODFOLDER_TRACE === "1";
const marks: Array<[string, number]> = [];

export async function trace<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!enabled()) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    marks.push([name, Math.round(performance.now() - t0)]);
  }
}

export function traceSync<T>(name: string, fn: () => T): T {
  if (!enabled()) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    marks.push([name, Math.round(performance.now() - t0)]);
  }
}

export function renderTrace(): string {
  if (!enabled() || marks.length === 0) return "";
  const parts = marks.map(([n, ms]) => `${n} ${ms}ms`);
  const total = marks.reduce((a, [, ms]) => a + ms, 0);
  marks.length = 0; // one line per save, not cumulative
  return `⏱ ${parts.join(" · ")} — total ${total}ms`;
}

/** Copy of current marks without clearing (for programmatic budgets). */
export function snapshotMarks(): Array<[string, number]> {
  return [...marks];
}

/**
 * One-time repo tuning for large folders. Called from bindRepo so every
 * entry path (connect/create/clone) gets it. Safe to call repeatedly.
 *
 *  - core.fsmonitor      builtin fsmonitor daemon: status watches the
 *                        filesystem instead of rescanning 100k paths
 *  - core.untrackedCache remembers what is untracked between runs
 *  - feature.manyFiles   index v4 (prefix compression) + batch updates
 *  - core.preloadIndex   parallel index loading
 */
export function configureRepo(folder: string): void {
  git(folder, ["config", "core.fsmonitor", "true"]);
  git(folder, ["config", "core.untrackedcache", "true"]);
  git(folder, ["config", "feature.manyfiles", "true"]);
  git(folder, ["config", "core.preloadindex", "true"]);
  // A save must never stall on background housekeeping — garbage collection
  // happens explicitly, never mid-checkpoint.
  git(folder, ["config", "gc.auto", "0"]);
  git(folder, ["config", "gc.autodetach", "false"]);
  // Rename detection in status costs a full index-vs-tree walk for zero
  // product value: we count renames as remove+add everywhere.
  git(folder, ["config", "status.renames", "false"]);
  // The daemon persists across saves; starting is idempotent and harmless
  // where unsupported (older git / network filesystems).
  const gitDir = findGitDir(folder);
  if (!gitDir) return;
  git(folder, ["fsmonitor--daemon", "start"]);
}
