import { CliError } from "./cli-error.ts";
import { requireConnection } from "./connect.ts";
import { git, gitOk } from "./git.ts";
import { recordSave } from "./api.ts";

export async function cmdSync(
  folder: string,
  opts: { harness?: string | undefined } = {},
): Promise<void> {
  const { cfg } = requireConnection(folder);

  const fetchRes = git(folder, ["fetch", "origin"]);
  if (fetchRes.code !== 0) {
    throw new CliError(`✗ Could not reach GoodFolder: ${fetchRes.stderr.trim()}`, 1);

  }

  // A brand-new project has no origin branch yet — nothing to compare.
  if (!gitOk(folder, ["rev-parse", "-q", "--verify", "origin/main"])) {
    console.log("Everything is already up to date.");
    return;
  }
  const count = git(folder, [
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...origin/main",
  ]);
  const [ahead, behind] = count.stdout.trim().split(/\s+/).map(Number);
  if (ahead === undefined || behind === undefined) {
    throw new CliError("✗ Could not compare with your other devices.", 1);

  }

  if (ahead === 0 && behind === 0) {
    console.log("Everything is already up to date.");
    return;
  }

  if (ahead > 0 && behind > 0) {
    // Both sides moved. Merge; conflicts stay in plain language.
    console.log("You and another device both made changes — combining them…");
    const merge = git(folder, ["merge", "origin/main", "-m", "Sync changes"]);
    if (merge.code !== 0) {
      const conflicted = git(folder, ["diff", "--name-only", "--diff-filter=U"])
        .stdout.split("\n")
        .filter(Boolean);
      throw new CliError(
        "\nBoth versions are kept — nothing was lost.\n" +
          conflicted.map((f) => `  • ${f}`).join("\n") +
          '\n\nOpen those files, keep what you want, then run:\n   goodfolder save -m "Resolved changes"',
        2,
      );
    }
    const sha = git(folder, ["rev-parse", "HEAD"]).stdout.trim();
    const push = git(folder, ["push", "origin", "main"]);
    if (push.code !== 0) {
      throw new CliError("✗ Combined locally but could not upload. Try again.", 1);

    }
    try {
      await recordSave(cfg, {
        label: `Synced changes from another device`,
        changedPaths: git(folder, ["diff", "--name-only", "HEAD^", "HEAD"])
          .stdout.split("\n")
          .filter(Boolean),
        commitSha: sha,
        collision: "auto-merged",
        harness: opts.harness ?? null,
      });
    } catch {
      /* timeline entry failed; the combined work is safe */
    }
    console.log("✓ Combined and saved.");
    return;
  }

  if (behind > 0) {
    const ff = git(folder, ["merge", "--ff-only", "origin/main"]);
    if (ff.code !== 0) {
      throw new CliError("✗ Update failed mid-way — your work is untouched.", 1);

    }
    console.log(`✓ Brought in ${behind} change${behind === 1 ? "" : "s"} from your other device${behind === 1 ? "" : "s"}.`);
    return;
  }

  console.log("Your folder has unsaved local changes ahead — run: goodfolder save");
}
