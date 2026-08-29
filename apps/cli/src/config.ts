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

/**
 * Where the CLI talks to. GoodFolder's hosted service by default; set
 * GF_API_URL to point at a server you run yourself.
 *
 * Only first contact reads this. Once a folder is set up, its own config
 * carries the apiUrl it was created against, so a folder always keeps
 * talking to the server it belongs to even if this variable changes later.
 */
const configuredApiUrl = process.env.GF_API_URL?.trim().replace(/\/+$/, "");
export const DEFAULT_API_URL = configuredApiUrl || "https://api.trygoodfolder.com";

/**
 * Put credentials into a transport URL without assuming its scheme.
 *
 * This used to replace a literal "https://", so a server reached over http
 * (which a self-hosted one usually is) silently got no credentials at all and
 * the transport then stopped to ask for a username.
 */
export function withCredentials(base: string, token: string): string {
  const m = /^(https?:\/\/)(.*)$/.exec(base);
  const scheme = m?.[1];
  const rest = m?.[2];
  if (!scheme || !rest) return base;
  return `${scheme}x:${token}@${rest}`;
}

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
