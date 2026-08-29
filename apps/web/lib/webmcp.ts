// Site tools (WebMCP) for the GoodFolder dashboard.
//
// When a person opens this page in an agent-capable browser — ChatGPT's
// built-in browser or Chrome with WebMCP enabled — the tools below are
// discovered automatically by their AI assistant. Both the person and the
// agent then read the same live dashboard, authenticated by the same
// signed-in session. No install, no configuration.
//
// STANDING RULE: the read tools are read-only, and the proposal/comment tools
// only prepare work for a person. The web never accepts a proposal, saves a
// file, changes access, or acts on a working copy. Agents get eyes and can
// offer a bounded suggestion; the owner makes the file-changing decision.
//
// Browsers without WebMCP are unaffected: registration is feature-checked
// and silently skipped.

import {
  actorLabel,
  countsLabel,
  folderStatus,
  friendlyHarness,
  listFolders,
  listFiles,
  readFile,
  listProposals,
  createProposal,
  addProposalComment,
  addDocumentComment,
  listSaves,
  whenLabel,
  type Folder,
  type SaveRow,
} from "./gf-api.ts";
import {
  parseDelimitedTable,
  TABLE_COL_CAP,
  TABLE_EDIT_CAP,
  TABLE_ROW_CAP,
} from "./table.ts";

// ---------------------------------------------------------------------------
// Pure logic — unit-tested independently of any browser.
// ---------------------------------------------------------------------------

export interface CompactSave {
  number: number;
  label: string;
  when: string;
  actor: string | null;
  counts: string;
  topPaths: string[];
}

export function toCompactSave(s: SaveRow, now = Date.now()): CompactSave {
  return {
    number: s.seq,
    label: s.label,
    when: whenLabel(s.createdAt, now),
    actor: actorLabel(s),
    counts: countsLabel(s),
    topPaths: Array.isArray(s.topPaths) ? s.topPaths.slice(0, 5) : [],
  };
}

export function searchSaves(saves: SaveRow[], query: string, limit = 10): SaveRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = saves.filter((s) => {
    if (s.label.toLowerCase().includes(q)) return true;
    const paths = [
      ...(Array.isArray(s.topPaths) ? s.topPaths : []),
      ...(Array.isArray(s.changedPaths) ? s.changedPaths : []),
    ];
    return paths.some((p) => p.toLowerCase().includes(q));
  });
  return hits.slice(0, limit);
}

export interface RestorePreview {
  restoreNumber: number;
  restoreLabel: string;
  affectedFileCount: number;
  affectedFiles: string[];
  explanation: string;
  howToRestore: string;
  reversible: string;
}

/**
 * What going back to save #N would touch, derived from every save made
 * after it: their changed paths are exactly the files a restore rewrites.
 */
export function computeRestorePreview(
  savesNewestFirst: SaveRow[],
  number: number,
): RestorePreview | { error: string } {
  const target = savesNewestFirst.find((s) => s.seq === number);
  if (!target) return { error: `No save number ${number}. Read the timeline first and pick an existing number.` };
  const later = savesNewestFirst.filter((s) => s.seq > target!.seq);
  const affected = new Set<string>();
  let truncatedSource = false;
  for (const s of later) {
    if (s.changedPathsTruncated) truncatedSource = true;
    for (const p of Array.isArray(s.changedPaths) ? s.changedPaths : []) affected.add(p);
  }
  const files = [...affected].sort().slice(0, 50);
  const laterCount = later.length;
  return {
    restoreNumber: number,
    restoreLabel: target.label,
    affectedFileCount: affected.size,
    affectedFiles: files,
    explanation:
      affected.size === 0
        ? `Nothing has changed since save #${number} — the folder already matches it.`
        : `Since save #${number}, ${affected.size} file${affected.size === 1 ? " was" : "s were"} touched across ${laterCount} later save${laterCount === 1 ? "" : "s"}. Going back brings ${
            affected.size === 1 ? "it" : "all of them"
          } back to how it was then.${truncatedSource ? " (Some very large changes were only partially listed, so treat this as close to complete.)" : ""}`,
    howToRestore: `On any computer with this folder: run  goodfolder restore ${number}`,
    reversible: "Going back creates a new save itself, so even this can be undone.",
  };
}

export interface SaveExplanation {
  number: number;
  label: string;
  when: string;
  actor: string | null;
  counts: string;
  filesMentioned: string[];
  attention?: string;
}

