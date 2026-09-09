import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFolderToken, saveFolderToken } from "./credentials.ts";

/**
 * Per-folder GoodFolder configuration. Lives inside .git/ so it never
 * syncs as project content.
 *
 * The token is the one part of this that is not written here. It lives in
 * the user's own credential file (credentials.ts) and is joined in on load,
 * so the folder — and any agent reading it — holds nothing that could act
 * on the account. Folders set up before this kept the token in this file;
 * the first load after the change moves it out.
 */
export interface FolderConfig {
  projectId: string;
  apiUrl: string;
  /** In memory only; never written to the folder. */
  token: string;
  /** When the server said the token runs out. The folder renews it before then. */
  tokenExpiresAt?: string;
  connectedAt: string;
  /**
   * Paths the person asked GoodFolder to protect even though the default
   * rules leave them out — set by `goodfolder protect <path>`. Kept here
   * rather than as an exception in the exclusion list because a file inside
   * an excluded folder cannot be brought back by an exception alone.
   */
  alsoProtect?: string[];
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

/** The folder's transport address as it is written down: no credential in it. */
export function transportUrl(cfg: Pick<FolderConfig, "apiUrl" | "projectId">): string {
  return `${cfg.apiUrl}/git/${cfg.projectId}`;
}

export function largeFileUrl(cfg: Pick<FolderConfig, "apiUrl" | "projectId">): string {
  return `${cfg.apiUrl}/lfs/${cfg.projectId}`;
}

/**
 * The credential, handed to the engine for one command only.
 *
 * The engine reads configuration from the environment as readily as from
 * its files, and so does its large-file helper. Given this way, the token
 * is in the running command and nowhere on disk the folder can see: not in
 * the folder's settings, not in the address the engine prints back.
 */
export function transportEnv(cfg: FolderConfig): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "4",
    GIT_CONFIG_KEY_0: `url.${withCredentials(cfg.apiUrl, cfg.token)}/git/${cfg.projectId}.insteadOf`,
    GIT_CONFIG_VALUE_0: transportUrl(cfg),
    GIT_CONFIG_KEY_1: "lfs.url",
    GIT_CONFIG_VALUE_1: `${withCredentials(cfg.apiUrl, cfg.token)}/lfs/${cfg.projectId}`,
    // The engine offers a credential that worked to the system's password
    // store afterwards. Ours is renewed on its own and must not pile up there.
    GIT_CONFIG_KEY_2: "credential.helper",
    GIT_CONFIG_VALUE_2: "",
    // Unless told, the large-file helper probes for a locking service the
    // first time and writes its finding into the folder's settings under the
    // full address — credential included. Telling it up front keeps that out.
    GIT_CONFIG_KEY_3: "lfs.locksverify",
    GIT_CONFIG_VALUE_3: "false",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function configPath(gitDir: string): string {
  return join(gitDir, "goodfolder.json");
}

type StoredConfig = Omit<FolderConfig, "token"> & { token?: string };

export function loadConfig(gitDir: string): FolderConfig | null {
  let stored: StoredConfig;
  try {
    stored = JSON.parse(readFileSync(configPath(gitDir), "utf8")) as StoredConfig;
  } catch {
    return null;
  }
  if (!stored || typeof stored.projectId !== "string" || typeof stored.apiUrl !== "string") return null;
  const { token: legacyToken, ...rest } = stored;
  let credential = loadFolderToken(gitDir);
  if (!credential && legacyToken) {
    // Set up before tokens moved out of the folder: move it now.
    credential = { token: legacyToken };
    saveFolderToken(gitDir, credential);
  }
  // No credential at all (the folder was copied from another computer, say)
  // still means a connected folder: the token is fetched again on first use.
  const cfg: FolderConfig = { ...rest, token: credential?.token ?? "" };
  if (credential?.expiresAt) cfg.tokenExpiresAt = credential.expiresAt;
  if (legacyToken) saveConfig(gitDir, cfg);
  return cfg;
}

export function saveConfig(gitDir: string, cfg: FolderConfig): void {
  const { token, tokenExpiresAt, ...written } = cfg;
  if (token) saveFolderToken(gitDir, tokenExpiresAt ? { token, expiresAt: tokenExpiresAt } : { token });
  writeFileSync(configPath(gitDir), JSON.stringify(written, null, 2), { mode: 0o600 });
  try {
    chmodSync(configPath(gitDir), 0o600);
  } catch {
    /* best effort on filesystems without modes */
  }
}
