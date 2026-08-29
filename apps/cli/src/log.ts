import { friendlyHarness } from "@goodfolder/shared";
import { CliError } from "./cli-error.ts";
import { requireConnection } from "./connect.ts";
import { listSaves, type TimelineReceipt } from "./api.ts";

/** "1 added · 3 changed" — only the non-zero parts, in save-order. */
function countSummary(added = 0, changed = 0, removed = 0): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (changed > 0) parts.push(`${changed} changed`);
  if (removed > 0) parts.push(`${removed} removed`);
  return parts.join(" · ");
}

export async function cmdLog(folder: string): Promise<void> {
  const { cfg } = requireConnection(folder);
  const saves = (await listSaves(cfg)) as unknown as TimelineReceipt[];
  if (saves.length === 0) {
    console.log("No saves yet. Your first one is one command away: goodfolder save");
    return;
  }
  console.log("\nTimeline (newest first):\n");
  for (const s of saves) {
    const when = new Date(s.createdAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const tag = s.collision && s.collision !== "none" ? `  [needs attention]` : "";
    console.log(`  #${String(s.seq).padStart(3)}  ${when}  ${s.label}${tag}`);

    // Receipt line: who and how much. Old saves have no receipt data.
    const bits: string[] = [];
    const by = s.harness ? friendlyHarness(s.harness) : null;
    if (by) bits.push(`saved by ${by}`);
    else if (s.deviceName) bits.push(`saved on ${s.deviceName}`);
    const counts = countSummary(
      Number(s.addedCount ?? 0),
      Number(s.changedCount ?? 0),
      Number(s.removedCount ?? 0),
    );
    if (counts) bits.push(counts);
    const paths = Array.isArray(s.topPaths) ? (s.topPaths as string[]) : [];
    if (paths.length > 0) {
      const shown = paths.slice(0, 3).join(", ");
      bits.push(paths.length > 3 ? `${shown} +${paths.length - 3} more` : shown);
    }
    if (bits.length > 0) console.log(`        ${bits.join(" · ")}`);
  }
  console.log(`\n${saves.length} save${saves.length === 1 ? "" : "s"}. Restore with: goodfolder restore <number>`);
}