export function explainSave(s: SaveRow, now = Date.now()): SaveExplanation {
  return {
    number: s.seq,
    label: s.label,
    when: whenLabel(s.createdAt, now),
    actor: actorLabel(s),
    counts: countsLabel(s),
    filesMentioned: Array.isArray(s.topPaths) ? s.topPaths : [],
    ...(s.collision && s.collision !== "none"
      ? { attention: "This save needed a human decision about conflicting versions." }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

interface AbortOptionsLike {
  signal?: AbortSignal;
}

interface ModelContextLike {
  registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<void> | void;
  unregisterTool?: (name: string) => Promise<void> | void;
}

export type WebMcpRegistrationState = {
  supported: boolean;
  status: "idle" | "unsupported" | "registered" | "already-registered" | "partial" | "error";
  toolNames: string[];
  error?: string;
};

const registrationState: WebMcpRegistrationState = {
  supported: false,
  status: "idle",
  toolNames: [],
};
const registrations = new WeakMap<object, Set<string>>();
const registrationControllers = new WeakMap<object, AbortController>();
const registrationPromises = new WeakMap<object, Promise<string[]>>();

const TOOL_TITLES: Record<string, string> = {
  list_folders: "List folders",
  get_workspace_context: "Read workspace context",
  list_files: "List files",
  read_document_outline: "Read document outline",
  read_selected_text: "Read selection",
  read_file_context: "Read file context",
  read_table_range: "Read table range",
  get_document_history: "Read document history",
  list_change_proposals: "List Change Proposals",
  explain_change_proposal: "Explain Change Proposal",
  propose_file_change: "Propose file change",
  propose_document_change: "Propose document change",
  comment_on_change_proposal: "Comment on Change Proposal",
  comment_on_document: "Comment on document",
  get_timeline: "Read timeline",
  find_saves: "Find saves",
  explain_save: "Explain save",
  preview_restore: "Preview going back",
};

function abortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("The WebMCP operation was aborted.", "AbortError");
  const error = new Error("The WebMCP operation was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(options?: AbortOptionsLike): void {
  if (options?.signal?.aborted) throw abortError();
}

async function waitWithAbort<T>(value: Promise<T> | T, signal?: AbortSignal): Promise<T> {
  throwIfAborted({ signal });
  if (!signal) return await value;
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(result);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function webMcpRegistrationState(): WebMcpRegistrationState {
  return { ...registrationState, toolNames: [...registrationState.toolNames] };
}

/** Feature check per the spec — never assume, never throw. */
export function webMcpSupported(): boolean {
  if (typeof document === "undefined") return false;
  const host = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
  return typeof host?.registerTool === "function";
}

async function modelContext(): Promise<ModelContextLike | null> {
  if (!webMcpSupported()) return null;
  return (document as unknown as { modelContext?: ModelContextLike }).modelContext ?? null;
}

const readOnly = { readOnlyHint: true, untrustedContentHint: true };
const proposesOnly = { readOnlyHint: false, untrustedContentHint: true };
const READ_CONTEXT_CHAR_CAP = 40_000;
const READ_CELL_CHAR_CAP = 2_000;

function pageState(): { folderId: string | null; file: string | null; proposalId: string | null } {
  if (typeof window === "undefined") return { folderId: null, file: null, proposalId: null };
  const q = new URLSearchParams(window.location.search);
  return { folderId: q.get("folder"), file: q.get("file"), proposalId: q.get("proposal") };
}

async function folderFromPage(): Promise<Folder | null> {
  const folders = await listFolders();
  const state = pageState();
  return folders.find((f) => f.id === state.folderId) ?? null;
}

function outlineOf(content: string): Array<{ level: number; title: string }> {
  return content.split("\n").flatMap((line) => {
    const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    return match ? [{ level: match[1]!.length, title: match[2]!.slice(0, 200) }] : [];
  }).slice(0, 100);
}

const objSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

function announceProposalCreated(detail: { folderId: string; path: string; proposalId: string }): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent("proposal-created", { detail }));
}

function tableColumnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

async function readFileContext(args: { document?: string; startLine?: number; lineCount?: number }): Promise<unknown> {
  const folder = await folderFromPage();
  const state = pageState();
  const documentPath = args.document ?? state.file;
  if (!folder || !documentPath) return { error: "Open a text file in a GoodFolder first." };
  const file = await readFile(folder.id, documentPath);
  if (typeof file.content !== "string") return { error: "This file can't be read in the dashboard." };
  const lines = file.content.split(/\r\n|\n|\r/);
  const startLine = Math.max(1, Math.min(TABLE_ROW_CAP * 10, Math.floor(Number(args.startLine) || 1)));
  const lineCount = Math.max(1, Math.min(200, Math.floor(Number(args.lineCount) || 80)));
  const end = Math.min(lines.length, startLine - 1 + lineCount);
  const selectedLines: Array<{ number: number; text: string }> = [];
  let used = 0;
  let textTruncated = false;
  for (let index = startLine - 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    const remaining = READ_CONTEXT_CHAR_CAP - used;
    if (remaining <= 0) {
      textTruncated = true;
      break;
    }
    if (line.length > remaining) {
      selectedLines.push({ number: index + 1, text: line.slice(0, remaining) });
      textTruncated = true;
      used = READ_CONTEXT_CHAR_CAP;
      break;
    }
    selectedLines.push({ number: index + 1, text: line });
    used += line.length;
  }
  return {
    folder: folder.name,
    document: documentPath,
    startLine,
    endLine: selectedLines.length ? selectedLines[selectedLines.length - 1]!.number : startLine - 1,
    totalLines: lines.length,
    truncated: textTruncated || end < lines.length,
    lines: selectedLines,
  };
}

async function readTableRange(args: {
  document?: string;
  startRow?: number;
  startColumn?: number;
  rowCount?: number;
  columnCount?: number;
}): Promise<unknown> {
  const folder = await folderFromPage();
  const state = pageState();
  const documentPath = args.document ?? state.file;
  if (!folder || !documentPath) return { error: "Open a CSV or TSV file in a GoodFolder first." };
  if (!/\.(csv|tsv)$/i.test(documentPath)) return { error: "The structured range tool only reads CSV and TSV files." };
  const file = await readFile(folder.id, documentPath);
  if (typeof file.content !== "string") return { error: "This table can't be read in the dashboard." };
  const parsed = parseDelimitedTable(file.content, documentPath);
  if ("error" in parsed) return { error: parsed.message };
  const startRow = Math.max(1, Math.min(TABLE_ROW_CAP, Math.floor(Number(args.startRow) || 1)));
  const startColumn = Math.max(1, Math.min(TABLE_COL_CAP, Math.floor(Number(args.startColumn) || 1)));
  const rowCount = Math.max(1, Math.min(TABLE_ROW_CAP - startRow + 1, Math.floor(Number(args.rowCount) || 25)));
  const maxColumns = parsed.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columnCount = Math.max(1, Math.min(TABLE_COL_CAP - startColumn + 1, Math.floor(Number(args.columnCount) || Math.min(12, Math.max(1, maxColumns - startColumn + 1)))));
  const rows: Array<Array<{ address: string; value: string; valueTruncated?: boolean }>> = [];
  let used = 0;
  let valueTruncated = false;
  outer: for (let rowIndex = 0; rowIndex < Math.min(rowCount, Math.max(0, parsed.rows.length - startRow + 1)); rowIndex += 1) {
    const source = parsed.rows[startRow - 1 + rowIndex] ?? [];
    const outputRow: Array<{ address: string; value: string; valueTruncated?: boolean }> = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const rawValue = source[startColumn - 1 + columnIndex] ?? "";
      const remaining = READ_CONTEXT_CHAR_CAP - used;
      if (remaining <= 0) {
        valueTruncated = true;
        break outer;
      }
      const allowed = Math.min(READ_CELL_CHAR_CAP, remaining);
      const value = rawValue.slice(0, allowed);
      const cellWasTruncated = value.length < rawValue.length;
      outputRow.push({
        address: `${tableColumnName(startColumn - 1 + columnIndex)}${startRow + rowIndex}`,
        value,
        ...(cellWasTruncated ? { valueTruncated: true } : {}),
      });
      used += value.length;
      if (cellWasTruncated) valueTruncated = true;
    }
    rows.push(outputRow);
  }
  return {
    folder: folder.name,
    document: documentPath,
    startRow,
    startColumn,
    rowCount: rows.length,
    columnCount,
    delimiter: parsed.delimiter === "\t" ? "tab" : "comma",
    rows,
    truncated: valueTruncated || parsed.rows.length > startRow - 1 + rows.length || maxColumns > startColumn - 1 + columnCount,
  };
}

type ProposeFileChangeArgs = {
  document: string;
  operation: "text_replace" | "table_update" | "asset_replace";
  section?: string;
  originalText?: string;
  replacementText?: string;
  changes?: Array<{ address: string; before: string; replacement: string }>;
  stagingAssetId?: string;
  mimeType?: string;
  extension?: string;
  explanation: string;
  title: string;
};

async function proposeFileChange(args: ProposeFileChangeArgs): Promise<unknown> {
  try {
    const input = args && typeof args === "object" ? args : {} as ProposeFileChangeArgs;
    const documentPath = typeof input.document === "string" ? input.document : "";
    const operation = input.operation;
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";
    const originalText = typeof input.originalText === "string" ? input.originalText : undefined;
    const replacementText = typeof input.replacementText === "string" ? input.replacementText : undefined;
    const changes = Array.isArray(input.changes) ? input.changes : [];
    const folder = await folderFromPage();
    if (!folder) return { error: "Open a folder first." };
    if (!(["text_replace", "table_update", "asset_replace"] as string[]).includes(operation)) {
      return { error: "Choose text_replace, table_update, or asset_replace." };
    }
    if (!documentPath || documentPath.length > 512 || !title || title.length > 120 || !explanation || explanation.length > 500) {
      return { error: "Give the proposal a safe file path, a short title, and a short explanation." };
    }
    const files = await listFiles(folder.id);
    const file = files.files.find((item) => item.path === documentPath);
    if (!file) return { error: "Choose a file from the currently open GoodFolder." };
    if (operation !== "asset_replace" && !file.editable) return { error: "Choose an editable Markdown, text, CSV, or TSV file." };
    if (operation === "asset_replace" && !file.previewable) return { error: "Choose a previewable file for a temporary uploaded replacement." };
    if (operation === "text_replace") {
      if (typeof originalText !== "string" || typeof replacementText !== "string" || originalText.length > 20_000 || replacementText.length > 20_000) {
        return { error: "Text replacements need exact passages under 20,000 characters." };
      }
    }
    if (operation === "table_update") {
      if (!/\.(csv|tsv)$/i.test(documentPath) || changes.length < 1 || changes.length > TABLE_EDIT_CAP) {
        return { error: `Table updates need 1-${TABLE_EDIT_CAP} CSV/TSV cell changes.` };
      }
      if (changes.some((change) => {
        if (!change || typeof change !== "object") return true;
        const value = change as { address?: unknown; before?: unknown; replacement?: unknown };
        return typeof value.address !== "string" || !value.address.trim() || typeof value.before !== "string" || typeof value.replacement !== "string" || value.before.length > 20_000 || value.replacement.length > 20_000;
      })) {
        return { error: "Each table change needs a cell address and bounded values." };
      }
    }
    if (operation === "asset_replace" && (typeof input.stagingAssetId !== "string" || !input.stagingAssetId.trim())) return { error: "A temporary uploaded asset id is required for a binary replacement." };
    const result = await createProposal(folder.id, {
      title: title.slice(0, 120),
      explanation,
      baseHead: null,
      operation: {
        path: documentPath,
        kind: operation,
        section: typeof input.section === "string" ? input.section.trim().slice(0, 160) : undefined,
        before: originalText,
        replacement: replacementText,
        changes: operation === "table_update" ? changes as Array<{ address: string; before: string; replacement: string }> : undefined,
        stagingId: typeof input.stagingAssetId === "string" ? input.stagingAssetId.trim().slice(0, 200) : undefined,
        mimeType: typeof input.mimeType === "string" ? input.mimeType.trim().slice(0, 160) : undefined,
        extension: typeof input.extension === "string" ? input.extension.trim().slice(0, 20) : undefined,
        explanation,
      },
    });
    announceProposalCreated({ folderId: folder.id, path: documentPath, proposalId: result.proposalId });
    return {
      changedDocument: false,
      reviewRequired: true,
      baseCheckpointStampedByServer: true,
      folder: folder.name,
      document: documentPath,
      operation,
      proposalId: result.proposalId,
      proposalUrl: result.url,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Register every dashboard tool. Safe to call repeatedly on mount after sign-in. */
export async function registerDashboardTools(): Promise<string[]> {
  const rawMc = await modelContext();
  if (!rawMc?.registerTool) {
    registrationState.supported = false;
    registrationState.status = "unsupported";
    registrationState.toolNames = [];
    return [];
  }
  const contextKey = rawMc as object;
  const inFlight = registrationPromises.get(contextKey);
  if (inFlight) return inFlight;
  const registration = registerDashboardToolsForContext(rawMc);
  registrationPromises.set(contextKey, registration);
  try {
    return await registration;
  } finally {
    if (registrationPromises.get(contextKey) === registration) registrationPromises.delete(contextKey);
  }
}

async function registerDashboardToolsForContext(rawMc: ModelContextLike): Promise<string[]> {
  registrationState.supported = true;
  const toolNames = Object.keys(TOOL_TITLES);
  const contextKey = rawMc as object;
  const registered = registrations.get(contextKey) ?? new Set<string>();
  registrations.set(contextKey, registered);
  if (toolNames.every((name) => registered.has(name))) {
    registrationState.status = "already-registered";
    registrationState.toolNames = toolNames;
    registrationState.error = undefined;
    return toolNames;
  }

  const rawRegisterTool = rawMc.registerTool.bind(rawMc);
  const controller = registrationControllers.get(contextKey) ?? new AbortController();
  registrationControllers.set(contextKey, controller);
  const mc: ModelContextLike = {
    registerTool: async (tool) => {
      const name = String(tool.name ?? "");
      if (!name || registered.has(name)) return;
      const originalExecute = tool.execute as ((args: unknown, options?: AbortOptionsLike) => unknown) | undefined;
      const instrumented = {
        ...tool,
        title: typeof tool.title === "string" && tool.title ? tool.title : TOOL_TITLES[name] ?? name,
        ...(originalExecute
          ? {
              execute: async (args: unknown, options?: AbortOptionsLike) => {
                throwIfAborted(options);
                const result = await waitWithAbort(originalExecute(args, options), options?.signal);
                throwIfAborted(options);
                return result;
              },
            }
          : {}),
      };
      await rawRegisterTool(instrumented, { signal: controller.signal });
      registered.add(name);
    },
  };

  async function resolve(
    folderName?: string,
    full = false,
  ): Promise<{ name: string; saves: SaveRow[] } | { error: string }> {
    const folders = await listFolders();
    if (!folders.length) return { error: "No folders yet. Create one by telling your agent: “create a GoodFolder called …”" };
    let folder: Folder | undefined;
    if (!folderName) folder = folders[0];
    else
      folder = folders.find((f) => f.name.toLowerCase() === folderName.trim().toLowerCase());
    if (!folder) {
      return {
        error: `No folder called “${folderName}”. Available: ${folders.map((f) => f.name).join(", ")}`,
      };
    }
    const saves = await listSaves(folder.id, full);
    return { name: folder.name, saves };
  }

  try {
  await mc.registerTool({
    name: "list_folders",
    description:
      "List the person's GoodFolder folders with protection status and when each was last saved.",
    inputSchema: objSchema({}),
    annotations: readOnly,
    execute: async () => {
      try {
        const folders = await listFolders();
        const now = Date.now();
        return {
          count: folders.length,
          folders: folders.map((f) => ({
            name: f.name,
            status: folderStatus(f, now).text,
            lastSavedAt: f.lastSaveAt ?? null,
            totalSaves: f.lastSeq ?? 0,
          })),
        };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  await mc.registerTool({
    name: "get_workspace_context",
    description: "Read which GoodFolder, document, and Change Proposal the person currently has open.",
    inputSchema: objSchema({}), annotations: readOnly,
    execute: async () => {
      try {
        const folder = await folderFromPage();
        const state = pageState();
        return { folder: folder?.name ?? null, folderId: folder?.id ?? null, document: state.file, changeProposalId: state.proposalId };
      } catch (e) { return { error: (e as Error).message }; }
    },
  });

  await mc.registerTool({
    name: "list_files",
    description: "List every file in the GoodFolder currently open, including which documents can be read or edited in the dashboard.",
    inputSchema: objSchema({}), annotations: readOnly,
    execute: async () => {
      try {
        const folder = await folderFromPage();
        if (!folder) return { error: "Open a folder in the dashboard first." };
        const result = await listFiles(folder.id);
        return { folder: folder.name, total: result.files.length, files: result.files.map((f) => ({ path: f.path, size: f.size, readableHere: f.previewable, editableHere: f.editable })) };
      } catch (e) { return { error: (e as Error).message }; }
    },
  });

  await mc.registerTool({
    name: "read_document_outline",
    description: "Read the headings and structure of the document currently open. This does not change the document.",
    inputSchema: objSchema({}), annotations: readOnly,
    execute: async () => {
      try {
        const folder = await folderFromPage(); const state = pageState();
        if (!folder || !state.file) return { error: "Open a document in a GoodFolder first." };
        const file = await readFile(folder.id, state.file);
        if (typeof file.content !== "string") return { error: "This file can't be read in the dashboard." };
        return { folder: folder.name, document: state.file, outline: outlineOf(file.content) };
      } catch (e) { return { error: (e as Error).message }; }
    },
  });

  await mc.registerTool({
    name: "read_selected_text",
    description: "Read the passage the person has selected in the open document. Returns no text when there is no active selection.",
    inputSchema: objSchema({}), annotations: readOnly,
    execute: async () => {
      const state = pageState();
      const body = typeof document === "undefined" ? null : document.body;
      const cellAddress = body?.dataset.gfSelectedCellAddress ?? "";
      const cellValue = (body?.dataset.gfSelectedCellValue ?? "").slice(0, READ_CELL_CHAR_CAP);
      if (cellAddress) {
        const selectedText = `${cellAddress}: ${cellValue || "(empty)"}`.slice(0, 20_000);
        return { document: state.file, selectionKind: "cell", cell: { address: cellAddress, value: cellValue }, selectedText, hasSelection: true };
      }
      const selected = typeof window === "undefined" ? "" : (window.getSelection()?.toString() ?? "").slice(0, 20_000);
      return { document: state.file, selectionKind: selected ? "text" : null, selectedText: selected, hasSelection: selected.length > 0 };
    },
  });

  await mc.registerTool({
    name: "read_file_context",
    description: "Read a bounded line range from the open text file or a named text file. This never changes the file.",
    inputSchema: objSchema({
      document: { type: "string", description: "Optional file path; defaults to the file currently open." },
      startLine: { type: "number", description: "One-based first line, default 1." },
      lineCount: { type: "number", description: "Number of lines, default 80 and at most 200." },
    }),
    annotations: readOnly,
    execute: async (args: { document?: string; startLine?: number; lineCount?: number }) => {
      try { return await readFileContext(args); } catch (e) { return { error: (e as Error).message }; }
    },
  });

  await mc.registerTool({
    name: "read_table_range",
    description: "Read a bounded, structured range from a CSV or TSV file, including cell addresses and values. This never changes the table.",
    inputSchema: objSchema({
      document: { type: "string", description: "Optional CSV or TSV path; defaults to the file currently open." },
      startRow: { type: "number", description: "One-based first row, default 1 and at most 200." },
      startColumn: { type: "number", description: "One-based first column, default 1 and at most 40." },
      rowCount: { type: "number", description: "Number of rows, default 25." },
      columnCount: { type: "number", description: "Number of columns, default 12." },
    }),
    annotations: readOnly,
    execute: async (args: { document?: string; startRow?: number; startColumn?: number; rowCount?: number; columnCount?: number }) => {
      try { return await readTableRange(args); } catch (e) { return { error: (e as Error).message }; }
    },
  });

  await mc.registerTool({
    name: "get_document_history",
    description: "Read saves that mention the document currently open, newest first.",
    inputSchema: objSchema({ limit: { type: "number", description: "Maximum entries, default 10 and at most 25." } }), annotations: readOnly,
    execute: async (args: { limit?: number }) => {
      try {
        const folder = await folderFromPage(); const state = pageState();
        if (!folder || !state.file) return { error: "Open a document in a GoodFolder first." };
        const saves = await listSaves(folder.id, true);
        const limit = Math.max(1, Math.min(25, Math.floor(Number(args.limit) || 10)));
        return { folder: folder.name, document: state.file, saves: saves.filter((s) => [...(s.topPaths ?? []), ...(s.changedPaths ?? [])].includes(state.file!)).slice(0, limit).map((s) => toCompactSave(s)) };
      } catch (e) { return { error: (e as Error).message }; }
    },
  });

  await mc.registerTool({
    name: "list_change_proposals",
    description: "List Change Proposals for the GoodFolder currently open, including their review status and affected documents.",
    inputSchema: objSchema({ status: { type: "string", description: "Optional status: open, accepted, rejected, or needs-review." } }), annotations: readOnly,
    execute: async (args: { status?: string }) => {
      try {
        const folder = await folderFromPage(); if (!folder) return { error: "Open a folder first." };
        const result = await listProposals(folder.id);
        const proposals = args.status ? result.proposals.filter((p) => p.status === args.status) : result.proposals;
        return { folder: folder.name, proposals: proposals.map((p) => ({ id: p.id, title: p.title, author: p.authorEmail, status: p.status, documents: [...new Set(p.suggestions.map((s) => s.path))], suggestionCount: p.suggestions.length })) };
      } catch (e) { return { error: (e as Error).message }; }
    },
  });

  await mc.registerTool({
    name: "explain_change_proposal",
    description: "Explain one Change Proposal with the exact before and suggested text for human review.",
    inputSchema: objSchema({ proposalId: { type: "string", description: "Change Proposal id." } }, ["proposalId"]), annotations: readOnly,
    execute: async (args: { proposalId: string }) => {
      try {
        const folder = await folderFromPage(); if (!folder) return { error: "Open a folder first." };
        const result = await listProposals(folder.id); const proposal = result.proposals.find((p) => p.id === args.proposalId);
        if (!proposal) return { error: "Change Proposal not found in this folder." };
        return { folder: folder.name, ...proposal };
      } catch (e) { return { error: (e as Error).message }; }
    },
  });

  await mc.registerTool({
    name: "propose_file_change",
    description: "Create a reviewable one-file suggestion. Use text_replace for text, table_update for exact CSV/TSV cells, or asset_replace for a staged binary later. This never changes the file; only the folder owner can accept it.",
    inputSchema: objSchema({
      document: { type: "string", description: "Exact file path in the current GoodFolder." },
      operation: { type: "string", enum: ["text_replace", "table_update", "asset_replace"], description: "The kind of reviewable change." },
      section: { type: "string", description: "Optional named section or context for a text replacement." },
      originalText: { type: "string", description: "Exact current text for text_replace, at most 20,000 characters." },
      replacementText: { type: "string", description: "Suggested text for text_replace, at most 20,000 characters." },
      changes: {
        type: "array",
        maxItems: TABLE_EDIT_CAP,
        description: "Exact CSV/TSV cell changes for table_update.",
        items: { type: "object", properties: { address: { type: "string" }, before: { type: "string" }, replacement: { type: "string" } }, required: ["address", "before", "replacement"], additionalProperties: false },
      },
      stagingAssetId: { type: "string", description: "Short-lived temporary upload id for a later asset_replace operation." },
      mimeType: { type: "string", description: "Uploaded asset MIME type for a later asset_replace operation." },
      extension: { type: "string", description: "Uploaded asset extension for a later asset_replace operation." },
      explanation: { type: "string", description: "Why the change is useful, at most 500 characters." },
      title: { type: "string", description: "Short Change Proposal title." },
    }, ["document", "operation", "explanation", "title"]),
    annotations: proposesOnly,
    execute: async (args: ProposeFileChangeArgs) => proposeFileChange(args),
  });

  await mc.registerTool({
    name: "propose_document_change",
    description: "Compatibility alias for propose_file_change with the text_replace operation. This does not change the document; only the folder owner can accept it.",
    inputSchema: objSchema({
      document: { type: "string", description: "Document path in the current GoodFolder." },
      section: { type: "string", description: "Selected passage or named section." },
      originalText: { type: "string", description: "Exact current text, at most 20,000 characters." },
      replacementText: { type: "string", description: "Suggested replacement, at most 20,000 characters." },
      explanation: { type: "string", description: "Short reason for the suggestion, at most 500 characters." },
      title: { type: "string", description: "Short Change Proposal title." },
    }, ["document", "section", "originalText", "replacementText", "explanation", "title"]),
    annotations: proposesOnly,
    execute: async (args: { document: string; section: string; originalText: string; replacementText: string; explanation: string; title: string }) => {
      const result = await proposeFileChange({
        document: args.document,
        operation: "text_replace",
        section: args.section,
        originalText: args.originalText,
        replacementText: args.replacementText,
        explanation: args.explanation,
        title: args.title,
      });
      if (result && typeof result === "object" && "error" in result) return result;
      const proposal = result as { folder?: string; document?: string; proposalId?: string; proposalUrl?: string };
      return { ...result as object, section: args.section, before: args.originalText, suggested: args.replacementText, folder: proposal.folder, document: proposal.document, proposalId: proposal.proposalId, proposalUrl: proposal.proposalUrl };
    },
  });

  await mc.registerTool({
    name: "comment_on_change_proposal",
    description: "Add a comment to a Change Proposal for the people reviewing it. This adds discussion but does not change any document.",
    inputSchema: objSchema({ proposalId: { type: "string", description: "Change Proposal id." }, comment: { type: "string", description: "Comment, at most 4,000 characters." } }, ["proposalId", "comment"]), annotations: proposesOnly,
    execute: async (args: { proposalId: string; comment: string }) => {
      try { const folder = await folderFromPage(); if (!folder) return { error: "Open a folder first." }; if (!args.comment.trim() || args.comment.length > 4_000) return { error: "Write a shorter comment." }; await addProposalComment(folder.id, args.proposalId, args.comment); return { added: true, changedDocument: false, proposalId: args.proposalId }; } catch (e) { return { error: (e as Error).message }; }
    },
  });

  await mc.registerTool({
    name: "comment_on_document",
    description: "Leave a review comment on a selected passage in the open document. This does not change the document.",
    inputSchema: objSchema({ quotedText: { type: "string", description: "Exact selected passage, at most 20,000 characters." }, comment: { type: "string", description: "Comment, at most 4,000 characters." } }, ["quotedText", "comment"]), annotations: proposesOnly,
    execute: async (args: { quotedText: string; comment: string }) => {
      try {
        const folder = await folderFromPage(); const state = pageState();
        if (!folder || !state.file) return { error: "Open a document first." };
        if (!args.quotedText || args.quotedText.length > 20_000 || !args.comment.trim() || args.comment.length > 4_000) return { error: "Choose a smaller passage and write a shorter comment." };
        const result = await addDocumentComment(folder.id, state.file, args.comment, args.quotedText);
        return { added: true, changedDocument: false, commentId: result.commentId, folder: folder.name, document: state.file, quotedText: args.quotedText };
      } catch (e) { return { error: (e as Error).message }; }
    },
  });

  await mc.registerTool({
    name: "get_timeline",
    description:
      "Read a folder's timeline of saves, newest first. Each entry says who saved it, what changed in plain language, and which files mattered most.",
    inputSchema: objSchema({
      folder: { type: "string", description: "Folder name. Leave off for the first folder." },
      limit: { type: "number", description: "How many entries (default 10, max 25)." },
    }),
    annotations: readOnly,
    execute: async (args: { folder?: string; limit?: number }) => {
      try {
        const r = await resolve(args.folder);
        if ("error" in r) return r;
        const limit = Math.max(1, Math.min(25, Math.floor(Number(args.limit) || 10)));
        const now = Date.now();
        return {
          folder: r.name,
          saves: r.saves.slice(0, limit).map((s) => toCompactSave(s, now)),
        };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  await mc.registerTool({
    name: "find_saves",
    description:
      "Search one folder's timeline by text in a save's label or by file path. Answers like “when did we touch the invoice?”.",
    inputSchema: objSchema(
      {
        query: { type: "string", description: "Text to look for in labels or file paths." },
        folder: { type: "string", description: "Folder name. Leave off for the first folder." },
      },
      ["query"],
    ),
    annotations: readOnly,
    execute: async (args: { query: string; folder?: string }) => {
      try {
        const r = await resolve(args.folder);
        if ("error" in r) return r;
        const matches = searchSaves(r.saves, args.query).map((s) => toCompactSave(s));
        return { folder: r.name, query: args.query, matchCount: matches.length, matches };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  await mc.registerTool({
    name: "explain_save",
    description:
      "Explain one save in plain language: who made it, when, what changed, and which files were involved.",
    inputSchema: objSchema(
      {
        number: { type: "number", description: "The save's number from the timeline." },
        folder: { type: "string", description: "Folder name. Leave off for the first folder." },
      },
      ["number"],
    ),
    annotations: readOnly,
    execute: async (args: { number: number; folder?: string }) => {
      try {
        const n = Math.floor(Number(args.number));
        const r = await resolve(args.folder);
        if ("error" in r) return r;
        const target = r.saves.find((s) => s.seq === n);
        if (!target) return { error: `No save number ${n} in “${r.name}”.` };
        return { folder: r.name, ...explainSave(target) };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  await mc.registerTool({
    name: "preview_restore",
    description:
      "Preview going back to an earlier save: which files would be brought back, and the exact command to run on the person's computer. This never changes anything by itself.",
    inputSchema: objSchema(
      {
        number: { type: "number", description: "The save number to go back to." },
        folder: { type: "string", description: "Folder name. Leave off for the first folder." },
      },
      ["number"],
    ),
    annotations: readOnly,
    execute: async (args: { number: number; folder?: string }) => {
      try {
        const n = Math.floor(Number(args.number));
        const r = await resolve(args.folder, true);
        if ("error" in r) return r;
        const preview = computeRestorePreview(r.saves, n);
        return { folder: r.name, ...preview };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });

  registrationState.status = "registered";
  registrationState.toolNames = toolNames.filter((name) => registered.has(name));
  registrationState.error = undefined;
  return toolNames;
  } catch (e) {
    // A failed batch must not leave a half-registered set that a retry would
    // mistake for a complete registration. The compliant implementation
    // removes these tools when the registration signal is aborted.
    const hadPartialRegistration = registered.size > 0;
    controller.abort();
    registered.clear();
    registrations.delete(contextKey);
    registrationControllers.delete(contextKey);
    registrationState.status = hadPartialRegistration ? "partial" : "error";
    registrationState.toolNames = [];
    registrationState.error = (e as Error).message;
    throw e;
  }
}

/** Remove tools when the dashboard session ends, where the browser supports it. */
export async function unregisterDashboardTools(): Promise<void> {
  const mc = await modelContext();
  if (!mc) {
    registrationState.status = "idle";
    registrationState.toolNames = [];
    registrationState.error = undefined;
    return;
  }
  const registered = registrations.get(mc as object);
  const controller = registrationControllers.get(mc as object);
  controller?.abort();
  // The registration signal is the standards-based removal path. An optional
  // explicit remover lets test harnesses and browser extensions clean up too.
  if (!mc.unregisterTool) {
    registrations.delete(mc as object);
    registrationControllers.delete(mc as object);
    registrationState.status = "idle";
    registrationState.toolNames = [];
    return;
  }
  if (registered) {
    for (const name of registered) await mc.unregisterTool(name);
  }
  registrations.delete(mc as object);
  registrationControllers.delete(mc as object);
  registrationState.status = "idle";
  registrationState.toolNames = [];
  registrationState.error = undefined;
}

export const DASHBOARD_TOOL_NAMES = {
  list_folders: true,
  get_timeline: true,
  find_saves: true,
  explain_save: true,
  preview_restore: true,
  get_workspace_context: true,
  list_files: true,
  read_document_outline: true,
  read_selected_text: true,
  read_file_context: true,
  read_table_range: true,
  get_document_history: true,
  list_change_proposals: true,
  explain_change_proposal: true,
  propose_file_change: true,
  propose_document_change: true,
  comment_on_change_proposal: true,
  comment_on_document: true,
};
