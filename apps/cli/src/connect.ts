import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  DEFAULT_API_URL,
  loadConfig,
  type FolderConfig,
} from "./config.ts";
import { bindRepo, ensureRemote } from "./repo-setup.ts";
import { CliError } from "./cli-error.ts";
import { findGitDir, git, gitOk } from "./git.ts";
import { ensureAccount, friendlyDeviceName } from "./auth.ts";
import { createProject } from "./api.ts";

export function requireConnection(folder: string): { gitDir: string; cfg: FolderConfig } {
  const gitDir = findGitDir(folder);
  const cfg = gitDir ? loadConfig(gitDir) : null;
  if (!gitDir || !cfg) {
    throw new CliError(
      "✗ This folder isn't connected to GoodFolder yet. Run:\n    goodfolder connect",
    );

  }
  // Folders set up before GoodFolder used its own transport name heal here,
  // on the first command that needs it, rather than failing.
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
