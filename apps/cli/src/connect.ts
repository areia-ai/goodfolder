import { existsSync } from "node:fs";
import {
  DEFAULT_API_URL,
  loadConfig,
  type FolderConfig,
} from "./config.ts";
import { bindRepo } from "./repo-setup.ts";
import { CliError } from "./cli-error.ts";
import { findGitDir, git, gitOk } from "./git.ts";
import { ensureAccount, friendlyDeviceName } from "./auth.ts";
import { createProject } from "./api.ts";

export function requireConnection(folder: string): { gitDir: string; cfg: FolderConfig } {
  const gitDir = findGitDir(folder);
  if (!gitDir) {
    throw new CliError(
      "✗ This folder isn't connected to GoodFolder yet. Run:\n    goodfolder connect",
    );

  }
  const cfg = loadConfig(gitDir);
  if (!cfg) {
    throw new CliError(
      "✗ This folder already carries history from another tool.\n    GoodFolder connects folders it sets up itself — try a fresh copy.",
    );

  }
  return { gitDir, cfg };
}

export async function cmdConnect(
  folder: string,
  opts: { name?: string | undefined },
): Promise<void> {
  if (!existsSync(folder)) {
    throw new CliError(`✗ No such folder: ${folder}`, 1);

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

  const name = opts.name ?? folder.split("/").filter(Boolean).pop() ?? "My Folder";

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

  console.log(`✓ Connected "${name}" to GoodFolder.`);
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
