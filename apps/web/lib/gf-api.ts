// One typed client for everything the dashboard (and its agent-facing site
// tools) can ask GoodFolder for. Session-cookie auth rides along on every
// call; the server is the single source of truth, so tools always answer
// from live data rather than a cached page state.

import { previewKindFor, type PreviewKind } from "./preview.ts";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.trygoodfolder.com";

export interface Folder {
  id: string;
  name: string;
  createdAt?: string;
  lastSeq?: number | null;
  lastSaveAt?: string | null;
  role?: "owner" | "contributor";
  contributorCount?: number;
  openProposalCount?: number;
}

export interface FolderFile {
  path: string;
  size: number;
  sha: string;
  /** May be typed into here, in the browser: notes and simple tables. */
  editable: boolean;
  /** May be the subject of a Change Proposal: anything readable as text. */
  proposable?: boolean;
  previewable: boolean;
  previewKind?: PreviewKind | null;
}

export interface FolderFiles {
  role: "owner" | "contributor";
  head: string | null;
  files: FolderFile[];
}

export interface FileContent {
  path: string;
  size: number;
  sha: string;
  role: "owner" | "contributor";
  previewable: boolean;
  editable?: boolean;
  proposable?: boolean;
  content?: string;
  mimeType?: string;
  contentBase64?: string;
  previewKind?: PreviewKind | null;
  storedForDevice?: boolean;
}

/**
 * A file opened in the browser. Text files carry `content`; every other kind
 * carries the raw bytes as a Blob (`blob: null` means the type can't be shown
 * and the view falls back to an honest explanation). Both small files and
 * files whose bytes live in the folder's full stored copy arrive the same
 * way, so a phone photo previews like a screenshot.
 */
export interface OpenedFile {
  path: string;
  sha: string;
  size: number;
  kind: PreviewKind | null;
  editable?: boolean;
  proposable?: boolean;
  content?: string;
  blob?: Blob | null;
  mimeType?: string | null;
  storedForDevice?: boolean;
  previewIssue?: "too-large" | "missing";
  previewMessage?: string;
}

export interface ProposalSuggestion {
  id: string;
  path: string;
  kind: "text_replace" | "table_update" | "asset_replace";
  section?: string | null;
  before: string;
  replacement: string;
  operation?: {
    kind?: "text_replace" | "table_update" | "asset_replace";
    changes?: Array<{ address: string; before: string; replacement: string }>;
    stagingId?: string;
    mimeType?: string;
    extension?: string;
  } | null;
  baseFileSha?: string | null;
  explanation: string;
  status: "open" | "accepted" | "rejected" | "needs-review";
}

export interface ChangeProposal {
  id: string;
  title: string;
  explanation: string;
  status: "open" | "accepted" | "rejected" | "needs-review";
  baseHead?: string | null;
  baseSaveNumber?: number | null;
  createdAt: string;
  authorEmail: string;
  suggestions: ProposalSuggestion[];
}

export interface SaveRow {
  seq: number;
  label: string;
  labelSource?: string;
  collision?: string | null;
  createdAt: string;
  harness?: string | null;
  deviceName?: string | null;
  addedCount?: number;
  changedCount?: number;
  removedCount?: number;
  topPaths?: string[] | null;
  changedPaths?: string[] | null;
  changedPathsTruncated?: boolean;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`GoodFolder request failed (${res.status})`);
  return (await res.json()) as T;
}

async function send<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw Object.assign(new Error(json.error?.message ?? `GoodFolder request failed (${res.status})`), { status: res.status, payload: json });
  return json;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw Object.assign(new Error(json.error?.message ?? `GoodFolder request failed (${res.status})`), { status: res.status, payload: json });
  return json;
}

export type PlanCode = "starter" | "plus" | "studio";
export type BillingInterval = "month" | "year";

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  includedBytes: number;
  overageCentsPerGbMonth: number;
  monthlyPriceCents: number;
  annualPriceCents: number;
}

export interface AccountPlan {
  billingMode: "disabled" | "stripe";
  enforcement: "observe" | "enforce";
  status: "self_hosted" | "none" | "trialing" | "active" | "past_due" | "canceled" | "paused" | "expired";
  planCode: PlanCode | null;
  access: "full" | "read_only" | "expired";
  canWrite: boolean;
  reason: "subscription-required" | "read-only" | "quota-exceeded" | null;
  observedReason: "subscription-required" | "read-only" | "quota-exceeded" | null;
  includedBytes: number | null;
  authorizedBytes: number | null;
  usageBytes: number;
  reservedBytes: number;
  overageCapCents: number;
  accruedOverageCents: number;
  accruedExcessGbMonth: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  writeAccessEndsAt: string | null;
  retentionEndsAt: string | null;
}

