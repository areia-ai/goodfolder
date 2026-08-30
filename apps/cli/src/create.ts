import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_API_URL, type FolderConfig } from "./config.ts";
import { CliError } from "./cli-error.ts";
import { findGitDir, git, gitOk } from "./git.ts";
import { bindRepo } from "./repo-setup.ts";
import { createProject } from "./api.ts";
import { ensureAccount, friendlyDeviceName } from "./auth.ts";

/** Landing dirs get new folders on the Desktop; real projects nest locally. */
export function defaultParent(cwd: string): string {
  const home = homedir();
  const landing = ["Desktop", "Documents", "Downloads"].map((d) =>
    join(home, d),
  );
  if (cwd === home || landing.includes(cwd)) return join(home, "Desktop");
  return cwd;
}

export function sanitizeName(name: string): string {
  const cleaned = name.replace(/[/\\:]+/g, "-").trim().replace(/\s+/g, " ");
  return cleaned || "My Folder";
}

/** First non-colliding path: "Name", "Name-2", "Name-3", … */
export function dedupePath(base: string): string {
  if (!existsSync(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new CliError(`✗ Too many folders named "${base}" already exist.`);
}

export interface CreatedFolder {
  path: string;
  projectId: string;
}

/**
 * Create a brand-new GoodFolder from nothing: server project + an empty,
 * connected local folder. The agent flow starts here.
 */
export async function cmdCreate(
  name: string,
  opts: { dest?: string | undefined },
): Promise<CreatedFolder> {
  const clean = sanitizeName(name);
  const parent = opts.dest ?? defaultParent(process.cwd());
  if (!existsSync(parent)) {
    throw new CliError(`✗ Destination folder does not exist: ${parent}`);
  }
  const dir = dedupePath(join(parent, clean));

  mkdirSync(dir, { recursive: true });
  if (!gitOk(dir, ["init", "-b", "main"])) {
    throw new CliError("✗ Could not set up the folder internally.");
  }
  const gitDir = findGitDir(dir)!;

  // First-time on this machine: opens the one-time browser approval.
  const accountToken = await ensureAccount(DEFAULT_API_URL);
  const boot = await createProject(
    DEFAULT_API_URL,
    clean,
    accountToken,
    `${clean} · ${await friendlyDeviceName()}`,
  );
  if (!boot.projectId || !boot.token) {
    throw new CliError(
      "✗ Could not create the project on GoodFolder. Try again shortly.",
    );
  }
  const cfg: FolderConfig = {
    projectId: boot.projectId,
    apiUrl: DEFAULT_API_URL,
    token: boot.token,
    connectedAt: new Date().toISOString(),
  };
  bindRepo(dir, gitDir, cfg);

  console.log(`✓ Created "${clean}" at ${dir}`);
  console.log("  Empty and ready. Saves stay protected while this account has access and capacity.");
  return { path: dir, projectId: cfg.projectId };
}
