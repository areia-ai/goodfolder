// Zero-to-folder proof: create on Desktop -> write -> save -> clone to /tmp
// -> converge both sides. Run from ~ to exercise the smart default.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadAccountToken } from "../cli/src/credentials.ts";

const SERVER = "/Users/carlosmarcial/Desktop/goodfolder/apps/mcp/src/index.ts";
const NAME = "GF Create Clone Test";

const transport = new StdioClientTransport({
  command: "node",
  args: ["--experimental-transform-types", SERVER],
  // Agent sessions typically open somewhere specific; spawning from $HOME
  // exercises the smart-default rule: new folders land on ~/Desktop.
  env: { ...process.env },
  cwd: process.env.HOME,
});
const client = new Client({ name: "gf-flow-test", version: "0.0.1" });
await client.connect(transport);

async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])
    .map((c) => c.text)
    .join("\n");
  console.log(`\n[${name}]${r.isError ? " ⚠ isError" : ""}\n${text}`);
  return text;
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

// 1. CREATE — server spawned with cwd=$HOME, so this must land on ~/Desktop
await call("goodfolder_create", { name: NAME });
const desktopDir = `${process.env.HOME}/Desktop/${NAME}`;
console.log("\nDesktop folder exists:", existsSync(desktopDir) ? "YES" : "NO");

// 2. WRITE + SAVE (agent writes its own label)
sh(`echo "hello from the agent flow" > '${desktopDir}/note.md'`);
await call("goodfolder_save", {
  folder: desktopDir,
  label: "Wrote the first hello note",
});

// 3. CLONE to /tmp — resolve name->id like a real agent would, using this
// machine's approved account credential
const acct = loadAccountToken();
if (!acct) throw new Error("No approved account on this machine — run goodfolder login");
const projects: { id: string; name: string; createdAt?: string }[] = await (
  await fetch("https://api.trygoodfolder.com/api/projects", {
    headers: { authorization: `Bearer ${acct}` },
  })
).json();
const mine = projects.filter((p) => p.name === NAME).sort(
  (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
)[0]!;
await call("goodfolder_clone", { query: mine.id, destination: "/tmp" });
const cloneDir = `/tmp/${NAME}`;
const orig = sh(`cat '${desktopDir}/note.md'`);
const cloned = sh(`cat '${cloneDir}/note.md'`);
console.log("\nbyte-identical after clone:", orig === cloned ? "YES" : "NO");

// 4. Edit + save from the CLONE, then sync the ORIGINAL
sh(`echo "edited from the second device" >> '${cloneDir}/note.md'`);
await call("goodfolder_save", {
  folder: cloneDir,
  label: "Second device added a line",
});
await call("goodfolder_sync", { folder: desktopDir });

// 5. Convergence check
const origAfter = sh(`cat '${desktopDir}/note.md'`);
const cloneAfter = sh(`cat '${cloneDir}/note.md'`);
console.log("\nconverged:", origAfter === cloneAfter ? "YES" : "NO");
console.log("--- shared content ---");
console.log(origAfter);

await call("goodfolder_log", { folder: desktopDir });
await client.close();
