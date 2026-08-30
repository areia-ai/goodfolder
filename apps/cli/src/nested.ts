import { lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { git } from "./git.ts";

/**
 * Some folders inside a folder carry their own separate history, put there by
 * a different tool — a starter project someone downloaded, a library a
 * project pulled in whole. The engine's own default is to record a bookmark
 * pointing at that other tool's history instead of the files themselves. The
 * save reports success, and the folder arrives empty on the next device.
 *
 * GoodFolder takes the files instead. They become ordinary files in the
 * person's folder, protected like everything else. The other tool's own
 * history is never touched, moved, or rewritten — this reads the folder and
 * writes only to GoodFolder's own record of it.
 *
 * The one thing that is not carried across is the other tool's history. Its
 * files are all here; where they came from is not.
 */

/** Directories recorded as a bookmark to another tool's history. */
export function foreignHistories(folder: string): string[] {
  const r = git(folder, ["ls-files", "-s", "-z"]);
  if (r.code !== 0) return [];
  const dirs: string[] = [];
  for (const entry of r.stdout.split("\0")) {
    if (!entry.startsWith("160000 ")) continue;
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    dirs.push(entry.slice(tab + 1));
  }
  return dirs;
}

/**
 * Which files inside such a folder are worth taking: the ones that other
 * tool itself considers part of the project, plus anything added since. Its
 * own exclusions are honoured, so its downloaded packages and build output
 * stay out exactly as they would if the folder were connected on its own.
 */
function filesWorthTaking(folder: string, dir: string): string[] {
  const r = git(join(folder, dir), [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  if (r.code !== 0) return [];
  return r.stdout.split("\0").filter(Boolean);
}

/**
 * Replace each bookmark with the real files. Returns every path taken, so the
 * save counts them, names them in its receipt, and puts them through the same
 * case gate as everything else.
 *
 * `applyRouting` must already have run over these paths: the bytes are read
 * through the folder's own routing rules here, exactly as a normal save does,
 * so a large file inside one of these folders is stored the same way it would
 * be anywhere else.
 */
export function absorbForeignHistories(folder: string, dirs: readonly string[]): string[] {
  const taken: string[] = [];
  for (const dir of dirs) {
    // Index only — the person's files on disk are never touched.
    git(folder, ["update-index", "--force-remove", "--", dir]);
    for (const rel of filesWorthTaking(folder, dir)) {
      const path = `${dir}/${rel}`;
      let st;
      try {
        st = lstatSync(join(folder, path));
      } catch {
        continue; // vanished between listing and reading
      }
      let mode: string;
      let blob: string;
      if (st.isSymbolicLink()) {
        mode = "120000";
        const target = readlinkSync(join(folder, path));
        blob = git(folder, ["hash-object", "-w", "--stdin"], target).stdout.trim();
      } else if (st.isFile()) {
        mode = st.mode & 0o111 ? "100755" : "100644";
        // --path applies this folder's storage routing to the bytes.
        blob = git(folder, ["hash-object", "-w", "--path", path, "--", path]).stdout.trim();
      } else {
        continue; // a folder carrying yet another history; nothing to read here
      }
      if (!blob) continue;
      const add = git(folder, ["update-index", "--add", "--cacheinfo", mode, blob, path]);
      if (add.code === 0) taken.push(path);
    }
  }
  return taken;
}

/** Every file path inside these folders, for routing before the bytes are read. */
export function pathsInside(folder: string, dirs: readonly string[]): string[] {
  return dirs.flatMap((dir) => filesWorthTaking(folder, dir).map((rel) => `${dir}/${rel}`));
}
