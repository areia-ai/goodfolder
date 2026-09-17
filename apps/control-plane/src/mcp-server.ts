import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  resolveAuthContext,
  tokenFromAuthHeader,
  type ServiceScope,
  type Sql,
} from "@goodfolder/serverlib";
import {
  applyRevert,
  findFolder,
  latestSave,
  loadSave,
  loadTimeline,
  previewRevert,
  recordRemoteSave,
  runnerRun,
  type RemoteCaller,
  type RemoteDeps,
  type TimelineRow,
  type TreeChange,
} from "./remote.ts";

/**
 * The hosted tool surface (2026-09-17).
 *
 * The same nine shapes the local server offers, answered from the control
 * plane so an assistant that never touches the person's computer can still
 * list folders, read a timeline, record a save, and bring a folder back to
 * an earlier one. Nothing here is a second implementation of the verbs:
 * every call lands in the functions the REST routes use, under the same
 * scope checks.
 *
 * Transport is MCP Streamable HTTP in its stateless mode: one request, one
 * tool call, no session to keep or expire. Auth is the same bearer the REST
 * API takes.
 */

export interface McpServices {
  deps: RemoteDeps;
  /** Absolute origin, shown in the address remote tools print. */
  publicBase: string;
  createFolder: (
    caller: RemoteCaller,
    name: string,
  ) => Promise<{ projectId: string; name: string } | { error: string }>;
  renameFolder: (
    caller: RemoteCaller,
    projectId: string,
    name: string,
  ) => Promise<{ ok: true } | { error: string }>;
  /** The device row a save from this caller should be attributed to. */
  deviceFor: (caller: RemoteCaller, projectId: string) => Promise<string>;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

function failed(value: string): ToolResult {
  return { content: [{ type: "text", text: value }], isError: true };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function describeChanges(changes: readonly TreeChange[]): string {
  if (changes.length === 0) return "No files changed.";
  const shown = changes.slice(0, 40);
  const lines = shown.map((change) => {
    const mark = change.kind === "added" ? "added" : change.kind === "removed" ? "removed" : "changed";
    return `- ${mark}: ${change.path}`;
  });
  if (changes.length > shown.length) lines.push(`… and ${changes.length - shown.length} more`);
  return lines.join("\n");
}

function timelineText(rows: TimelineRow[]): string {
  if (rows.length === 0) return "Nothing has been saved in this folder yet.";
  return rows
    .map((row) => {
      const when = row.createdAt.slice(0, 10);
      const who = row.harness ?? row.deviceName ?? "a person";
      const counts =
        row.addedCount || row.changedCount || row.removedCount
          ? ` (+${row.addedCount} ~${row.changedCount} -${row.removedCount})`
          : "";
      return `#${row.seq}  ${when}  ${row.label}${counts}  — ${who}`;
    })
    .join("\n");
}

/**
 * The caller for a request to this endpoint, or a refusal. Account
 * credentials unlock everything an account can do; a scoped credential is
 * limited to its scopes and its folder. A folder's own transport credential
 * is refused — it is for one folder's file transfer, not for managing an
 * account through a tool surface.
 */
export async function resolveMcpCaller(
  sql: Sql,
  req: IncomingMessage,
): Promise<
  | { ok: true; caller: RemoteCaller; scopes: ServiceScope[] | "account"; credentialId: string | null }
  | { ok: false; status: number; message: string }
> {
  const raw = tokenFromAuthHeader(req.headers.authorization);
  if (!raw) return { ok: false, status: 401, message: "A GoodFolder access key is required." };
  const ctx = await resolveAuthContext(sql, raw);
  if (!ctx) return { ok: false, status: 401, message: "That access key is not valid." };
  if (ctx.kind === "project") {
    return {
      ok: false,
      status: 403,
      message: "This endpoint takes an account approval or a service access key, not a folder's own credential.",
    };
  }
  if (ctx.kind === "account") {
    return {
      ok: true,
      caller: { kind: "account", accountId: ctx.accountId, email: ctx.email, boundProjectId: null },
      scopes: "account",
      credentialId: null,
    };
  }
  return {
    ok: true,
    caller: {
      kind: "service",
      accountId: ctx.accountId,
      email: ctx.email,
      boundProjectId: ctx.projectId,
      serviceName: ctx.name,
      credentialId: ctx.credentialId,
    },
    scopes: ctx.scopes,
    credentialId: ctx.credentialId,
  };
}

class Refusal extends Error {}

export interface McpAuth {
  caller: RemoteCaller;
  scopes: ServiceScope[] | "account";
  credentialId: string | null;
}

/** Built per request; exported so the tool surface can be driven in tests. */
export function buildServer(services: McpServices, auth: McpAuth): McpServer {
  const { caller } = auth;
  const accountLevel = auth.scopes === "account";
  const server = new McpServer({ name: "goodfolder", version: "0.1.2" });

  /** The sentence a service should read when a scope is missing. */
  function requireScope(scope: ServiceScope, projectId?: string | null): void {
    if (accountLevel) return;
    if (!auth.scopes.includes(scope)) {
      throw new Refusal(`This access key was not approved for “${scope}”. Ask the folder's owner for a key that includes it.`);
    }
    if (caller.boundProjectId && projectId && caller.boundProjectId !== projectId) {
      throw new Refusal("This access key belongs to a different folder.");
    }
  }

  async function folderFor(query: string): Promise<{ id: string; name: string }> {
    const found = await findFolder(services.deps, caller, query);
    if (!found) throw new Refusal(`No folder called “${query}” on this account.`);
    if (found.kind === "many") {
      const list = found.folders.map((f) => `“${f.name}” (${f.id})`).join(", ");
      throw new Refusal(`More than one folder matches. Use the id: ${list}.`);
    }
    return found;
  }

  async function runnerFor(projectId: string): Promise<string> {
    return services.deviceFor(caller, projectId);
  }

  async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Refusal) return failed(error.message);
      console.error("hosted tool failed:", error);
      return failed("That request could not be completed. Try again.");
    }
  }

  server.tool(
    "goodfolder_create",
    "Start a brand-new GoodFolder on the approved account. Returns the folder's id — add files to it over its address, then record a save. No folder is written on any computer; this surface works in the cloud.",
    {
      name: z.string().describe("A short name for the new folder, e.g. 'Trip Planning'"),
      destination: z
        .string()
        .optional()
        .describe("Accepted for compatibility; a hosted call writes nothing to a computer"),
    },
    async ({ name }) => {
      if (!accountLevel) {
        return failed("Creating folders needs an account approval; a scoped access key cannot do it.");
      }
      const created = await services.createFolder(caller, name);
      if ("error" in created) return failed(created.error);
      return text(
        [
          `Created “${created.name}”.`,
          `Folder id: ${created.projectId}`,
          `Address: ${services.publicBase}/git/${created.projectId}`,
          "Send its files, then call goodfolder_save to record the first save.",
        ].join("\n"),
      );
    },
  );

  server.tool(
    "goodfolder_clone",
    "Find a folder by name or id and get the address a cloud assistant can download it from, plus where its timeline stands. Use goodfolder_create instead if the folder doesn't exist yet.",
    {
      query: z.string().describe("The folder's name or id"),
      destination: z
        .string()
        .optional()
        .describe("Accepted for compatibility; a hosted call writes nothing to a computer"),
    },
    async ({ query }) =>
      guard(async () => {
        requireScope("read:folders");
        const folder = await folderFor(query);
        const [latest, head] = await Promise.all([
          latestSave(services.deps, folder.id),
          services.deps.repos.head(folder.id),
        ]);
        return text(
          [
            folder.name,
            `Folder id: ${folder.id}`,
            `Address: ${services.publicBase}/git/${folder.id}`,
            latest ? `Latest save: #${latest.seq} — ${latest.label}` : "No saves yet.",
            head ? "" : "The folder is empty.",
            "Use your access key as the password when you download it. When your changes have landed, call goodfolder_save to record them.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }),
  );

  server.tool(
    "goodfolder_connect",
    "A folder on GoodFolder is already connected. This returns its address and where its timeline stands, so a cloud assistant can download it.",
    {
      folder: z.string().describe("The folder's name or id"),
    },
    async ({ folder }) =>
      guard(async () => {
        requireScope("read:folders");
        const found = await folderFor(folder);
        const latest = await latestSave(services.deps, found.id);
        return text(
          [
            `“${found.name}” is connected to GoodFolder.`,
            `Folder id: ${found.id}`,
            `Address: ${services.publicBase}/git/${found.id}`,
            latest ? `Latest save: #${latest.seq} — ${latest.label}` : "No saves yet.",
          ].join("\n"),
        );
      }),
  );

  server.tool(
    "goodfolder_rename",
    "Change the name shown for a folder. Use only when the user explicitly asks to rename it.",
    {
      folder: z.string().describe("The folder's name or id"),
      name: z.string().describe("The new name exactly as the user requested it"),
    },
    async ({ folder, name }) =>
      guard(async () => {
        if (!accountLevel) return failed("Renaming needs an account approval; a scoped access key cannot do it.");
        const found = await folderFor(folder);
        const renamed = await services.renameFolder(caller, found.id, name);
        if ("error" in renamed) return failed(renamed.error);
        return text(`Renamed to “${name}”.`);
      }),
  );

  server.tool(
    "goodfolder_save",
    "Record a save for the folder's current state, after changes from this session have landed. The timeline gets a plain-language receipt with every path that changed; nothing already protected is lost. Pass a short label if you have seen what changed.",
    {
      folder: z.string().describe("The folder's name or id"),
      label: z
        .string()
        .optional()
        .describe("Short plain-language description of what changed, e.g. 'Added trip photos and updated itinerary'"),
    },
    async ({ folder, label }) =>
      guard(async () => {
        const found = await folderFor(folder);
        requireScope("git:write", found.id);
        const deviceId = await runnerFor(found.id);
        const outcome = await recordRemoteSave(services.deps, {
          projectId: found.id,
          accountId: caller.accountId,
          actorDeviceId: deviceId,
          actorName: caller.serviceName ?? "GoodFolder web",
          ...(label ? { label } : {}),
          harness: caller.serviceName ?? null,
        });
        if (outcome.status === "refused") return failed(outcome.message);
        if (outcome.status === "unchanged") {
          return text(`“${found.name}” already matches its latest save (#${outcome.seq}). Nothing new to record.`);
        }
        return text(
          [
            `Saved “${found.name}” as #${outcome.seq} — ${outcome.label}`,
            `${plural(outcome.changes.length, "file")} changed:`,
            describeChanges(outcome.changes),
          ].join("\n"),
        );
      }),
  );

  server.tool(
    "goodfolder_sync",
    "See where the folder stands — its latest save, how many saves exist, and the address to download the newest state from.",
    {
      folder: z.string().describe("The folder's name or id"),
    },
    async ({ folder }) =>
      guard(async () => {
        const found = await folderFor(folder);
        requireScope("git:read", found.id);
        const [rows, head] = await Promise.all([
          loadTimeline(services.deps, found.id, 5),
          services.deps.repos.head(found.id),
        ]);
        const latest = rows[0] ?? null;
        return text(
          [
            `“${found.name}”`,
            `Address: ${services.publicBase}/git/${found.id}`,
            latest ? `Latest save: #${latest.seq} — ${latest.label}` : "No saves yet.",
            head && latest && head === latest.commitSha ? "Nothing newer has been saved." : "Newer work may be waiting.",
            "Download from the address to bring your copy up to date.",
          ].join("\n"),
        );
      }),
  );

  server.tool(
    "goodfolder_log",
    "List the folder's timeline: numbered saves with dates and plain-language labels. The numbers are used for restore.",
    {
      folder: z.string().describe("The folder's name or id"),
    },
    async ({ folder }) =>
      guard(async () => {
        requireScope("read:folders");
        const found = await folderFor(folder);
        return text(timelineText(await loadTimeline(services.deps, found.id, 50)));
      }),
  );

  server.tool(
    "goodfolder_restore",
    "Bring the folder back to an earlier numbered save. Nothing is destroyed — the return is recorded as a new save that matches the old one, so it can itself be undone.",
    {
      folder: z.string().describe("The folder's name or id"),
      seq: z.number().int().describe("Save number from goodfolder_log"),
    },
    async ({ folder, seq }) =>
      guard(async () => {
        const found = await folderFor(folder);
        requireScope("git:write", found.id);
        const target = await loadSave(services.deps, found.id, seq);
        if (!target) return failed(`There is no save #${seq} in this folder. Use goodfolder_log to see the numbers.`);
        const deviceId = await runnerFor(found.id);
        const outcome = await applyRevert(services.deps, {
          projectId: found.id,
          accountId: caller.accountId,
          actorDeviceId: deviceId,
          actorName: caller.serviceName ?? "GoodFolder web",
          target,
          label: `Restored save #${target.seq}: ${target.label}`.slice(0, 110),
          harness: caller.serviceName ?? null,
        });
        if (outcome.status === "refused") return failed(outcome.message);
        if (outcome.status === "unchanged") {
          return text(`“${found.name}” already matches save #${target.seq}. Nothing changed.`);
        }
        return text(
          [
            `“${found.name}” now matches save #${target.seq}. Recorded as #${outcome.seq}.`,
            `${plural(outcome.changes.length, "file")} changed:`,
            describeChanges(outcome.changes),
          ].join("\n"),
        );
      }),
  );

  server.tool(
    "goodfolder_undo",
    "Undo the folder's most recent save, or the whole run of the last same-agent saves. Preview-first: call with confirm=false (the default) to see exactly what would change, then call again with confirm=true to do it. The undo lands as a new save and can itself be undone.",
    {
      folder: z.string().describe("The folder's name or id"),
      confirm: z.boolean().optional().describe("false (default) previews only; true performs the undo"),
      session: z
        .boolean()
        .optional()
        .describe("Undo the whole contiguous run of saves by the same agent, not just the last one"),
    },
    async ({ folder, confirm, session }) =>
      guard(async () => {
        const found = await folderFor(folder);
        // The scope is checked before any work: a preview is a read, acting
        // is a write, and a key without the right half hears so first.
        requireScope(confirm === true ? "git:write" : "git:read", found.id);
        const rows = await loadTimeline(services.deps, found.id, 50);
        if (rows.length === 0) return failed("Nothing has been saved in this folder yet, so there is nothing to undo.");
        const len = session ? runnerRun(rows) : 1;
        const scope = rows.slice(0, len);
        const top = scope[0]!;
        if (session && caller.kind === "service" && top.harness !== null && top.harness !== caller.serviceName) {
          return failed(`The most recent saves were made by ${top.harness}, not by this key. Undo those from that assistant.`);
        }
        const targetRow = rows[len];
        if (!targetRow) {
          return failed("That would undo every save this folder has; there would be nothing left to return to.");
        }
        const target = { seq: targetRow.seq, label: targetRow.label, commitSha: targetRow.commitSha };
        const preview = await previewRevert(services.deps, found.id, target);
        if (preview.status === "unchanged") {
          return text(`“${found.name}” already matches save #${target.seq}. Nothing to undo.`);
        }
        const label =
          len === 1
            ? `Undid save #${top.seq} — ${top.label}`.slice(0, 110)
            : `Undid ${len} saves (#${scope[scope.length - 1]!.seq}–#${top.seq})`;
        if (confirm !== true) {
          return text(
            [
              len === 1
                ? `This undoes the last save (#${top.seq})${top.label ? `: “${top.label}”` : ""}.`
                : `This undoes the ${len} most recent saves (#${scope[scope.length - 1]!.seq} through #${top.seq}).`,
              `Bringing the folder back to save #${target.seq} (${target.label}) would change ${plural(preview.changes.length, "file")}:`,
              describeChanges(preview.changes),
              "Nothing has been changed yet. Call again with confirm=true to do it.",
            ].join("\n"),
          );
        }
        const deviceId = await runnerFor(found.id);
        const outcome = await applyRevert(services.deps, {
          projectId: found.id,
          accountId: caller.accountId,
          actorDeviceId: deviceId,
          actorName: caller.serviceName ?? "GoodFolder web",
          target,
          label,
          harness: caller.serviceName ?? null,
          changes: preview.changes,
        });
        if (outcome.status === "refused") return failed(outcome.message);
        if (outcome.status === "unchanged") {
          return text(`“${found.name}” already matches save #${target.seq}. Nothing to undo.`);
        }
        return text(
          `Undone. “${found.name}” now matches save #${target.seq}; recorded as #${outcome.seq}.\n${describeChanges(outcome.changes)}`,
        );
      }),
  );

  return server;
}

/** Handle one Streamable HTTP request: auth first, then a stateless MCP run. */
export async function handleMcpRequest(
  services: McpServices,
  sql: Sql,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const auth = await resolveMcpCaller(sql, req);
  if (!auth.ok) {
    res.writeHead(auth.status, {
      "content-type": "application/json",
      "www-authenticate": 'Bearer realm="GoodFolder"',
    });
    res.end(JSON.stringify({ error: { code: "unauthorized", message: auth.message } }));
    return;
  }
  const server = buildServer(services, auth);
  // No session id generator: stateless mode, one call per request.
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport as unknown as Parameters<McpServer["connect"]>[0]);
  await transport.handleRequest(req, res);
}
