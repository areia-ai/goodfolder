import { ensureAccount } from "./auth.ts";
import { accountCall } from "./api.ts";
import { requireConnection } from "./connect.ts";
import { CliError } from "./cli-error.ts";

/** Change a GoodFolder's display name only on an explicit command. */
export async function cmdRename(folder: string, name: string): Promise<void> {
  if (name.length === 0 || name.trim().length === 0) {
    throw new CliError("✗ Enter a name for this folder.");
  }
  const { cfg } = requireConnection(folder);
  const accountToken = await ensureAccount(cfg.apiUrl);
  const result = await accountCall<{ name: string }>(
    cfg.apiUrl,
    accountToken,
    "PATCH",
    `/api/projects/${cfg.projectId}`,
    { name },
  );
  console.log(`✓ Renamed this GoodFolder to "${result.name}".`);
}
