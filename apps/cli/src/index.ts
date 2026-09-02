#!/usr/bin/env node
// goodfolder — two verbs and a timeline. Git never surfaces.
import { resolve } from "node:path";
import { cmdConnect, requireConnection } from "./connect.ts";
import { cmdSave } from "./save.ts";
import { cmdSync } from "./sync.ts";
import { cmdRestore } from "./restore.ts";
import { cmdUndo } from "./undo.ts";
import { cmdLog } from "./log.ts";
import { cmdCreate } from "./create.ts";
import { cmdClone } from "./clone.ts";
import { cmdLogin } from "./auth.ts";
import { cmdProtect, cmdSkipped } from "./protect.ts";
import { cmdRename } from "./rename.ts";

const HELP = `goodfolder — keep your folder safe

  goodfolder create <name>        Start a brand-new GoodFolder on this machine
  goodfolder clone <name>         Download an existing GoodFolder to here
  goodfolder connect [folder]     Connect an existing folder (first time)
  goodfolder rename <name>        Change the folder name shown in GoodFolder
  goodfolder save [-m note]       Save a point you can come back to
  goodfolder sync                 Bring in changes from your other devices
  goodfolder log                  Show the timeline
  goodfolder undo                 Undo the last save (shows what changes first)
  goodfolder restore <number>     Go back to an earlier save
  goodfolder skipped              Show what isn't being protected, and why
  goodfolder protect <name>       Protect something that is being left out
  goodfolder login                Approve this computer (one-time setup)

Set GF_API_URL to use a GoodFolder server you run yourself. Folders remember
the server they were set up against, so this only affects new ones.
`;

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  const positional: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "-m" || argv[i] === "--message") flags.message = argv[++i] ?? "";
    else if (argv[i] === "--dest") flags.dest = argv[++i] ?? "";
    else if (argv[i] === "-y" || argv[i] === "--yes") bools.add("yes");
    else if (argv[i] === "--session") bools.add("session");
    else positional.push(argv[i]!);
  }
  const folder = process.cwd();

  switch (cmd) {
    case "create":
      if (!positional[0]) {
        console.error("What should it be called? e.g.: goodfolder create \"Trip Planning\"");
        process.exit(1);
      }
      await cmdCreate(positional[0], { dest: flags.dest });
      break;
    case "clone":
      if (!positional[0]) {
        console.error("Which GoodFolder? e.g.: goodfolder clone \"Recipe Book\"");
        process.exit(1);
      }
      await cmdClone(positional[0], { dest: flags.dest });
      break;
    case "connect":
      // The help has always advertised `connect [folder]`, but the argument
      // was dropped and the current directory used instead, so following the
      // documented usage silently connected the wrong folder.
      await cmdConnect(resolve(positional[0] ?? folder));
      break;
    case "skipped":
      cmdSkipped(folder);
      break;
    case "protect":
      cmdProtect(folder, positional);
      break;
    case "login":
      await cmdLogin();
      break;
    case "save":
      await cmdSave(folder, requireConnection(folder).cfg, flags);
      break;
    case "sync":
      await cmdSync(folder);
      break;
    case "rename":
      if (!positional[0]) {
        console.error("What should this folder be called? e.g.: goodfolder rename \"Trip Planning\"");
        process.exit(1);
      }
      await cmdRename(folder, positional[0]);
      break;
    case "log":
      await cmdLog(folder);
      break;
    case "restore":
      if (!positional[0]) {
        console.error("Which save? Pick a number from: goodfolder log");
        process.exit(1);
      }
      await cmdRestore(folder, positional[0]);
      break;
    case "undo":
      await cmdUndo(folder, { yes: bools.has("yes"), session: bools.has("session") });
      break;
    default:
      console.log(HELP);
      if (cmd !== undefined && cmd !== "help" && cmd !== "--help") {
        console.error(`Unknown command: ${cmd}`);
        process.exit(1);
      }
  }
}

main().catch((e: unknown) => {
  const err = e as { message?: string; exitCode?: number };
  console.error(err.message ?? "Something went wrong.");
  process.exit(err.exitCode ?? 1);
});
