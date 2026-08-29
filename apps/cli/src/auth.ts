import { spawn } from "node:child_process";
import { DEFAULT_API_URL } from "./config.ts";
import { CliError } from "./cli-error.ts";
import {
  accountMeta,
  loadAccountToken,
  saveAccountToken,
} from "./credentials.ts";

/**
 * Browser-paired setup: the CLI starts an approval request, the person
 * approves it once in the browser, and this computer holds a credential
 * scoped to the account — every folder and every agent on the machine
 * inherits it. No tokens are ever copied by hand.
 */

export function authHint(): string {
  return (
    "GoodFolder can't act for your account on this computer.\n" +
    "  Fix: run  goodfolder login\n" +
    "  (this opens a one-time browser approval)"
  );
}

/** The name receipts and devices use for this machine ("Carlos's MacBook"). */
export async function friendlyDeviceName(): Promise<string> {
  const os = await import("node:os");
  return (
    os
      .hostname()
      .replace(/\.local$/i, "")
      .trim() || "This computer"
  );
}

function openBrowser(url: string): void {
  if (process.env.GF_NO_OPEN) return; // scripted/CI runs print the URL instead
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    } else {
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    /* printing the URL above is the fallback */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PairedAccount {
  token: string;
  email?: string;
}

/**
 * Run the approval ceremony and store the resulting credential.
 * Idempotent per machine: an existing approval short-circuits.
 */
export async function ensureAccount(apiUrl: string = DEFAULT_API_URL): Promise<string> {
  const existing = loadAccountToken();
  if (existing) return existing;
  const paired = await pairDevice(apiUrl);
  return paired.token;
}

export async function pairDevice(
  apiUrl: string = DEFAULT_API_URL,
): Promise<PairedAccount> {
  const deviceName = await friendlyDeviceName();

  const startRes = await fetch(`${apiUrl}/api/pair/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceName }),
    signal: AbortSignal.timeout(20_000),
  });
  const start = (await startRes.json().catch(() => ({}))) as {
    code?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!startRes.ok || !start.code || !start.url) {
    throw new CliError(
      `✗ Could not start the approval: ${start.error?.message ?? startRes.status}`,
    );
  }

  console.log(`\nOne-time setup — approve "${deviceName}" to connect this computer.`);
  console.log("Your browser should open in a moment. Sign in, then choose Approve.");
  console.log(`If nothing opened, visit:\n  ${start.url}\n`);
  openBrowser(start.url);

  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await sleep(2_000);
    let status = "";
    let token: string | undefined;
    try {
      const res = await fetch(`${apiUrl}/api/pair/${start.code}/wait`, {
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await res.json().catch(() => ({}))) as {
        status?: string;
        token?: string;
      };
      status = j.status ?? "";
      token = j.token;
    } catch {
      continue; // transient network hiccup — keep waiting within the window
    }
    if (status === "approved" && token) {
      const where = saveAccountToken(token);
      console.log(
        where === "keychain"
          ? "✓ This computer is approved (credential stored in your Keychain)."
          : "✓ This computer is approved.",
      );
      return { token };
    }
    if (status === "expired") {
      throw new CliError(
        "✗ The approval window closed before anyone approved.\n  Start again: goodfolder login",
      );
    }
    if (status === "denied") {
      throw new CliError("✗ This approval was declined.");
    }
    if (status === "consumed") {
      throw new CliError(
        "✗ That approval was already collected by another process.",
      );
    }
  }
  throw new CliError(
    "✗ Gave up waiting for approval after 10 minutes.\n  Start again: goodfolder login",
  );
}

/** Explicit re-approval (new machine, revoked key, or troubleshooting). */
export async function cmdLogin(): Promise<void> {
  if (loadAccountToken()) {
    console.log("This computer already has an approval. Approving again replaces it.");
  }
  const meta = accountMeta();
  void meta;
  await pairDevice(DEFAULT_API_URL);
}