export const getPlans = () => get<Record<PlanCode, PlanDefinition>>("/api/plans");
export const getAccountPlan = () => get<AccountPlan>("/api/account/plan");
export const startHostedTrial = (plan: PlanCode, interval: BillingInterval) =>
  send<{ url: string }>("/api/billing/checkout", { plan, interval });
export const openBillingPortal = () => send<{ url: string }>("/api/billing/portal", {});
export const setOverageCap = (capCents: number) => put<AccountPlan>("/api/billing/overage", { capCents });

export const me = () => get<{ id: string; email: string }>("/api/me");

export const listFolders = () => get<Folder[]>("/api/projects");

/**
 * Make a new GoodFolder.
 *
 * The server also answers with the credential a computer would use. It is
 * deliberately not in this type: nothing in the browser needs it, and a value
 * that cannot be read cannot be put on a screen by accident. Connecting a
 * computer happens on that computer.
 */
export const createFolder = (name: string) =>
  send<{ projectId: string }>("/api/projects", { name, deviceName: "Made in the browser" })
    .then((result) => ({ projectId: result.projectId }));

export const listSaves = (folderId: string, full = false) =>
  get<SaveRow[]>(`/api/projects/${folderId}/saves${full ? "?paths=full" : ""}`);

export const listFiles = (folderId: string) =>
  get<FolderFiles>(`/api/projects/${folderId}/files`);

export const readFile = (folderId: string, path: string) =>
  get<FileContent>(`/api/projects/${folderId}/file?path=${encodeURIComponent(path)}`);

/**
 * Raw preview bytes for non-text files. The endpoint answers either with the
 * bytes themselves (real content type) or, for types the browser can't show,
 * with a small descriptor explaining what the file is and where its bytes
 * live. Oversized files reject with a plain-language message.
 */
export async function readFileRaw(folderId: string, path: string): Promise<RawFileResult> {
  const res = await fetch(`${API}/api/projects/${folderId}/file/raw?path=${encodeURIComponent(path)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    let message = `GoodFolder request failed (${res.status})`;
    let code = "";
    let size = 0;
    try {
      const body = (await res.json()) as { size?: number; error?: { code?: string; message?: string } };
      code = body.error?.code ?? "";
      size = Number(body.size ?? 0);
      if (body.error?.message) message = body.error.message;
    } catch {
      /* keep the status-based message */
    }
    if (code === "too-large" || code === "missing") {
      return {
        size,
        blob: null,
        mimeType: null,
        storedForDevice: false,
        issue: code,
        message,
      };
    }
    throw new Error(message);
  }
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0] ?? "";
  if (mimeType === "application/json") {
    const body = (await res.json()) as { size?: number; storedForDevice?: boolean };
    return { size: Number(body.size ?? 0), blob: null, mimeType: null, storedForDevice: Boolean(body.storedForDevice) };
  }
  const blob = await res.blob();
  return { size: blob.size, blob, mimeType, storedForDevice: false };
}

export interface RawFileResult {
  size: number;
  blob: Blob | null;
  mimeType: string | null;
  storedForDevice: boolean;
  issue?: "too-large" | "missing";
  message?: string;
}

/**
 * Open any file for viewing: text through the document endpoint, everything
 * else as raw bytes. Same call for a 40 KB screenshot and a 4 MB photo.
 */
export async function openFile(
  folderId: string,
  file: Pick<FolderFile, "path" | "sha" | "size">,
): Promise<OpenedFile> {
  const kind = previewKindFor(file.path);
  if (!kind || kind === "text") {
    const details = await readFile(folderId, file.path);
    return {
      path: details.path,
      sha: details.sha,
      size: details.size,
      kind: "text",
      editable: details.editable,
      proposable: details.proposable,
      content: details.content,
      storedForDevice: details.storedForDevice ?? false,
    };
  }
  const raw = await readFileRaw(folderId, file.path);
  return {
    path: file.path,
    sha: file.sha,
    size: raw.size || file.size,
    kind,
    blob: raw.blob,
    mimeType: raw.mimeType,
    storedForDevice: raw.storedForDevice,
    previewIssue: raw.issue,
    previewMessage: raw.message,
  };
}

export const saveDocument = (folderId: string, input: { path: string; content: string; baseHead: string | null; label: string }) =>
  send<{ ok: true; head: string; saveNumber: number }>(`/api/projects/${folderId}/document/save`, input);

export const listProposals = (folderId: string) =>
  get<{ role: "owner" | "contributor"; proposals: ChangeProposal[] }>(`/api/projects/${folderId}/proposals`);

export type FileProposalOperation = {
  path: string;
  kind: "text_replace" | "table_update" | "asset_replace";
  section?: string;
  before?: string;
  replacement?: string;
  changes?: Array<{ address: string; before: string; replacement: string }>;
  stagingId?: string;
  mimeType?: string;
  extension?: string;
  explanation?: string;
};

export const createProposal = (folderId: string, input: {
  title: string;
  explanation?: string;
  operation?: FileProposalOperation;
  baseHead: string | null;
  baseSaveNumber?: number | null;
  suggestions?: Array<FileProposalOperation>;
}) => send<{ ok: true; proposalId: string; suggestionCount: number; url: string }>(`/api/projects/${folderId}/proposals`, input);

export const reviewProposal = (folderId: string, proposalId: string, input: { action: "accept" | "reject"; suggestionId?: string }) =>
  send<{
    ok: true;
    status: ChangeProposal["status"];
    acceptedSuggestionIds: string[];
    head: string | null;
    saveNumber: number | null;
  }>(`/api/projects/${folderId}/proposals/${proposalId}/review`, input);

export const addProposalComment = (folderId: string, proposalId: string, body: string, suggestionId?: string) =>
  send<{ ok: true }>(`/api/projects/${folderId}/proposals/${proposalId}/comments`, { body, suggestionId });

export const addDocumentComment = (folderId: string, path: string, body: string, quotedText?: string) =>
  send<{ ok: true; commentId: string }>(`/api/projects/${folderId}/document/comments`, { path, body, quotedText });

export const listDocumentComments = (folderId: string, path: string) =>
  get<Array<{ id: string; path: string; quotedText?: string | null; body: string; createdAt: string; authorEmail: string }>>(`/api/projects/${folderId}/document/comments?path=${encodeURIComponent(path)}`);

export const listPeople = (folderId: string) =>
  get<{ role: "owner" | "contributor"; people: Array<{ email: string; role: "owner" | "contributor" }> }>(`/api/projects/${folderId}/people`);

export const inviteContributor = (folderId: string, email: string) =>
  send<{ ok: true }>(`/api/projects/${folderId}/invitations`, { email });

export const acceptInvitation = (token: string) =>
  send<{ ok: true; projectId: string }>("/api/invitations/accept", { token });

export function requestSignInLink(email: string) {
  return fetch(`${API}/api/auth/magic-request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      email,
      next: typeof window !== "undefined" ? window.location.href : "/dashboard",
    }),
  }).then(async (res) => {
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!res.ok || !j.ok) throw new Error(j.message ?? `Could not send the link (${res.status})`);
  });
}

