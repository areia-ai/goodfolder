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
// Connecting or saving a folder that lives on the person's computer is a
// separate local-agent job: use the GoodFolder MCP server (or CLI) there.
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
  readFileRaw,
  listProposals,
  createProposal,
  stageFile,
  createGeneratedFile,
  addProposalComment,
  addDocumentComment,
  createWorkspaceProposal,
  listSaves,
  whenLabel,
  type Folder,
  type SaveRow,
} from "./gf-api.ts";
import { extensionOfPath, previewKindFor } from "./preview.ts";
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
  get_local_save_guidance: "Explain local folder setup",
  get_workspace_context: "Read workspace context",
  list_files: "List files",
  read_document_outline: "Read document outline",
  read_selected_text: "Read selection",
  read_file_context: "Read file context",
  read_table_range: "Read table range",
  read_image: "Read image",
  get_document_history: "Read document history",
  list_change_proposals: "List Change Proposals",
  explain_change_proposal: "Explain Change Proposal",
  propose_new_goodfolder: "Propose new GoodFolder",
  propose_file_change: "Propose file change",
  propose_document_change: "Propose document change",
  propose_document_media: "Propose media in document",
  propose_generated_file: "Propose generated file",
  comment_on_change_proposal: "Comment on Change Proposal",
  comment_on_document: "Comment on document",
  get_timeline: "Read timeline",
  find_saves: "Find saves",
  explain_save: "Explain save",
  preview_restore: "Preview going back",
};

/**
 * Inline media is deliberately bounded to the dashboard's preview ceiling.
 * This keeps a WebMCP JSON call useful for generated images and short clips
 * without letting one tool invocation hold an unpreviewable 100 MB payload in
 * the page. Larger media can use the ordinary staged-upload path later.
 */
export const WEBMCP_MEDIA_BYTE_CAP = 25_000_000;

const WEBMCP_MEDIA_MIMES: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon",
  heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", m4v: "video/x-m4v", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg",
  flac: "audio/flac", aac: "audio/aac",
};

