import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The approved-computer credential. One browser ceremony mints it; it then
 * covers every folder and every agent on this machine.
 *
 * Storage: macOS Keychain via the built-in `security` CLI (no native deps),
 * falling back to a 0600 file under ~/.config/goodfolder elsewhere or when
 * the keychain is unavailable. Non-secret metadata always lives in
 * account.json next to the fallback token.
 */

const SERVICE = "goodfolder-account";
const CONFIG_DIR = () => join(homedir(), ".config", "goodfolder");
const TOKEN_FILE = () => join(CONFIG_DIR(), "account-token");
const META_FILE = () => join(CONFIG_DIR(), "account.json");

export interface AccountMeta {
  email?: string;
  deviceName?: string;
  apiUrl?: string;
  savedAt?: string;
}

let cached: string | null | undefined;

export function accountMeta(): AccountMeta {
  try {
    return JSON.parse(readFileSync(META_FILE(), "utf8")) as AccountMeta;
  } catch {
    return {};
  }
}

function saveMeta(patch: AccountMeta): void {
  mkdirSync(CONFIG_DIR(), { recursive: true });
  writeFileSync(
    META_FILE(),
    JSON.stringify({ ...accountMeta(), ...patch }, null, 2) + "\n",
    { mode: 0o600 },
  );
}

export function loadAccountToken(): string | null {
  if (cached !== undefined) return cached;
  const env = process.env.GF_ACCOUNT_TOKEN?.trim();
  if (env) {
    cached = env;
    return env;
  }
  if (process.platform === "darwin") {
    try {
      const out = execFileSync("security", ["find-generic-password", "-s", SERVICE, "-w"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      if (out) {
        cached = out;
        return out;
      }
    } catch {
      /* not in keychain — fall through to file */
    }
  }
  try {
    const raw = readFileSync(TOKEN_FILE(), "utf8").trim();
    cached = raw || null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Persist the credential for the whole machine; returns where it landed. */
export function saveAccountToken(token: string): "keychain" | "file" {
  let stored: "keychain" | "file" = "file";
  if (process.platform === "darwin") {
    try {
      execFileSync(
        "security",
        ["add-generic-password", "-U", "-s", SERVICE, "-a", "goodfolder", "-w", token],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      stored = "keychain";
    } catch {
      stored = "file";
    }
  }
  if (stored === "file") {
    mkdirSync(CONFIG_DIR(), { recursive: true });
    writeFileSync(TOKEN_FILE(), `${token.trim()}\n`, { mode: 0o600 });
  }
  saveMeta({ savedAt: new Date().toISOString() });
  cached = token.trim();
  return stored;
}
