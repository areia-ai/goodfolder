import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  DEFAULT_API_URL,
  loadConfig,
  saveConfig,
  type FolderConfig,
} from "./config.ts";
import { bindRepo, ensureRemote } from "./repo-setup.ts";
import { CliError } from "./cli-error.ts";
import { findGitDir, git, gitOk } from "./git.ts";
import { ensureAccount, friendlyDeviceName } from "./auth.ts";
import { createProject, mintProjectToken, renewFolderToken } from "./api.ts";
import { loadAccountToken } from "./credentials.ts";

/**
 * How close to running out a folder token gets before it is renewed. Tokens
 * last ninety days; renewing with a month to spare means a folder that is
 * touched even once in two months never needs anyone to do anything.
 */
const RENEW_WHEN_LEFT_MS = 30 * 86_400_000;

/**
 * Keep the folder's token alive without asking. Called before every command
 * that reaches the server.
 *
 * Three cases. The token is fresh: nothing happens. It is getting old, or its
 * age is unknown (set up before expiry was written down): it is traded for a
 * new one. It no longer works at all — the folder sat unused for months, or
 * was copied from another computer: a new one is issued through this
 * computer's account approval, and only when that is missing too is the
 * person asked to do something.
 *
 * A server that cannot be reached is not an error here; the command that
 * follows will say so in its own words.
 */
async function ensureFreshToken(folder: string, gitDir: string, cfg: FolderConfig): Promise<void> {
  const left = cfg.tokenExpiresAt ? Date.parse(cfg.tokenExpiresAt) - Date.now() : Number.NaN;
  if (cfg.token && Number.isFinite(left) && left > RENEW_WHEN_LEFT_MS) return;

  let fresh: { token: string; expiresAt?: string } | null = null;
  try {
    if (cfg.token) fresh = await renewFolderToken(cfg);
    if (!fresh) {
      const accountToken = loadAccountToken();
      if (!accountToken) {
        throw new CliError(
          "✗ This folder's connection to GoodFolder needs approving again.\n" +
            "  Fix: run  goodfolder login  and then try again.",
        );
      }
      fresh = await mintProjectToken(cfg.apiUrl, cfg.projectId, accountToken, await friendlyDeviceName());
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    return; // unreachable server: the command itself will report it
  }
  cfg.token = fresh.token;
  if (fresh.expiresAt) cfg.tokenExpiresAt = fresh.expiresAt;
  else delete cfg.tokenExpiresAt;
  saveConfig(gitDir, cfg);
}

export async function requireConnection(folder: string): Promise<{ gitDir: string; cfg: FolderConfig }> {
  const gitDir = findGitDir(folder);
  const cfg = gitDir ? loadConfig(gitDir) : null;
  if (!gitDir || !cfg) {
    throw new CliError(
      "✗ This folder isn't connected to GoodFolder yet. Run:\n    goodfolder connect",
    );

  }
  await ensureFreshToken(folder, gitDir, cfg);
  // Folders set up before GoodFolder used its own transport name, or carried
  // the credential in the address, heal here on the first command that needs
  // it, rather than failing.
  ensureRemote(folder, cfg);
  return { gitDir, cfg };
}


/**
 * Whether this folder sits inside a bigger folder that another tool already
 * manages. Returns that outer folder, or null.
 *
 * This matters because the engine resolves upward: pointed at a folder inside
 * one it already tracks, it answers with the outer one. Binding that would
 * protect a folder nobody asked about — someone's whole home directory, in
 * the worst case — and every save afterwards would carry it.
 */
export function enclosingManagedFolder(folder: string): string | null {
  const prefix = git(folder, ["rev-parse", "--show-prefix"]);
  if (prefix.code !== 0) return null; // nothing manages this folder at all
  // An empty prefix means the resolved root IS this folder. Anything else
  // means the root is somewhere above it.
  if (prefix.stdout.trim() === "") return null;
  const root = git(folder, ["rev-parse", "--show-toplevel"]).stdout.trim();
  return root || null;
}

/** The name shown in GoodFolder always starts as the literal folder name. */
export function projectNameForFolder(folder: string): string {
  return basename(resolve(folder));
}

export async function cmdConnect(folder: string): Promise<void> {
  if (!existsSync(folder)) {
    throw new CliError(`✗ No such folder: ${folder}`, 1);

  }

  const enclosing = enclosingManagedFolder(folder);
  if (enclosing !== null) {
    throw new CliError(
      `✗ This folder sits inside "${enclosing}", which another tool already looks after.\n` +
        `    Connecting it here would protect that whole outer folder instead of this one.\n` +
        `    Connect the outer folder instead, or move this one somewhere of its own.`,
      1,
    );
  }

  let gitDir = findGitDir(folder);
  const fresh = gitDir === null;
  if (fresh) {
    if (!gitOk(folder, ["init", "-b", "main"])) {
      throw new CliError("✗ Could not initialize the folder.", 1);

    }
    gitDir = findGitDir(folder)!;
  }

  if (loadConfig(gitDir!)) {
    console.log("Already connected — nothing to do.");
    return;
  }

  const name = projectNameForFolder(folder);

  console.log("Connecting…");
  // First-time on this machine: opens the one-time browser approval.
  const accountToken = await ensureAccount(DEFAULT_API_URL);
  const boot = await createProject(DEFAULT_API_URL, name, accountToken, await friendlyDeviceName());
  if (!boot.projectId || !boot.token) {
    throw new CliError("✗ Could not create your project. Try again shortly.", 1);

  }

  const cfg: FolderConfig = {
    projectId: boot.projectId,
    apiUrl: DEFAULT_API_URL,
    token: boot.token,
    connectedAt: new Date().toISOString(),
  };
  if (boot.expiresAt) cfg.tokenExpiresAt = boot.expiresAt;
  bindRepo(folder, gitDir!, cfg);

  console.log(`✓ Connected "${name}" at ${resolve(folder)} to GoodFolder.`);
  if (fresh) console.log("  (nothing visible changed — your folder just became protected)");

  // First import runs immediately so the folder is protected from minute one.
  const status = git(folder, ["status", "--porcelain"]);
  if (status.stdout.trim() !== "") {
    console.log("Saving everything in this folder for the first time…");
    await new Promise((r) => setTimeout(r, 100));
    const { cmdSave } = await import("./save.ts");
    await cmdSave(folder, cfg, {});
  } else {
    console.log("Folder is empty of changes; run goodfolder save when ready.");
  }
}