export function decodeMediaDataUrl(value: string): { mimeType: string; bytes: Uint8Array } | { error: string } {
  const match = /^data:((?:image|video|audio)\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(value.trim());
  if (!match) return { error: "Give the media as a base64 image, video, or audio data URL." };
  try {
    const binary = atob(match[2]!.replace(/\s/g, ""));
    if (binary.length === 0) return { error: "The media data URL is empty." };
    if (binary.length > WEBMCP_MEDIA_BYTE_CAP) {
      return { error: `Inline proposed media is limited to ${Math.round(WEBMCP_MEDIA_BYTE_CAP / 1_000_000)} MB.` };
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { mimeType: match[1]!.toLowerCase(), bytes };
  } catch {
    return { error: "The media data URL is not valid base64." };
  }
}

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
const WEBMCP_LOGO_BYTE_CAP = 5_000_000;

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
    // A proposal anchors an exact passage, which works on prose and on source
    // alike — so this is wider than what the browser lets anyone type into.
    if (operation !== "asset_replace" && !(file.proposable ?? file.editable)) {
      return { error: "Choose a file that can be read as text." };
    }
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

type ProposeDocumentMediaArgs = {
  document: string;
  assetPath: string;
  assetDataUrl: string;
  anchorText: string;
  insertionText: string;
  placement: "before" | "after";
  section?: string;
  explanation: string;
  title: string;
};

async function proposeDocumentMedia(args: ProposeDocumentMediaArgs): Promise<unknown> {
  try {
    const input = args && typeof args === "object" ? args : {} as ProposeDocumentMediaArgs;
    const documentPath = typeof input.document === "string" ? input.document.trim() : "";
    const assetPath = typeof input.assetPath === "string" ? input.assetPath.trim() : "";
    const anchorText = typeof input.anchorText === "string" ? input.anchorText : "";
    const insertionText = typeof input.insertionText === "string" ? input.insertionText.trim() : "";
    const placement = input.placement;
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";
    if (!documentPath || documentPath.length > 512 || !assetPath || assetPath.length > 512) {
      return { error: "Choose a safe document path and a safe path for the proposed media." };
    }
    if (!title || title.length > 120 || !explanation || explanation.length > 500) {
      return { error: "Give the proposal a short title and explanation." };
    }
    if (!anchorText || anchorText.length > 20_000 || !insertionText || insertionText.length > 20_000) {
      return { error: "Give an exact anchor and bounded text that refers to the media." };
    }
    if (placement !== "before" && placement !== "after") return { error: "Place the media before or after the anchor." };
    if (!insertionText.includes(assetPath) && !insertionText.includes(assetPath.split("/").pop() ?? assetPath)) {
      return { error: "The inserted document text must refer to the proposed media path." };
    }
    const kind = previewKindFor(assetPath);
    if (kind !== "image" && kind !== "video" && kind !== "audio") {
      return { error: "Use a browser-previewable image, video, or audio filename." };
    }
    const decoded = decodeMediaDataUrl(typeof input.assetDataUrl === "string" ? input.assetDataUrl : "");
    if ("error" in decoded) return decoded;
    const expectedMimeType = WEBMCP_MEDIA_MIMES[extensionOfPath(assetPath)];
    if (!expectedMimeType || decoded.mimeType !== expectedMimeType) {
      return { error: `The filename expects ${expectedMimeType ?? kind}, but the supplied data is ${decoded.mimeType}.` };
    }

    const folder = await folderFromPage();
    if (!folder) return { error: "Open a folder first." };
    const files = await listFiles(folder.id);
    const document = files.files.find((item) => item.path === documentPath);
    if (!document || !(document.proposable ?? document.editable)) return { error: "Choose a document that can be read as text." };
    if (files.files.some((item) => item.path === assetPath)) return { error: "Choose a new path for the proposed media." };

    const mediaBuffer = new ArrayBuffer(decoded.bytes.byteLength);
    new Uint8Array(mediaBuffer).set(decoded.bytes);
    const waiting = await stageFile(folder.id, {
      name: assetPath,
      file: new Blob([mediaBuffer], { type: decoded.mimeType }),
    });
    const replacementText = placement === "before"
      ? `${insertionText}\n\n${anchorText}`
      : `${anchorText}\n\n${insertionText}`;
    const result = await createProposal(folder.id, {
      title,
      explanation,
      baseHead: null,
      suggestions: [
        {
          path: assetPath,
          kind: "asset_replace",
          stagingId: waiting.stagingId,
          mimeType: decoded.mimeType,
          explanation: `Add ${assetPath} for this document change.`,
        },
        {
          path: documentPath,
          kind: "text_replace",
          section: typeof input.section === "string" ? input.section.trim().slice(0, 160) : undefined,
          before: anchorText,
          replacement: replacementText,
          explanation,
        },
      ],
    });
    announceProposalCreated({ folderId: folder.id, path: documentPath, proposalId: result.proposalId });
    return {
      changedDocument: false,
      stagedOutsideFolder: true,
      reviewRequired: true,
      folder: folder.name,
      document: documentPath,
      assetPath,
      assetBytes: waiting.size,
      proposalId: result.proposalId,
      proposalUrl: result.url,
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

type ProposeGeneratedFileArgs = {
  path: string;
  artifactType: "document" | "spreadsheet" | "pdf" | "presentation" | "image";
  content: Record<string, unknown>;
  brand?: { name?: string; backgroundColor?: string; accentColor?: string; logoDataUrl?: string };
  explanation: string;
  title: string;
};

async function proposeGeneratedFile(args: ProposeGeneratedFileArgs): Promise<unknown> {
  try {
    const input = args && typeof args === "object" ? args : {} as ProposeGeneratedFileArgs;
    const path = typeof input.path === "string" ? input.path.trim() : "";
    const artifactType = input.artifactType;
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";
    const kinds = { document: "word", spreadsheet: "sheet", pdf: "pdf", presentation: "slides", image: "image" } as const;
    if (!path || path.length > 512 || !artifactType || previewKindFor(path) !== kinds[artifactType]) return { error: "Choose a safe path with the extension that matches the generated file type." };
    if (!title || title.length > 120 || !explanation || explanation.length > 500) {
      return { error: "Give the proposal a short title and explanation." };
    }
    if (!input.content || typeof input.content !== "object") return { error: "Give the generated file structured content." };
    const brand = input.brand && typeof input.brand === "object" ? input.brand : undefined;
    const logo = typeof brand?.logoDataUrl === "string" && brand.logoDataUrl.trim() ? decodeMediaDataUrl(brand.logoDataUrl) : null;
    if (logo && "error" in logo) return { error: "Use an image data URL for the optional logo." };
    if (logo && !["image/png", "image/jpeg", "image/webp"].includes(logo.mimeType)) {
      return { error: "Use a PNG, JPEG, or WebP image for the optional logo." };
    }
    const folder = await folderFromPage();
    if (!folder) return { error: "Open a folder first." };
    const waiting = await createGeneratedFile(folder.id, {
      path,
      artifactType,
      content: input.content,
      brand,
    });
    const result = await createProposal(folder.id, {
      title,
      explanation,
      baseHead: null,
      operation: {
        path,
        kind: "asset_replace",
        stagingId: waiting.stagingId,
        explanation,
      },
    });
    announceProposalCreated({ folderId: folder.id, path, proposalId: result.proposalId });
    return {
      changedDocument: false,
      stagedOutsideFolder: true,
      reviewRequired: true,
      folder: folder.name,
      path,
      artifactType,
      generatedBytes: waiting.size,
      proposalId: result.proposalId,
      proposalUrl: result.url,
    };
  } catch (error) {
    return { error: (error as Error).message };
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
    if (!folders.length) return { error: "No folders yet. To protect an existing folder on this computer, use the local GoodFolder MCP or CLI to connect that folder, then save it. The dashboard cannot do that." };
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
      "List the person's folders already connected to GoodFolder with protection status and when each was last saved. This dashboard cannot connect or save a local filesystem folder.",
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
    name: "get_local_save_guidance",
    description:
      "Explain how to protect and save an existing folder on the local computer. Use this when someone asks to save or protect a local folder: the dashboard is not a save surface and this tool makes no changes.",
    inputSchema: objSchema({}), annotations: readOnly,
    execute: async () => ({
      dashboardCanSaveLocalFolder: false,
      requiredLocalActions: [
        "Use the GoodFolder MCP server on the computer that holds the folder: goodfolder_connect with the folder's absolute path.",
        "Then call goodfolder_save with that same absolute path.",
      ],
      cliEquivalent: "From that folder: goodfolder connect, then goodfolder save.",
      note: "Use goodfolder_create only for a brand-new empty folder. Do not create a dashboard folder when the person asked to protect an existing local folder.",
    }),
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
        return { folder: folder.name, total: result.files.length, files: result.files.map((f) => ({ path: f.path, size: f.size, readableHere: f.previewable, editableHere: f.editable, proposableHere: f.proposable ?? f.editable })) };
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
    name: "read_image",
    description: "Read a small image from the open GoodFolder as a data URL, so it can be used in a reviewable visual proposal. This never changes the folder.",
    inputSchema: objSchema({ path: { type: "string", description: "Image path in the open GoodFolder." } }, ["path"]),
    annotations: readOnly,
    execute: async (args: { path: string }) => {
      try {
        const folder = await folderFromPage();
        const path = typeof args.path === "string" ? args.path.trim() : "";
        if (!folder || !path) return { error: "Open a folder and choose an image path first." };
        const files = await listFiles(folder.id);
        const file = files.files.find((item) => item.path === path);
        if (!file || previewKindFor(path) !== "image") return { error: "Choose an image from the current GoodFolder." };
        if (file.size > WEBMCP_LOGO_BYTE_CAP) return { error: "Choose an image under 5 MB for an agent-facing visual proposal." };
        const raw = await readFileRaw(folder.id, path);
        if (!raw.blob || !raw.mimeType || !["image/png", "image/jpeg", "image/webp"].includes(raw.mimeType)) {
          return { error: "Choose a PNG, JPEG, or WebP image for a generated-file brand kit." };
        }
        const bytes = new Uint8Array(await raw.blob.arrayBuffer());
        let binary = "";
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        return { folder: folder.name, path, mimeType: raw.mimeType, bytes: raw.blob.size, dataUrl: `data:${raw.mimeType};base64,${btoa(binary)}` };
      } catch (error) { return { error: (error as Error).message }; }
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
    name: "propose_new_goodfolder",
    description: "Prepare a reviewable request for a brand-new empty GoodFolder. The owner must accept it in the dashboard before any folder is created. Never use this for an existing local folder.",
    inputSchema: objSchema({
      name: { type: "string", description: "Name for the brand-new empty GoodFolder, at most 80 characters." },
      explanation: { type: "string", description: "Why this new workspace is needed, at most 1,000 characters." },
    }, ["name", "explanation"]), annotations: proposesOnly,
    execute: async (args: { name: string; explanation: string }) => {
      const name = args.name.replace(/\s+/g, " ").trim().slice(0, 80);
      const explanation = args.explanation.trim().slice(0, 1000);
      if (!name || !explanation) return { error: "Give the new GoodFolder a name and a short reason." };
      try {
        const result = await createWorkspaceProposal({ name, explanation });
        window.dispatchEvent(new CustomEvent("workspace-proposal-created", { detail: { proposalId: result.proposalId } }));
        return { proposalId: result.proposalId, name, reviewRequired: true, createdFolder: false };
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
    description: "Create a reviewable one-file suggestion. text_replace works on any file readable as text, source files included; table_update takes exact CSV/TSV cells; asset_replace puts a file somebody already sent up in place of this one. This never changes the file; only the folder owner can accept it.",
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
    name: "propose_document_media",
    description: "Create one reviewable Change Proposal that adds generated media and inserts its Markdown or HTML reference into a text document. The bytes wait outside the folder; accepting the whole proposal adds the media and edits the document in one Save. This never changes the folder by itself.",
    inputSchema: objSchema({
      document: { type: "string", description: "Exact path of the text document in the open GoodFolder." },
      assetPath: { type: "string", description: "New path the image, video, or audio file will have if accepted, including its extension." },
      assetDataUrl: { type: "string", description: "The generated image, video, or audio as a base64 data URL. Inline media is limited to 25 MB." },
      anchorText: { type: "string", description: "Exact existing document text to anchor the insertion, at most 20,000 characters." },
      insertionText: { type: "string", description: "Markdown or HTML that refers to assetPath, at most 20,000 characters." },
      placement: { type: "string", enum: ["before", "after"], description: "Put insertionText before or after anchorText." },
      section: { type: "string", description: "Optional section name shown during review." },
      explanation: { type: "string", description: "Why the media belongs here, at most 500 characters." },
      title: { type: "string", description: "Short Change Proposal title." },
    }, ["document", "assetPath", "assetDataUrl", "anchorText", "insertionText", "placement", "explanation", "title"]),
    annotations: proposesOnly,
    execute: async (args: ProposeDocumentMediaArgs) => proposeDocumentMedia(args),
  });

  await mc.registerTool({
    name: "propose_generated_file",
    description: "Create a reviewable DOCX, XLSX, PDF, PowerPoint, or bitmap image from structured content. The complete file waits outside the folder for the owner to preview and accept; this never changes the folder by itself.",
    inputSchema: objSchema({
      path: { type: "string", description: "New or existing path in the open GoodFolder, with a matching .docx, .xlsx, .pdf, .pptx, .png, .jpg, .jpeg, or .webp extension." },
      artifactType: { type: "string", enum: ["document", "spreadsheet", "pdf", "presentation", "image"], description: "Type of complete file to prepare." },
      content: { type: "object", description: "Structured file content: blocks for document/PDF, sheets for spreadsheet, slides for presentation, or a PNG/JPEG/WebP dataUrl for image." },
      brand: { type: "object", description: "Optional common brand kit with name, backgroundColor, accentColor, and a PNG/JPEG/WebP logoDataUrl returned by read_image." },
      explanation: { type: "string", description: "Why this complete file was prepared, at most 500 characters." },
      title: { type: "string", description: "Short Change Proposal title." },
    }, ["path", "artifactType", "content", "explanation", "title"]),
    annotations: proposesOnly,
    execute: async (args: ProposeGeneratedFileArgs) => proposeGeneratedFile(args),
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
  get_local_save_guidance: true,
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
  read_image: true,
  get_document_history: true,
  list_change_proposals: true,
  explain_change_proposal: true,
  propose_new_goodfolder: true,
  propose_file_change: true,
  propose_document_change: true,
  propose_document_media: true,
  propose_generated_file: true,
  comment_on_change_proposal: true,
  comment_on_document: true,
};
