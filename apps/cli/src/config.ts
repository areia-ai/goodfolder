import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Per-folder GoodFolder configuration. Lives inside .git/ so it never
 * syncs as project content. v0 stores the project-scoped token here;
 * replaced by proper credential management before external users.
 */
export interface FolderConfig {
  projectId: string;
  apiUrl: string;
  token: string;
  connectedAt: string;
}

export const DEFAULT_API_URL = "https://api.trygoodfolder.com";

export function configPath(gitDir: string): string {
  return join(gitDir, "goodfolder.json");
}

export function loadConfig(gitDir: string): FolderConfig | null {
  try {
    return JSON.parse(readFileSync(configPath(gitDir), "utf8"));
  } catch {
    return null;
  }
}

export function saveConfig(gitDir: string, cfg: FolderConfig): void {
  writeFileSync(configPath(gitDir), JSON.stringify(cfg, null, 2));
}
