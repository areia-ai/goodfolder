import { createInterface } from "node:readline/promises";
import type { FolderConfig } from "./config.ts";
import { saveConfig } from "./config.ts";
import { recordSave } from "./api.ts";
import { runSavePipeline, type SaveOutcome } from "./save-core.ts";
import { CliError } from "./cli-error.ts";
import { findGitDir } from "./git.ts";
import { credentialFilesLeftOut } from "./skip.ts";

/**
 * `goodfolder save --include-secrets`: take in the files the credential
 * rules leave out, after the person has seen the list and said the word.
 * Once saved they keep being saved, and they stay in earlier saves — so the
 * answer is typed out, not a flag.
 */
async function includeCredentialFiles(
  folder: string,
  cfg: FolderConfig,
  gitDir: string | undefined,
): Promise<void> {
  const leftOut = credentialFilesLeftOut(folder, cfg.alsoProtect ?? []);
  if (leftOut.length === 0) {
    console.log("Nothing that looks like credentials is being left out.");
    return;
  }
  console.log("These files look like they hold passwords or keys:");
  for (const path of leftOut) console.log(`  • ${path}`);
  console.log(
    "\nOnce saved, they keep being saved and stay in this folder's history.",
  );
  if (!process.stdin.isTTY) {
    throw new CliError(
      "✗ This needs you to confirm in person. To protect just one of them, run: goodfolder protect <name>",
      1,
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer = "";
  try {
    answer = (await rl.question('Type "include" to protect them anyway: ')).trim();
  } finally {
    rl.close();
  }
  if (answer !== "include") {
    throw new CliError("Not included — nothing was saved differently.", 1);
  }
  const dir = gitDir ?? findGitDir(folder);
  if (!dir) throw new CliError("✗ This folder is not connected.", 1);
  cfg.alsoProtect = [...new Set([...(cfg.alsoProtect ?? []), ...leftOut])].sort();
  saveConfig(dir, cfg);
  console.log(`✓ ${leftOut.length} file(s) will be protected from now on.`);
}

export async function cmdSave(
  folder: string,
  cfg: FolderConfig,
  opts: {
    message?: string | undefined;
    /** MCP client name; absent when a person runs the command directly. */
    harness?: string | undefined;
    /** Take in the credential-shaped files the defaults leave out. */
    includeSecrets?: boolean | undefined;
    gitDir?: string | undefined;
  },
): Promise<SaveOutcome> {
  if (opts.includeSecrets) {
    await includeCredentialFiles(folder, cfg, opts.gitDir);
  }
  return await runSavePipeline(folder, cfg, {
    message: opts.message,
    ...(opts.harness ? { harness: opts.harness } : {}),
    async recorder(input) {
      const res = await recordSave(cfg, {
        changedPaths: input.changedPaths,
        commitSha: input.commitSha,
        counts: input.counts,
        topPaths: input.topPaths,
        harness: opts.harness ?? null,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.ai !== undefined ? { ai: input.ai } : {}),
        ...(input.warnings !== undefined ? { warnings: input.warnings } : {}),
        ...(input.includedOnPurpose !== undefined
          ? { includedOnPurpose: input.includedOnPurpose }
          : {}),
        ...(input.skipped !== undefined ? { skipped: input.skipped } : {}),
        ...(input.skippedTotal !== undefined ? { skippedTotal: input.skippedTotal } : {}),
      });
      return { seq: res.seq, label: res.label };
    },
  });
}
