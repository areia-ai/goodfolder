import { DEFAULT_API_URL, saveConfig, withCredentials, type FolderConfig } from "./config.ts";
import { git, type GitResult } from "./git.ts";
import { configureRepo } from "./perf.ts";
import { applySkipRules } from "./skip.ts";

/**
 * The name GoodFolder gives its own transport entry.
 *
 * It is deliberately not the default name. A folder holding code usually
 * already has one of these pointing somewhere the person chose, and taking
 * that name would silently redirect their existing setup at GoodFolder. Using
 * our own name means both work side by side, and a folder GoodFolder set up
 * itself leaves the default name free for whatever the person adds later.
 */
export const GF_REMOTE = "goodfolder";

const DEFAULT_SAVE_AUTHOR = "GoodFolder";
const DEFAULT_SAVE_EMAIL = "goodfolder@local";

/**
 * A cloned folder can land on a minimal agent or container with no machine
 * author configured. Give that folder a safe local fallback, but leave any
 * existing person or machine identity alone.
 */
export function ensureSaveAuthor(folder: string): void {
  const name = git(folder, ["config", "--get", "user.name"]);
  if (name.code !== 0 || !name.stdout.trim()) {
    git(folder, ["config", "user.name", DEFAULT_SAVE_AUTHOR]);
  }

  const email = git(folder, ["config", "--get", "user.email"]);
  if (email.code !== 0 || !email.stdout.trim()) {
    git(folder, ["config", "user.email", DEFAULT_SAVE_EMAIL]);
  }
}

/**
 * Upload the currently checked-out work as GoodFolder's canonical history.
 *
 * A folder may already be managed by another tool on a branch with any name.
 * Naming the local branch here made the first Save fail for those folders and
 * tempted callers to rename a branch that belongs to the person. A refspec
 * keeps the local branch untouched while giving GoodFolder its stable remote
 * name.
 */
export function pushCurrentHistory(folder: string): GitResult {
  return git(folder, ["push", GF_REMOTE, "HEAD:main"]);
}

/**
 * Bind a folder to its project: transport entry, large-file endpoint, local
 * config, and the default list of what a save leaves out. Every entry path
 * (connect/create/clone) funnels through here so none of it can drift apart.
 */
export function bindRepo(
  folder: string,
  gitDir: string,
  cfg: FolderConfig,
): void {
  const pid = cfg.projectId;
  saveConfig(gitDir, cfg);
  ensureRemote(folder, cfg);
  // The stock derived large-file endpoint would point at the hidden forge;
  // ours lives on the public API origin with the same project-scoped grant.
  git(folder, [
    "config",
    "lfs.url",
    `${withCredentials(cfg.apiUrl, cfg.token)}/lfs/${pid}`,
  ]);
  applySkipRules(folder, gitDir);
  ensureSaveAuthor(folder);
  // Large-folder performance: fsmonitor + untracked cache + index v4.
  configureRepo(folder);
}

/**
 * Make sure this folder has GoodFolder's transport entry, and nothing of the
 * person's is disturbed. Idempotent, and called on every command that needs
 * the network, so a folder set up before this name existed heals itself on
 * first use rather than failing.
 */
export function ensureRemote(folder: string, cfg: FolderConfig): void {
  const url = `${withCredentials(cfg.apiUrl, cfg.token)}/git/${cfg.projectId}`;
  const existing = git(folder, ["remote", "get-url", GF_REMOTE]);
  if (existing.code === 0) {
    if (existing.stdout.trim() !== url) {
      git(folder, ["remote", "set-url", GF_REMOTE, url]);
    }
  } else {
    git(folder, ["remote", "add", GF_REMOTE, url]);
  }
  // Folders set up before this name existed carry GoodFolder under the
  // default name. Retire that entry, but only once it is proven to be ours
  // for this exact project — anything else belongs to the person.
  const legacy = git(folder, ["remote", "get-url", "origin"]);
  if (legacy.code === 0 && legacy.stdout.includes(`/git/${cfg.projectId}`)) {
    git(folder, ["remote", "remove", "origin"]);
  }
}

export { DEFAULT_API_URL };
