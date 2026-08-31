import type { AiLabelContext, SaveRecord } from "@goodfolder/shared";
import type { FolderConfig } from "./config.ts";
import { CliError } from "./cli-error.ts";
import { authHint } from "./auth.ts";

async function call(
  cfg: FolderConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: any }> {
  const init: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.token}`,
    },
    signal: AbortSignal.timeout(30_000),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${cfg.apiUrl}${path}`, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error bodies */
  }
  return { ok: res.ok, status: res.status, json };
}

/** Account-scoped call (approved computer), for management actions. */
export async function accountCall<T = any>(
  apiUrl: string,
  accountToken: string,
  method: string,
  path: string,
  body?: unknown,
  subscriptionAction?: string,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accountToken}`,
    },
    signal: AbortSignal.timeout(30_000),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${apiUrl}${path}`, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error bodies */
  }
  if (!res.ok) {
    const billing = billingErrorMessage(json?.error?.code, subscriptionAction);
    if (billing) throw new CliError(`✗ ${billing}`);
    if (res.status === 401 || res.status === 403) throw new CliError(`✗ ${authHint()}`);
    throw new CliError(
      `✗ ${json?.error?.message ?? `GoodFolder request failed (${res.status})`}`,
    );
  }
  return json as T;
}

function billingErrorMessage(code: unknown, subscriptionAction = "saving new work"): string | null {
  if (code === "subscription-required") return `Start your GoodFolder Hosted trial before ${subscriptionAction}.`;
  if (code === "read-only") return "This account is in read and export mode. Your existing files and earlier versions are still available.";
  if (code === "quota-exceeded") return "You have reached your protected-data limit. Nothing was removed; increase your limit or free some capacity before saving again.";
  if (code === "billing-unavailable") return "Hosted billing is unavailable right now. Try again shortly.";
  return null;
}

export async function preflightSave(cfg: FolderConfig): Promise<void> {
  const result = await call(cfg, "GET", "/api/save/preflight");
  if (result.ok) return;
  const message = billingErrorMessage(result.json?.error?.code);
  throw new CliError(`✗ ${message ?? result.json?.error?.message ?? `GoodFolder request failed (${result.status})`}`);
}

export interface ProjectCreateResponse {
  projectId: string;
  deviceId: string;
  token: string;
  repo?: string;
}

/** Create a folder on the approved account. */
export function createProject(
  apiUrl: string,
  name: string,
  accountToken: string,
  deviceName?: string,
): Promise<ProjectCreateResponse> {
  return accountCall(apiUrl, accountToken, "POST", "/api/projects", {
    name,
    ...(deviceName ? { deviceName } : {}),
  }, "connecting a folder");
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt?: string;
  lastSeq?: number | null;
  lastSaveAt?: string | null;
}

/** List the account's folders. */
export function listProjects(
  apiUrl: string,
  accountToken: string,
): Promise<ProjectSummary[]> {
  return accountCall(apiUrl, accountToken, "GET", "/api/projects");
}

/** Mint an extra folder token for a second machine or agent setup. */
export function mintProjectToken(
  apiUrl: string,
  projectId: string,
  accountToken: string,
  deviceName?: string,
): Promise<{ projectId: string; token: string }> {
  return accountCall(apiUrl, accountToken, "POST", `/api/projects/${projectId}/token`, deviceName ? { deviceName } : undefined);
}

export function recordSave(
  cfg: FolderConfig,
  input: {
    label?: string;
    changedPaths: string[];
    commitSha: string;
    collision?: string;
    ai?: AiLabelContext | null;
    counts?: { added: number; changed: number; removed: number };
    topPaths?: string[];
    harness?: string | null;
  },
): Promise<{ id: string; seq: number; label: string }> {
  return call(cfg, "POST", "/api/saves", {
    label: input.label,
    labelSource: input.label ? "user" : "agent",
    changedPaths: input.changedPaths,
    commitSha: input.commitSha,
    collision: input.collision,
    ai: input.ai ?? undefined,
    counts: input.counts,
    topPaths: input.topPaths,
    harness: input.harness ?? undefined,
  }).then((r) => {
    if (!r.ok) throw new Error(r.json?.error?.message ?? `save failed (${r.status})`);
    return r.json;
  });
}

export interface TimelineEntry extends Omit<SaveRecord, "createdAt"> {
  createdAt: string;
  commit_sha: string;
  /** MCP client identity, or null when a person ran the save. */
  harness?: string | null;
}

export interface TimelineReceipt {
  seq: number;
  label: string;
  collision?: string | null;
  createdAt: string;
  harness?: string | null;
  deviceName?: string | null;
  addedCount?: number;
  changedCount?: number;
  removedCount?: number;
  topPaths?: string[] | null;
}

export async function listSaves(cfg: FolderConfig): Promise<TimelineEntry[]> {
  const r = await call(cfg, "GET", "/api/saves");
  if (!r.ok) throw new Error(`could not load timeline (${r.status})`);
  const rows = r.json as any[];
  return rows.map((row) => ({
    ...row,
    createdAt: row.created_at ?? row.createdAt,
    // The timeline endpoint returns camelCase `commitSha` since the
    // save-receipts change (2026-08-26); older shapes used `commit_sha`.
    // Normalize here so restore/undo have one field to read.
    commit_sha: row.commit_sha ?? row.commitSha,
    harness: row.harness ?? null,
  }));
}
