import type { FolderConfig } from "./config.ts";
import { recordSave } from "./api.ts";
import { runSavePipeline } from "./save-core.ts";

export async function cmdSave(
  folder: string,
  cfg: FolderConfig,
  opts: {
    message?: string | undefined;
    /** MCP client name; absent when a person runs the command directly. */
    harness?: string | undefined;
  },
): Promise<void> {
  await runSavePipeline(folder, cfg, {
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
      });
      return { seq: res.seq, label: res.label };
    },
  });
}
