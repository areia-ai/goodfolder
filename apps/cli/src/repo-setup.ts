import { DEFAULT_API_URL, saveConfig, type FolderConfig } from "./config.ts";
import { git } from "./git.ts";
import { configureRepo } from "./perf.ts";

/**
 * Bind a folder to its project: remote URL, LFS endpoint, local config.
 * Every entry path (connect/create/clone) funnels through here so the
 * transport wiring can never drift between them.
 */
export function bindRepo(
  folder: string,
  gitDir: string,
  cfg: FolderConfig,
): void {
  const pid = cfg.projectId;
  saveConfig(gitDir, cfg);
  const remote = `${cfg.apiUrl.replace("https://", "https://x:" + cfg.token + "@")}/git/${pid}`;
  git(folder, ["remote", "remove", "origin"]);
  git(folder, ["remote", "add", "origin", remote]);
  // The stock derived LFS endpoint would point at the hidden forge; ours
  // lives on the public API origin with the same project-scoped token.
  git(folder, [
    "config",
    "lfs.url",
    `${cfg.apiUrl.replace("https://", "https://x:" + cfg.token + "@")}/lfs/${pid}`,
  ]);
  // Large-folder performance: fsmonitor + untracked cache + index v4.
  configureRepo(folder);
}

export { DEFAULT_API_URL };
