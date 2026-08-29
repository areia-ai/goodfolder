// Test harness: spawns the GoodFolder MCP server and exercises every tool
// against production. Run: node --experimental-transform-types test-mcp.mts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execSync } from "node:child_process";

const SERVER = new URL("./src/index.ts", import.meta.url).pathname;
const FOLDER = process.argv[2];
if (!FOLDER) {
  console.error("usage: node --experimental-transform-types test-mcp.mts <connected-folder>");
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["--experimental-transform-types", SERVER],
});
const client = new Client({ name: "gf-test", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])
    .map((c) => c.text)
    .join("\n");
  console.log(`\n[${name}]${r.isError ? " (isError)" : ""}`);
  console.log(text);
  return { text, isError: !!r.isError };
}

await call("goodfolder_log", { folder: FOLDER });

execSync(`echo "agent edit ${Date.now()}" >> ${FOLDER}/from-agent.md`);
await call("goodfolder_save", {
  folder: FOLDER,
  label: "Added an agent-written scratch note",
});

await call("goodfolder_sync", { folder: FOLDER });

const log = await call("goodfolder_log", { folder: FOLDER });
console.log("\nRESULT:", log.isError ? "FAILED" : "ALL_TOOLS_OK");

await client.close();
