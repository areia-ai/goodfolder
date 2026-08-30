#!/usr/bin/env node
// GoodFolder MCP server — lets coding agents (Claude Code, Codex, OpenCode)
// save, sync, restore, and read a folder's timeline as tool calls.
//
// Tools wrap the same command functions the CLI uses; failures come back as
// readable text (isError), never as crashes. Git stays invisible.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { cmdConnect, requireConnection } from "../../cli/src/connect.ts";
import { cmdSave } from "../../cli/src/save.ts";
import { cmdSync } from "../../cli/src/sync.ts";
import { cmdRestore } from "../../cli/src/restore.ts";
import { cmdUndo } from "../../cli/src/undo.ts";
import { cmdLog } from "../../cli/src/log.ts";
import { cmdCreate } from "../../cli/src/create.ts";
import { cmdClone } from "../../cli/src/clone.ts";

/** Capture console output of a command so it can be returned as tool text. */
async function run(fn: () => Promise<void> | void): Promise<{
  text: string;
  error?: string;
}> {
  const lines: string[] = [];
  const log = console.log;
  const warn = console.warn;
  const err = console.error;
  const push =
    (prefix: string) =>
    (...args: unknown[]) => {
      lines.push(prefix + args.map(String).join(" "));
    };
  console.log = push("");
  console.warn = push("⚠ ");
  console.error = push("");
  try {
    await fn();
    return { text: lines.join("\n").trim() || "Done." };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (lines.length) lines.push(msg);
    return { text: lines.join("\n").trim() || msg, error: msg };
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = err;
  }
}

const server = new McpServer({
  name: "goodfolder",
  version: "0.1.0",
});

/**
 * Harness attribution for save receipts: the MCP handshake tells us which
 * agent is calling (Claude Code, Codex, …). Free provenance — the timeline
 * reads "saved by Codex" without anyone configuring anything.
 */
function clientHarness(): string | undefined {
  try {
    const info = (server as unknown as { server?: { getClientVersion?: () => { name?: string } | undefined } })
      .server?.getClientVersion?.();
    return info?.name ? String(info.name).slice(0, 40) : undefined;
  } catch {
    return undefined;
  }
}

server.tool(
  "goodfolder_create",
  "Start a brand-new GoodFolder from nothing: creates the project on GoodFolder AND materializes an empty folder on this machine (on the user's Desktop by default when working from home; otherwise beside the current directory). Returns the new folder's path — write files into it, then call goodfolder_save.",
  {
    name: z.string().describe("A short name for the new folder, e.g. 'Trip Planning'"),
    destination: z
      .string()
      .optional()
      .describe("Parent directory to create it in (default: Desktop or cwd)"),
  },
  async ({ name, destination }) => {
    const r = await run(async () => { await cmdCreate(name, { dest: destination }); });
    return { content: [{ type: "text", text: r.text }], isError: !!r.error };
  },
);

server.tool(
  "goodfolder_clone",
  "Download an existing GoodFolder to this machine, fully up to date, by its friendly name. Use goodfolder_create instead if the project doesn't exist yet.",
  {
    query: z.string().describe("The GoodFolder's name"),
    destination: z
      .string()
      .optional()
      .describe("Parent directory to place it in (default: Desktop or cwd)"),
  },
  async ({ query, destination }) => {
    const r = await run(async () => { await cmdClone(query, { dest: destination }); });
    return { content: [{ type: "text", text: r.text }], isError: !!r.error };
  },
);

server.tool(
  "goodfolder_connect",
  "Connect a folder to GoodFolder so every future change can be saved, synced across devices, and restored. Safe to run on any folder; runs once and changes nothing you can see.",
  {
    folder: z.string().describe("Absolute path to the folder to connect"),
    name: z.string().optional().describe("A friendly name for the project"),
  },
  async ({ folder, name }) => {
    const r = await run(() => cmdConnect(folder, { name }));
    return { content: [{ type: "text", text: r.text }], isError: !!r.error };
  },
);

server.tool(
  "goodfolder_save",
  "Save the folder's work — safe to run anytime, nothing already protected is ever lost. Downloaded packages, rebuilt output and files that look like they hold passwords or keys are left out by default; the reply names what stayed out. If the caller has seen what changed, pass a short plain-language label describing it (max ~10 words); otherwise one is generated automatically.",
  {
    folder: z.string().describe("Absolute path to the connected folder"),
    label: z
      .string()
      .optional()
      .describe(
        "Short plain-language description of what changed, e.g. 'Added trip photos and updated itinerary'",
      ),
  },
  async ({ folder, label }) => {
    const { cfg } = requireConnection(folder);
    const r = await run(() =>
      cmdSave(folder, cfg, { message: label, harness: clientHarness() }),
    );
    return { content: [{ type: "text", text: r.text }], isError: !!r.error };
  },
);

server.tool(
  "goodfolder_sync",
  "Bring the folder up to date with changes saved from other devices or agents. Both versions are always kept if edits collide.",
  {
    folder: z.string().describe("Absolute path to the connected folder"),
  },
  async ({ folder }) => {
    const r = await run(() => cmdSync(folder, { harness: clientHarness() }));
    return { content: [{ type: "text", text: r.text }], isError: !!r.error };
  },
);

server.tool(
  "goodfolder_log",
  "List the folder's timeline: numbered saves with dates and plain-language labels. The numbers are used for restore.",
  {
    folder: z.string().describe("Absolute path to the connected folder"),
  },
  async ({ folder }) => {
    const r = await run(() => cmdLog(folder));
    return { content: [{ type: "text", text: r.text }], isError: !!r.error };
  },
);

server.tool(
  "goodfolder_restore",
  "Go back to an earlier numbered save. Nothing is destroyed — restoring creates a new save that matches the old one, so it can itself be undone.",
  {
    folder: z.string().describe("Absolute path to the connected folder"),
    seq: z.number().int().describe("Save number from goodfolder_log"),
  },
  async ({ folder, seq }) => {
    const r = await run(() =>
      cmdRestore(folder, String(seq), { harness: clientHarness() }),
    );
    return { content: [{ type: "text", text: r.text }], isError: !!r.error };
  },
);

server.tool(
  "goodfolder_undo",
  "Undo the folder's most recent save, or the whole run of the last same-agent saves. Preview-first: call with confirm=false (the default) to see exactly what would change, then call again with confirm=true to do it. The undo lands as a new save and can itself be undone; nothing is ever rewritten or lost. If the folder has unsaved edits, save them first — undo acts only on what the timeline shows.",
  {
    folder: z.string().describe("Absolute path to the connected folder"),
    confirm: z
      .boolean()
      .optional()
      .describe("false (default) previews only; true performs the undo"),
    session: z
      .boolean()
      .optional()
      .describe("Undo the whole contiguous run of saves by the same agent, not just the last one"),
  },
  async ({ folder, confirm, session }) => {
    const r = await run(() =>
      cmdUndo(folder, {
        previewOnly: confirm !== true,
        session: session === true,
        yes: true,
        harness: clientHarness(),
      }),
    );
    return { content: [{ type: "text", text: r.text }], isError: !!r.error };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
