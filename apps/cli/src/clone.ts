import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_API_URL, withCredentials, type FolderConfig } from "./config.ts";
import { CliError } from "./cli-error.ts";
import { findGitDir, git } from "./git.ts";
import { bindRepo } from "./repo-setup.ts";
import { dedupePath, defaultParent, sanitizeName, type CreatedFolder } from "./create.ts";
import { listProjects, mintProjectToken } from "./api.ts";
import { ensureAccount, friendlyDeviceName } from "./auth.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Download an existing GoodFolder to this machine — the git-clone moment,
 * minus every piece of git vocabulary.
 */
export async function cmdClone(
  query: string,
  opts: { dest?: string | undefined },
): Promise<CreatedFolder> {
  const accountToken = await ensureAccount(DEFAULT_API_URL);
  const projects = await listProjects(DEFAULT_API_URL, accountToken);
  let project: (typeof projects)[number] | undefined;
  if (UUID_RE.test(query)) {
    project = projects.find((p) => p.id === query);
  } else {
    const matches = projects.filter(
      (p) => p.name.toLowerCase() === query.toLowerCase(),
    );
    if (matches.length > 1) {
      throw new CliError(
        `✗ Several folders share that name:\n` +
          matches.map((m) => `  • ${m.name} (${m.id})`).join("\n") +
          `\nOpen by id instead.`,
      );
    }
    project = matches[0];
  }
  if (!project) {
    const available =
      projects.length === 0
        ? "No GoodFolders exist yet."
        : `Available: ${projects.slice(0, 10).map((p) => `"${p.name}"`).join(", ")}`;
    throw new CliError(`✗ No GoodFolder called "${query}". ${available}`);
  }

  console.log(`Getting "${project.name}" ready on this computer…`);
  const minted = await mintProjectToken(
    DEFAULT_API_URL,
    project.id,
    accountToken,
    `${project.name} · ${await friendlyDeviceName()}`,
  );

  const parent = opts.dest ?? defaultParent(process.cwd());
  if (!existsSync(parent)) {
    throw new CliError(`✗ Destination folder does not exist: ${parent}`);
  }
  const dir = dedupePath(join(parent, sanitizeName(project.name)));

  console.log(`Downloading "${project.name}"…`);
  const remote = `${withCredentials(DEFAULT_API_URL, minted.token)}/git/${project.id}`;
  const clone = git(parent, ["clone", remote, dir]);
  // An empty project clones with a warning and exit code 0 — fine.
  if (clone.code !== 0 && !/empty repository/i.test(clone.stderr)) {
    throw new CliError(`✗ Download failed: ${clone.stderr.trim()}`);
  }
  const gitDir = findGitDir(dir)!;

  const cfg: FolderConfig = {
    projectId: project.id,
    apiUrl: DEFAULT_API_URL,
    token: minted.token,
    connectedAt: new Date().toISOString(),
  };
  bindRepo(dir, gitDir, cfg);

  console.log(
    /empty repository/i.test(clone.stderr)
      ? `✓ Connected to the empty "${project.name}" at ${dir}`
      : `✓ "${project.name}" is ready at ${dir} — fully up to date.`,
  );
  return { path: dir, projectId: project.id };
}
