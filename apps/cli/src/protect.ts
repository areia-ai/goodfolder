import { existsSync } from "node:fs";
import { join } from "node:path";
import { saveConfig } from "./config.ts";
import { CliError } from "./cli-error.ts";
import { requireConnection } from "./connect.ts";
import { skippedGroups } from "./skip.ts";

/**
 * Two small commands around what a save leaves out.
 *
 * The defaults are deliberately opinionated — a folder full of downloaded
 * packages should not be uploaded, and a file holding a password should not
 * leave the machine. Being opinionated is only fair if the person can see
 * the opinion and overrule it, which is what these two are for.
 */

export function cmdSkipped(folder: string): void {
  const { cfg } = requireConnection(folder);
  const alsoProtect = cfg.alsoProtect ?? [];
  const groups = skippedGroups(folder, alsoProtect);

  if (groups.length === 0 && alsoProtect.length === 0) {
    console.log("Everything in this folder is protected.");
    return;
  }

  if (groups.length > 0) {
    console.log("Not protected, and why:\n");
    for (const group of groups) {
      console.log(`  ${group.label}`);
      for (const path of group.paths.slice(0, 12)) {
        console.log(`    • ${path}`);
      }
      const rest = group.paths.length - 12;
      if (rest > 0) console.log(`    …and ${rest.toLocaleString("en-US")} more`);
      console.log("");
    }
    console.log("To protect one of them anyway:");
    console.log("   goodfolder protect <name>");
  }

  if (alsoProtect.length > 0) {
    console.log("\nProtected because you asked for it:");
    for (const path of alsoProtect) console.log(`  • ${path}`);
  }
}

export function cmdProtect(folder: string, paths: string[]): void {
  const { gitDir, cfg } = requireConnection(folder);
  if (paths.length === 0) {
    throw new CliError(
      "Which one? Run goodfolder skipped to see what is being left out.",
      1,
    );
  }

  const already = new Set(cfg.alsoProtect ?? []);
  const added: string[] = [];
  for (const raw of paths) {
    const path = raw.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!existsSync(join(folder, path))) {
      throw new CliError(`✗ There is nothing called "${path}" in this folder.`, 1);
    }
    if (already.has(path)) {
      console.log(`Already protected: ${path}`);
      continue;
    }
    already.add(path);
    added.push(path);
  }

  if (added.length === 0) return;
  cfg.alsoProtect = [...already].sort();
  saveConfig(gitDir, cfg);

  for (const path of added) console.log(`✓ ${path} will be protected from now on.`);
  const secretish = added.filter((p) => /(^|\/)\.env($|\.)|\.pem$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/.test(p));
  if (secretish.length > 0) {
    console.log(
      "\n  Note: this file looks like it holds passwords or keys. It will be",
    );
    console.log("  uploaded and kept in this folder's history from the next save on.");
  }
  console.log("\nRun goodfolder save to include it.");
}
