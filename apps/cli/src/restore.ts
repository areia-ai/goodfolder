import { CliError } from "./cli-error.ts";
import { requireConnection } from "./connect.ts";
import { git, gitOk } from "./git.ts";
import { listSaves, recordSave } from "./api.ts";

export async function cmdRestore(
  folder: string,
  seqArg: string,
  opts: { harness?: string | undefined } = {},
): Promise<void> {
  const { cfg } = requireConnection(folder);
  const seq = Number(seqArg);
  if (!Number.isInteger(seq)) {
    throw new CliError("✗ Use a save number from the timeline. Try: goodfolder log", 1);

  }

  const saves = await listSaves(cfg);
  const target = saves.find((s) => s.seq === seq);
  if (!target) {
    throw new CliError(`✗ No save #${seq} in your timeline. Try: goodfolder log`, 1);

  }

  // Make sure we hold the content (may be a network fetch — say so).
  const haveObjects = gitOk(folder, ["cat-file", "-e", `${target.commit_sha}^{commit}`]);
  if (!haveObjects) {
    console.log("That save lives deeper than this device keeps copies — downloading its contents…");
    const fetchRes = git(folder, ["fetch", "origin"]);
    if (fetchRes.code !== 0 || !gitOk(folder, ["cat-file", "-e", `${target.commit_sha}^{commit}`])) {
      throw new CliError("✗ Could not download that save's contents. Check your connection.", 1);

    }
  }

  // Bring the whole tree to the chosen state; drop files created later.
  if (!gitOk(folder, ["restore", "--source", target.commit_sha, "--worktree", "--staged", "."])) {
    throw new CliError("✗ Could not apply that save.", 1);

  }
  const sourceFiles = new Set(
    git(folder, ["ls-tree", "-r", "--name-only", target.commit_sha]).stdout
      .split("\n")
      .filter(Boolean),
  );
  const current = git(folder, ["ls-files"]).stdout.split("\n").filter(Boolean);
  const extras = current.filter((f) => !sourceFiles.has(f));
  for (const f of extras) git(folder, ["rm", "-q", "--cached", f]);
  if (!gitOk(folder, ["commit", "-m", `Restore of save #${seq}`])) {
    console.log("Already identical to that save — nothing to do.");
    return;
  }
  const sha = git(folder, ["rev-parse", "HEAD"]).stdout.trim();
  const push = git(folder, ["push", "origin", "main"]);
  if (push.code !== 0) {
    throw new CliError("✗ Restored locally but could not upload. Run: goodfolder sync", 1);

  }

  try {
    await recordSave(cfg, {
      label: `Restored save #${seq}: ${target.label}`,
      changedPaths: [],
      commitSha: sha,
      harness: opts.harness ?? null,
    });
  } catch {
    /* the restored work is safe regardless */
  }
  console.log(`✓ Your folder now matches save #${seq}.`);
  console.log("  Changed your mind? Restore the newest number to undo this.");
}
