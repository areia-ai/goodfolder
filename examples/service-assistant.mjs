#!/usr/bin/env node
// A complete third-party integration in one file.
//
// An assistant with cloud compute: it lists the folders a scoped key can
// reach, reads a folder's timeline and a file, clones the folder over the
// same remote a device uses, commits one change, sends it back, and records
// the save so the timeline names this assistant as the author.
//
// Requirements: Node 22+, git on PATH, and a service key approved for the
// folder (scopes read:folders, read:files, git:read, git:write).
//
//   export GF_API_URL=https://api.trygoodfolder.com   # or your own server
//   export GOODFOLDER_KEY=gfx_…
//   node examples/service-assistant.mjs "Recipes"
//
// Everything it touches lives in a temporary directory that it removes on
// the way out. Nothing is written into the user's folder on their computer.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = (process.env.GF_API_URL ?? "https://api.trygoodfolder.com").replace(/\/+$/, "");
const KEY = process.env.GOODFOLDER_KEY;
const WANTED = process.argv[2] ?? "";

if (!KEY) {
  console.error("Set GOODFOLDER_KEY to a service key (gfx_…) first.");
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${method} ${path} failed (${res.status}): ${json?.error?.message ?? "no message"}`);
  }
  return json;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// 1. What may this key reach? A key bound to one folder answers with one row.
const folders = await api("GET", "/api/projects");
console.log(`Folders this key can reach: ${folders.map((folder) => folder.name).join(", ") || "(none)"}`);
const folder = WANTED ? folders.find((row) => row.name.toLowerCase() === WANTED.toLowerCase()) : folders[0];
if (!folder) {
  console.error(WANTED ? `No folder called “${WANTED}”.` : "This account has no folders yet.");
  process.exit(1);
}
console.log(`Using “${folder.name}” (${folder.id})`);

// 2. Read its timeline — what changed, when, and who did it.
const saves = await api("GET", `/api/projects/${folder.id}/saves`);
console.log(`\nTimeline (${saves.length} saves):`);
for (const save of saves.slice(0, 5)) {
  console.log(`  #${save.seq}  ${save.label}  — ${save.harness ?? save.deviceName ?? "a person"}`);
}

// 3. Read a file as it stands now. Its history is the timeline above; every
//    save names the state the file had, and a return to any of them is
//    recorded as a new save rather than a rewrite.
const files = await api("GET", `/api/projects/${folder.id}/files`);
const readme = files.files.find((file) => /^readme\.md$/i.test(file.path)) ?? files.files.find((file) => file.previewKind === "text");
if (readme) {
  const current = await api("GET", `/api/projects/${folder.id}/file?path=${encodeURIComponent(readme.path)}`);
  console.log(`\n${readme.path} now (${current.size} bytes):`);
  console.log(String(current.content ?? "").split("\n").slice(0, 3).map((line) => `  ${line}`).join("\n"));
}

// 4. Clone the folder over the transport proxy. The key is the password;
//    any username works. This is the same remote a paired computer uses.
const dir = mkdtempSync(join(tmpdir(), "gf-example-"));
const remote = `${API}/git/${folder.id}`;
const authedRemote = remote.replace("://", `://x:${encodeURIComponent(KEY)}@`);
try {
  console.log(`\nCloning into ${dir} …`);
  git(dir, ["clone", "--depth", "50", authedRemote, "."]);
  git(dir, ["config", "user.name", "Example assistant"]);
  git(dir, ["config", "user.email", "assistant@example.com"]);

  // 5. Make one change and send it back.
  const note = "notes-from-an-assistant.md";
  const path = join(dir, note);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, `${existing}- Checked in by the example assistant on ${new Date().toISOString()}.\n`);
  git(dir, ["add", note]);
  git(dir, ["commit", "-m", "Add a note from the example assistant"]);
  const head = git(dir, ["rev-parse", "HEAD"]).trim();
  git(dir, ["push", "origin", "HEAD:main"]);
  console.log(`Sent ${note} (${head.slice(0, 8)})`);

  // 6. Record the save. The server computes the receipt from the folder's
  //    own tree, so the timeline describes the change without trusting this
  //    process — and names it as the author.
  const save = await api("POST", "/api/saves", {
    projectId: folder.id,
    label: "Added a note from the example assistant",
    harness: "Example assistant",
    commitSha: head,
  });
  console.log(`Recorded save #${save.seq}: ${save.label}`);
  console.log(`Counts: ${JSON.stringify(save.counts)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("\nDone. Open the folder in the dashboard to see the new save on its timeline.");