// ---------------------------------------------------------------------------
// Pure helpers — shared by the UI and unit-tested independently.
// ---------------------------------------------------------------------------

const KNOWN_HARNESSES: Array<[RegExp, string]> = [
  [/claude/, "Claude Code"],
  [/codex/, "Codex"],
  [/cursor/, "Cursor"],
  [/opencode/, "OpenCode"],
  [/gemini/, "Gemini CLI"],
];

/** "claude-code" → "Claude Code"; unknown names pass through tidied. */
export function friendlyHarness(name?: string | null): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  for (const [re, label] of KNOWN_HARNESSES) if (re.test(n)) return label;
  const trimmed = String(name).trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : null;
}

/** Who drove the save — the person's own terminal or a named tool. */
export function actorLabel(s: Pick<SaveRow, "harness" | "deviceName">): string | null {
  const byTool = friendlyHarness(s.harness);
  if (byTool) return `saved by ${byTool}`;
  if (s.deviceName) return `saved on ${s.deviceName}`;
  return null;
}

/** "1 added · 3 changed · 1 removed", skipping zero parts. */
export function countsLabel(s: Pick<SaveRow, "addedCount" | "changedCount" | "removedCount">): string {
  const bits: string[] = [];
  const a = Number(s.addedCount ?? 0);
  const c = Number(s.changedCount ?? 0);
  const r = Number(s.removedCount ?? 0);
  if (a > 0) bits.push(`${a} added`);
  if (c > 0) bits.push(`${c} changed`);
  if (r > 0) bits.push(`${r} removed`);
  return bits.join(" · ");
}

export type FolderStatus =
  | { kind: "empty"; text: "Connected — nothing saved yet" }
  | { kind: "attention"; text: "Needs attention" }
  | { kind: "current"; text: string };

export function folderStatus(f: Folder, now = Date.now()): FolderStatus {
  if (Number(f.lastSeq ?? 0) === 0 || !f.lastSaveAt) {
    return { kind: "empty", text: "Connected — nothing saved yet" };
  }
  const ageMs = now - new Date(f.lastSaveAt).getTime();
  const hours = Math.floor(ageMs / 3_600_000);
  const days = Math.floor(hours / 24);
  const ago = days > 0 ? `${days} day${days === 1 ? "" : "s"} ago`
    : hours > 0 ? `${hours} hour${hours === 1 ? "" : "s"} ago`
    : "just now";
  return { kind: "current", text: `Protected · last saved ${ago}` };
}

/** Human timestamp for tool answers and card sublines. */
export function whenLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const diffDays = Math.floor((now - d.getTime()) / 86_400_000);
  const time = d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (diffDays <= 0) return `today at ${time}`;
  if (diffDays === 1) return `yesterday at ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${time}`;
}
