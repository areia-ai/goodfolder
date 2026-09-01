// The dashboard's WebMCP tools, captured as a plain schema an LLM would see.
//
// `registerDashboardTools` builds every tool inline against a live
// `document.modelContext`. This module runs that same registration against an
// in-memory collector so the exact name, description, and input schema of each
// tool can be written to `webmcp.schema.json` and fed to Google's
// `webmcp-evals local` runner — no browser, no sign-in, no network.
//
// `webmcp.evals.test.ts` regenerates this in memory and fails when the checked-in
// file drifts. `tools/gen-webmcp-schema.ts` writes the file.

import {
  registerDashboardTools,
  unregisterDashboardTools,
  webMcpRegistrationState,
} from "./webmcp.ts";

export interface WebMcpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface WebMcpSchemaFile {
  // A short note so a reader of the raw file knows it is generated.
  $generatedBy: string;
  tools: WebMcpToolSchema[];
}

const GENERATED_BY =
  "apps/web/lib/webmcp-schema.ts — run `pnpm webmcp:schema` after changing a tool";

function captureTool(tool: Record<string, unknown>): WebMcpToolSchema {
  const inputSchema = (tool.inputSchema ?? tool.parameters ?? {}) as Record<string, unknown>;
  const annotations = tool.annotations as Record<string, unknown> | undefined;
  return {
    name: String(tool.name ?? ""),
    description: String(tool.description ?? ""),
    inputSchema,
    ...(annotations ? { annotations } : {}),
  };
}

/**
 * Register every dashboard tool against a fake `modelContext`, collect the tool
 * definitions, then tear the registration down. Tools are returned sorted by
 * name so the generated file has a stable diff.
 */
export async function collectDashboardToolSchemas(): Promise<WebMcpToolSchema[]> {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const collected: WebMcpToolSchema[] = [];
  const fakeContext = {
    registerTool: (tool: Record<string, unknown>) => {
      collected.push(captureTool(tool));
    },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: fakeContext, body: { dataset: {} } },
  });
  try {
    await registerDashboardTools();
    if (webMcpRegistrationState().status === "error") {
      throw new Error(webMcpRegistrationState().error ?? "WebMCP registration failed");
    }
  } finally {
    await unregisterDashboardTools();
    if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
  }
  return collected.sort((a, b) => a.name.localeCompare(b.name));
}

export async function buildWebMcpSchemaFile(): Promise<WebMcpSchemaFile> {
  return { $generatedBy: GENERATED_BY, tools: await collectDashboardToolSchemas() };
}

/** Canonical JSON text for the schema file, newline-terminated. */
export async function renderWebMcpSchemaFile(): Promise<string> {
  return `${JSON.stringify(await buildWebMcpSchemaFile(), null, 2)}\n`;
}
