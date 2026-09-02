import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdtemp, open as openFile, readFile as readTempFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getRequestListener } from "@hono/node-server";
import { Hono, type Context } from "hono";
import {
  tokenFromAuthHeader,
  loadConfig,
  newToken,
  newUrlToken,
  openDb,
  RepositoryAdapter,
  resolveAuthContext,
  resolveScope,
  GetObjectCommand,
  PutObjectCommand,
  loadBillingConfig,
  type FileChange,
  makeS3,
  isPlanCode,
  PLANS,
  type AuthContext,
  type TokenScope,
} from "@goodfolder/serverlib";
import { HostedBilling } from "./hosted-billing.ts";
import { safeDocumentPath } from "./collaboration.ts";
import { ROUTING_CEILING_BYTES } from "@goodfolder/shared";
import { checkWrite, filesUnder } from "./write-gate.ts";
import { acceptStagedFile, forgetStagedFile, hashFile, putStoredFileFromPath, stagingKey } from "./stored-file.ts";
import {
  TABLE_EDIT_CAP,
} from "./table.ts";
import { applyProposalOperations, isDocumentMediaBundle, isFileOperation, type StoredProposalSuggestion } from "./proposal-operations.ts";
import {
  PREVIEW_BYTE_CAP,
  parseStoredFilePointer,
  previewKindFor,
  previewMimeFor,
} from "./preview.ts";

const cfg = loadConfig();
const sql = openDb(cfg.databaseUrl);
const repos = new RepositoryAdapter(cfg);
// Reads bytes for the browser preview from object storage. Streaming only —
// bodies are piped straight through, never buffered whole (the container has
// a hard memory cap and shares the box with other services).
const previewStorage = makeS3(cfg);
const billingConfig = loadBillingConfig();
const billing = new HostedBilling(sql, billingConfig, repos, previewStorage, cfg.s3Bucket);

const CHALLENGE_CAMPAIGN = "webmcp-2026";
const challengeCode = process.env.CHALLENGE_ACCESS_CODE?.trim() ?? "";
const challengeExpiresAt = process.env.CHALLENGE_ACCESS_EXPIRES_AT?.trim() ?? "";
const challengeStaffEmails = new Set(
  (process.env.CHALLENGE_ACCESS_STAFF_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean),
);
const challengeEnabled = Boolean(challengeCode || challengeExpiresAt || challengeStaffEmails.size);
if (challengeEnabled && (!challengeCode || !challengeExpiresAt || Number.isNaN(Date.parse(challengeExpiresAt)))) {
  throw new Error("CHALLENGE_ACCESS_CODE and CHALLENGE_ACCESS_EXPIRES_AT are both required when challenge access is enabled");
}
const challengeExpiry = challengeEnabled ? new Date(challengeExpiresAt) : null;

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Absolute origin browsers are sent back to (magic links, pairing pages). */
const PUBLIC_BASE = process.env.PUBLIC_URL ?? "https://api.trygoodfolder.com";

// ---------------------------------------------------------------------------
// API app (everything except /git/*)
// ---------------------------------------------------------------------------

const app = new Hono<{
  Variables: { scope?: TokenScope | undefined; auth?: AuthContext | undefined };
}>();

app.get("/healthz", (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------------
// CORS — browser origins allowed to call /api/*. Must register BEFORE auth:
// preflight OPTIONS requests carry no Authorization header. Web origins come
// from WEB_ORIGINS (comma-separated); localhost and *.pages.dev are always
// allowed for dev/preview.
// ---------------------------------------------------------------------------

const allowedOrigins = new Set(
  (process.env.WEB_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
);

function originAllowed(origin: string): boolean {
  if (allowedOrigins.has(origin)) return true;
  if (/^http:\/\/localhost:\d+$/.test(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin)) return true;
  return false;
}

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && originAllowed(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    c.header("Access-Control-Allow-Headers", "authorization, content-type");
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Max-Age", "86400");
  }
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

// ---------------------------------------------------------------------------
// Client IP — behind Caddy in production, which APPENDS the real socket IP to
// X-Forwarded-For. Clients can forge leading entries, so trust only the last.
// ---------------------------------------------------------------------------

function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",");
    return parts[parts.length - 1]!.trim();
  }
  return headers.get("x-real-ip") ?? "unknown";
}

// ---------------------------------------------------------------------------
// Magic-link auth + browser pairing (2026-08-25).
//
// Two-layer credentials:
//   • Account device token — minted by the browser-pairing ceremony, lives in
//     the OS keychain, authorizes management actions for every agent on one
//     machine. Never used for git transport.
//   • Per-folder transport tokens — the pre-existing transfer_tokens rows,
//     now minted THROUGH an approved account instead of dev bootstrap. Git,
//     LFS, and saves keep resolving them exactly as before.
//
// Registration order matters: everything in this section is registered BEFORE
// the bearer middleware below, so Hono never wraps these routes with it.
// Browser-session routes use the gf_session cookie instead of a bearer.
// ---------------------------------------------------------------------------

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** In-memory sliding-window limiter — single container, stopgap-grade. */
const rateBuckets = new Map<string, Map<string, number[]>>();
function rateLimit(name: string, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(name);
  if (!bucket) {
    bucket = new Map();
    rateBuckets.set(name, bucket);
  }
  if (bucket.size > 10_000) bucket.clear();
  const hits = (bucket.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  bucket.set(key, hits);
  return true;
}

const SESSION_COOKIE = "gf_session";
const SESSION_TTL_SECONDS = 30 * 86400;
const MAGIC_TTL_MINUTES = 15;
const PAIRING_TTL_MINUTES = 15;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function sessionAccount(
  c: { req: { header: (n: string) => string | undefined } },
): Promise<{ accountId: string; email: string } | null> {
  const v = parseCookies(c.req.header("cookie"))[SESSION_COOKIE];
  if (!v || v.length < 20 || !/^[A-Za-z0-9_-]+$/.test(v)) return null;
  const rows = await sql`
    SELECT s.account_id AS "accountId", a.email
    FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ${sha256(v)} AND s.expires_at > now()
    LIMIT 1`;
  const r = rows[0];
  return r ? { accountId: String(r.accountId), email: String(r.email) } : null;
}

async function createSession(accountId: string): Promise<string> {
  const sess = newUrlToken("gfs");
  await sql`
    INSERT INTO sessions (token_hash, account_id, expires_at)
    VALUES (${sess.hash}, ${accountId}, now() + (${SESSION_TTL_SECONDS} || ' seconds')::interval)`;
  return sess.raw;
}

// The minted device token travels to the polling CLI encrypted with a key
// derived from the pairing code itself — a database leak alone cannot
// recover it, and only the CLI holding the code can decrypt the delivery.
function deliveryKey(code: string): Buffer {
  return createHash("sha256").update(`goodfolder-pairing:${code}`).digest();
}

function sealDelivery(code: string, plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deliveryKey(code), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function openDelivery(code: string, blob: Buffer): string | null {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deliveryKey(code),
      blob.subarray(0, 12),
    );
    decipher.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM ?? "GoodFolder <onboarding@resend.dev>";
const MAGIC_LINK_DEBUG = process.env.MAGIC_LINK_DEBUG === "1";

async function sendMagicLink(email: string, link: string): Promise<void> {
  if (RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: email,
          subject: "Sign in to GoodFolder",
          text:
            `Tap this link to sign in to GoodFolder. It works once and expires ` +
            `in ${MAGIC_TTL_MINUTES} minutes.\n\n${link}\n`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`resend ${await res.text()}`);
      return;
    } catch (e) {
      console.error("magic-link email send failed:", e);
    }
  }
  // No provider configured (or send failed): deliver via server log so the
  // operator can complete sign-in from the VPS until RESEND_API_KEY exists.
  console.log(`[magic-link] to=${email} link=${link}`);
}

async function sendCollaborationInvite(email: string, folderName: string, link: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log(`[collaboration-invite] to=${email} folder=${folderName} link=${link}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: email,
      subject: `${folderName} was shared with you`,
      text: `You've been invited to contribute to “${folderName}” in GoodFolder.\n\nOpen the invitation:\n${link}\n`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`invite email failed (${res.status})`);
}

function safeNextPath(next: unknown): string {
  if (typeof next === "string") {
    if (/^\/(pair\/[a-f0-9]{32}|account)?$/.test(next)) return next;
    // Back to the human site after signing in from its dashboard.
    if (
      /^https:\/\/(?:www\.)?trygoodfolder\.com(?:\/[^\s]*)?$/i.test(next) ||
      /^https:\/\/[a-z0-9-]+\.pages\.dev(?:\/[^\s]*)?$/i.test(next)
    ) {
      return next;
    }
  }
  return "/account";
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
}

// ---------------------------------------------------------------------------
// Minimal first-party pages served by the API itself: sign-in verification
// and device approval. The polished dashboard lives on trygoodfolder.com;
// these exist so the pairing ceremony never depends on a second deployment.
// ---------------------------------------------------------------------------

const INLINE_BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 512 512" aria-hidden="true"><path d="m251.3 445.4h-154.1c-8.378 0-16.76 0.4655-24.67-0.4655-24.67-3.724-48.41-25.13-48.41-54.46v-241.6-24.67c0.4655-28.86 24.67-58.18 56.79-58.18h99.61c13.03-0.4655 25.13 0.9309 34.91 12.1l34.91 45.15c1.396 1.862 2.327 2.327 4.655 2.327h188.5c23.74 0 45.15 16.29 45.15 40.03v224.3c0 28.39-23.27 54.46-54.46 55.85l-182.9-0.4655z" fill="#000000" /><path d="m41.43 255.5v-130.8c0-20.01 17.22-40.03 39.1-40.03h99.61c7.447 0 14.89-0.9309 20.48 5.585l36.77 45.61c3.724 4.655 9.309 7.447 14.89 7.447h192.2c14.43 0 26.07 10.24 26.07 24.2v223c0 19.55-16.29 36.31-37.7 36.77h-353.7c-20.95 0-37.7-15.36-37.7-36.77v-135z" fill="#3B82F6" /><path d="m212.2 269.5c0 27-13.03 49.8-32.58 49.8-15.83 0-32.12-20.01-32.12-49.34 0-27 13.96-52.13 33.05-52.13s31.65 22.81 31.65 51.67z" fill="#000000" /><path d="m362.1 248.6c7.913 29.79-2.327 69.35-29.79 69.82-15.83 0-33.05-20.01-33.05-50.73 0-27 13.96-50.27 31.65-50.27 12.57 0 26.07 11.17 31.19 31.19z" fill="#000000" /><path d="m197.8 245.8c0 5.12-4.189 9.309-9.775 9.309-4.655 0-9.309-3.724-9.309-9.309 0-5.12 4.189-9.775 9.309-9.775 5.585 0 9.775 4.655 9.775 9.775z" fill="#FFFFFF" /><path d="m348.2 245.8c0 5.12-4.189 9.309-9.309 9.309s-9.775-3.724-9.775-9.309c0-5.12 4.189-9.775 9.775-9.775 5.12 0 9.309 4.189 9.309 9.775z" fill="#FFFFFF" /><path d="m254.6 356.5c-26.07 0-38.63-17.69-40.96-23.74-1.396-3.724 0.4655-8.378 4.655-10.24 3.724-1.396 8.378 0.4655 10.24 4.655 0.4655 0.9309 7.447 13.03 26.07 13.5 18.62 0 25.6-12.57 26.07-13.96 1.862-3.724 6.516-6.516 10.71-4.655 4.189 1.862 6.516 6.516 4.655 10.24-0.4655 0.9309-11.17 24.2-41.43 24.2z" fill="#000000" /></svg>`;
const INLINE_BRAND_WORDMARK = `<svg class="brand-wordmark" viewBox="0 0 1480 365" aria-hidden="true"><path d="m231.1 178v9.061c0 48.33-31.71 95.14-95.14 95.14-55.88 0-95.14-34.73-95.14-92.12s39.27-101.2 92.12-101.2c34.73 0 57.39 10.57 74 28.69l-28.69 27.18c-9.061-12.08-24.16-21.14-45.31-21.14-31.71 0-54.37 22.65-54.37 63.43 3.02 28.69 21.14 58.9 57.39 58.9 24.16 0 42.29-13.59 48.33-33.22h-52.86v-34.73h99.67z" fill="#000000" /><path d="m386.6 214.2c0 37.76-27.18 67.96-74 67.96-40.78 0-72.49-27.18-72.49-67.96 0-37.76 27.18-69.47 70.98-69.47 43.8 0 75.51 27.18 75.51 69.47zm-107.2 0c0 19.63 13.59 33.22 31.71 33.22 18.12 0 36.24-12.08 36.24-33.22 0-21.14-15.1-34.73-33.22-34.73-18.12 0-34.73 12.08-34.73 34.73z" fill="#000000" /><path d="m545.2 214.2c0 37.76-27.18 67.96-74 67.96-40.78 0-74-25.67-74-67.96 0-37.76 28.69-69.47 72.49-69.47 42.29 0 75.51 24.16 75.51 69.47zm-110.2 0c0 19.63 13.59 33.22 31.71 33.22 18.12 0 34.73-12.08 34.73-33.22 0-21.14-13.59-34.73-31.71-34.73-19.63 0-34.73 13.59-34.73 34.73z" fill="#000000" /><path d="m663 264.1c-9.061 10.57-24.16 18.12-43.8 18.12-36.24 0-64.94-25.67-64.94-66.45 0-40.78 27.18-70.98 63.43-70.98 16.61 0 30.2 6.041 40.78 15.1v-77.02h39.27v200.9h-34.73v-19.63zm-70.98-49.84c0 19.63 13.59 34.73 33.22 34.73 19.63 0 34.73-13.59 34.73-34.73 0-19.63-13.59-34.73-33.22-34.73-21.14 0-34.73 15.1-34.73 34.73z" fill="#000000" /><path d="m758.1 128.1v42.29h69.47v34.73h-69.47v74h-39.27v-187.3h119.3v34.73l-80.04 1.51z" fill="#000000" /><path d="m983.1 214.2c0 37.76-28.69 67.96-72.49 67.96-40.78 0-74-25.67-74-67.96 0-37.76 28.69-69.47 72.49-69.47 40.78 0 74 24.16 74 69.47zm-107.2 0c0 21.14 13.59 33.22 33.22 33.22 15.1 0 33.22-10.57 33.22-33.22 0-21.14-12.08-34.73-33.22-34.73-18.12 0-33.22 13.59-33.22 34.73z" fill="#000000" /><path d="m993.7 82.83h39.27v196.3h-39.27v-196.3z" fill="#000000" /><path d="m1161 264.1c-9.061 10.57-24.16 18.12-42.29 18.12-37.76 0-66.45-25.67-67.96-67.96 0-39.27 27.18-69.47 66.45-69.47 15.1 0 28.69 6.041 39.27 15.1v-77.02h40.78v196.3h-36.24v-15.1zm-69.47-49.84c0 21.14 15.1 34.73 33.22 34.73 19.63 0 34.73-12.08 34.73-34.73 0-19.63-15.1-34.73-33.22-34.73-19.63 0-34.73 13.59-34.73 34.73z" fill="#000000" /><path d="m1255 224.8c1.51 16.61 15.1 25.67 31.71 25.67 12.08 0 22.65-4.531 30.2-15.1l28.69 18.12c-10.57 18.12-30.2 28.69-58.9 28.69-39.27 0-72.49-25.67-74-66.45 0-39.27 27.18-70.98 70.98-70.98 42.29 0 67.96 30.2 67.96 67.96v12.08h-96.65zm1.51-22.65h55.88c-1.51-13.59-12.08-25.67-27.18-25.67s-27.18 10.57-28.69 25.67z" fill="#000000" /><path d="m1448 182.5h-12.08c-21.14 0-31.71 12.08-31.71 33.22v63.43h-39.27v-131.4h37.76v18.12c6.041-10.57 18.12-21.14 34.73-21.14 4.531 0 7.551 0 10.57 1.51v36.24z" fill="#000000" /></svg>`;

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#FFFFFF; font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:#000000; }
  .card { background:#FFFFFF; border:1px solid rgba(0,0,0,.12); border-radius:14px; padding:40px; max-width:420px;
          width:calc(100% - 32px); box-shadow:0 18px 50px -38px rgba(0,0,0,.34); text-align:center; }
  h1 { font-size:22px; letter-spacing:-.04em; margin:0 0 8px; }
  p { color:rgba(0,0,0,.62); line-height:1.5; margin:8px 0; }
  .brand { display:flex; align-items:center; justify-content:center; gap:9px; font-weight:760; letter-spacing:-.05em; margin-bottom:20px; font-size:17px; }
  .brand-mark { width:30px; height:30px; flex:none; }
  .brand-wordmark { width:auto; height:17px; flex:none; }
  button { background:#000000; color:#FFFFFF; border:0; border-radius:10px; padding:12px 24px;
           font-size:15px; font-weight:600; cursor:pointer; width:100%; margin-top:14px; }
  button:hover { background:#3B82F6; color:#000000; }
  button:disabled { opacity:.6; cursor:default; }
  input { width:100%; box-sizing:border-box; border:1px solid rgba(0,0,0,.2); border-radius:10px;
          padding:12px 14px; font-size:15px; margin-top:14px; }
  input:focus { border-color:#3B82F6; outline:3px solid rgba(59,130,246,.22); }
  button:focus-visible { outline:3px solid rgba(59,130,246,.28); outline-offset:3px; }
  .ok, .err { margin-top:14px; border-left:3px solid; border-radius:8px; padding:9px 11px; text-align:left; }
  .ok { border-color:#000000; background:rgba(0,0,0,.04); color:#000000; }
  .err { border-color:#3B82F6; border-left-style:dashed; background:rgba(59,130,246,.08); color:#000000; font-weight:650; }
</style>
</head>
<body><div class="card"><div class="brand" role="img" aria-label="GoodFolder">${INLINE_BRAND_MARK}${INLINE_BRAND_WORDMARK}</div>${bodyHtml}</div></body>
</html>`;
}

app.get("/auth/verify", (c) => {
  const url = new URL(c.req.url);
  const rawToken = url.searchParams.get("t") ?? "";
  const token = /^[A-Za-z0-9_-]+$/.test(rawToken) ? rawToken : "";
  const next = safeNextPath(url.searchParams.get("next"));
  return c.html(
    page(
      "Signing you in",
      `<h1>Signing you in…</h1><p id="msg">One moment.</p>
<noscript><p class="err">This page needs JavaScript once to finish signing in.</p></noscript>
<script>
(function () {
  var msg = document.getElementById("msg");
  fetch("/api/auth/magic-consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: ${JSON.stringify(token)} })
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.ok) {
      msg.textContent = "Signed in as " + j.email + ". Continuing…";
      setTimeout(function () { location.replace(${JSON.stringify(next)}); }, 500);
    } else {
      msg.className = "err";
      msg.textContent = "That link has expired or was already used. Start again from the app to get a new one.";
    }
  }).catch(function () {
    msg.className = "err";
    msg.textContent = "Could not reach GoodFolder. Check your connection and reload.";
  });
})();
</script>`,
    ),
  );
});

app.get("/pair/:code", async (c) => {
  const code = c.req.param("code");
  if (!/^[a-f0-9]{32}$/.test(code)) {
    return c.html(page("Approval link", `<h1>This approval link isn't valid.</h1>
<p>Start again from the app or terminal that asked to connect.</p>`));
  }
  const rows = await sql`
    SELECT device_name AS "deviceName", status, expires_at
    FROM pairing_requests WHERE code = ${code} LIMIT 1`;
  const pr = rows[0];
  if (
    !pr ||
    pr.status !== "pending" ||
    new Date(pr.expires_at as string).getTime() < Date.now()
  ) {
    return c.html(page("Approval link", `<h1>This approval request has expired.</h1>
<p>For safety, approval links work for ${PAIRING_TTL_MINUTES} minutes.
Start again from the app that asked to connect.</p>`));
  }

  const session = await sessionAccount(c);
  const device = escapeHtml(String(pr.deviceName));

  if (session) {
    return c.html(
      page(
        "Approve this computer",
        `<h1>Approve “${device}”?</h1>
<p>It will be able to save, sync, and open folders on your GoodFolder account
<strong>${escapeHtml(session.email)}</strong>.</p>
<button id="approve">Approve this computer</button>
<p id="msg"></p>
<script>
(function () {
  var btn = document.getElementById("approve");
  var msg = document.getElementById("msg");
  btn.onclick = function () {
    btn.disabled = true;
    fetch("/api/pair/${code}/approve", { method: "POST", credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          msg.className = "ok";
          msg.textContent = "Approved. You can close this window and return to your app.";
          btn.style.display = "none";
        } else {
          msg.className = "err";
          msg.textContent = (j && j.message) || "Could not approve. Try again.";
          btn.disabled = false;
        }
      })
      .catch(function () {
        msg.className = "err";
        msg.textContent = "Network problem — try again.";
        btn.disabled = false;
      });
  };
})();
</script>`,
      ),
    );
  }

  return c.html(
    page(
      "Connect a computer",
      `<h1>Connect “${device}”?</h1>
<p>First sign in with your email — we'll send you a one-time link.</p>
<input id="email" type="email" placeholder="you@example.com" autocomplete="email">
<button id="sendlink">Email me a sign-in link</button>
<p id="msg"></p>
<script>
(function () {
  var btn = document.getElementById("sendlink");
  var input = document.getElementById("email");
  var msg = document.getElementById("msg");
  function go() {
    var email = input.value.trim().toLowerCase();
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) {
      msg.className = "err"; msg.textContent = "That doesn't look like an email address.";
      return;
    }
    btn.disabled = true; input.disabled = true;
    msg.className = ""; msg.textContent = "Sending…";
    fetch("/api/auth/magic-request", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email, next: "/pair/${code}" })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) {
        msg.textContent = "Check your inbox — tap the link to finish connecting.";
      } else {
        msg.className = "err";
        msg.textContent = (j && j.message) || "Could not send the link. Try again shortly.";
        btn.disabled = false; input.disabled = false;
      }
    }).catch(function () {
      msg.className = "err"; msg.textContent = "Network problem — try again.";
      btn.disabled = false; input.disabled = false;
    });
  }
  btn.onclick = go;
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
})();
</script>`,
    ),
  );
});

// --- Public auth + pairing API (no bearer; cookie routes noted) ------------

app.post("/api/auth/magic-request", async (c) => {
  const b = await c.req.json<{
    email?: string;
    next?: string;
    pairCode?: string;
  }>().catch(() => ({}) as { email?: string; next?: string; pairCode?: string });
  const email = b.email?.trim().toLowerCase() ?? "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return c.json({ error: { code: "email", message: "valid email required" } }, 400);
  }
  const next = safeNextPath(b.next);
  let pairCode: string | null = null;
  if (typeof b.pairCode === "string" && /^[a-f0-9]{32}$/.test(b.pairCode)) pairCode = b.pairCode;

  const ip = clientIp(c.req.raw.headers);
  if (!rateLimit("magic-email", email, 3, 3_600_000)) {
    return c.json({ error: { code: "rate", message: "too many requests — try again later" } }, 429);
  }
  if (!rateLimit("magic-ip", ip, 10, 3_600_000)) {
    return c.json({ error: { code: "rate", message: "too many requests — try again later" } }, 429);
  }

  const magic = newUrlToken("gfm");
  await sql`
    INSERT INTO magic_links (token_hash, email, next_path, pair_code, expires_at)
    VALUES (${magic.hash}, ${email}, ${next}, ${pairCode},
            now() + (${MAGIC_TTL_MINUTES} || ' minutes')::interval)`;

  const link = `${PUBLIC_BASE}/auth/verify?t=${encodeURIComponent(magic.raw)}&next=${encodeURIComponent(next)}`;
  await sendMagicLink(email, link);
  await sql`
    INSERT INTO audit_log (actor, action, detail)
    VALUES (${email}, 'auth.magic_request', ${sql.json({ next, paired: !!pairCode })})`;

  const body: Record<string, unknown> = { ok: true };
  if (MAGIC_LINK_DEBUG && !RESEND_API_KEY) body.debugLink = link;
  return c.json(body);
});

app.post("/api/auth/magic-consume", async (c) => {
  const b = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
  const token = b.token ?? "";
  if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length > 100) {
    return c.json({ error: { code: "token", message: "invalid link" } }, 400);
  }
  if (!rateLimit("consume-ip", clientIp(c.req.raw.headers), 30, 3_600_000)) {
    return c.json({ error: { code: "rate", message: "too many requests" } }, 429);
  }

  // Atomic consume: only the first claim wins.
  const claimed = await sql`
    UPDATE magic_links SET consumed_at = now()
    WHERE token_hash = ${sha256(token)}
      AND consumed_at IS NULL AND expires_at > now()
    RETURNING email, next_path, pair_code`;
  const link = claimed[0];
  if (!link) {
    return c.json({ error: { code: "expired", message: "link expired or already used" } }, 400);
  }
  const email = String(link.email);

  await sql`
    INSERT INTO accounts (id, email) VALUES (${crypto.randomUUID()}, ${email})
    ON CONFLICT (email) DO NOTHING`;
  const acct = await sql`SELECT id FROM accounts WHERE email = ${email} LIMIT 1`;
  const accountId = String(acct[0]!.id);

  const rawSession = await createSession(accountId);
  c.header("Set-Cookie", sessionCookie(rawSession));
  await sql`
    INSERT INTO audit_log (actor, action, detail)
    VALUES (${email}, 'auth.signed_in', ${sql.json({
      paired: Boolean(link.pair_code),
    })})`;

  return c.json({
    ok: true,
    email,
    next: safeNextPath(link.next_path ?? undefined),
  });
});

app.post("/api/pair/start", async (c) => {
  const b = await c.req.json<{ deviceName?: string }>().catch(() => ({}) as { deviceName?: string });
  const deviceName =
    typeof b.deviceName === "string" ? b.deviceName.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (!deviceName) {
    return c.json({ error: { code: "name", message: "device name required" } }, 400);
  }
  if (!rateLimit("pair-ip", clientIp(c.req.raw.headers), 10, 3_600_000)) {
    return c.json({ error: { code: "rate", message: "too many requests — try again later" } }, 429);
  }

  const code = randomBytes(16).toString("hex");
  await sql`
    INSERT INTO pairing_requests (code, device_name, expires_at)
    VALUES (${code}, ${deviceName}, now() + (${PAIRING_TTL_MINUTES} || ' minutes')::interval)`;
  await sql`
    INSERT INTO audit_log (actor, action, detail)
    VALUES (${deviceName}, 'pair.start', ${sql.json({})})`;

  return c.json({ code, url: `${PUBLIC_BASE}/pair/${code}` });
});

/**
 * Polled by the CLI while the person approves in the browser. The pairing
 * code doubles as the bearer here — whoever started the pairing is the only
 * party that can collect the credential.
 */
app.get("/api/pair/:code/wait", async (c) => {
  const code = c.req.param("code");
  if (!/^[a-f0-9]{32}$/.test(code)) {
    return c.json({ status: "unknown" }, 404);
  }
  const rows = await sql`
    SELECT status, delivery, expires_at FROM pairing_requests
    WHERE code = ${code} LIMIT 1`;
  const pr = rows[0];
  if (!pr) return c.json({ status: "unknown" }, 404);
  if (pr.status === "pending" && new Date(pr.expires_at as string).getTime() < Date.now()) {
    return c.json({ status: "expired" });
  }
  if (pr.status === "approved") {
    // Hand the credential over exactly once.
    const won = await sql`
      UPDATE pairing_requests SET status = 'consumed'
      WHERE code = ${code} AND status = 'approved'
      RETURNING delivery`;
    const blob = won[0]?.delivery;
    if (!blob) return c.json({ status: "consumed" });
    const token = openDelivery(code, Buffer.from(blob as Uint8Array));
    if (!token) return c.json({ error: { code: "delivery", message: "corrupt delivery" } }, 500);
    return c.json({ status: "approved", token });
  }
  return c.json({ status: pr.status }); // pending | denied | consumed
});

app.post("/api/pair/:code/approve", async (c) => {
  const session = await sessionAccount(c);
  if (!session) {
    return c.json(
      { error: { code: "signin", message: "Sign in first — open this page from the approval link." } },
      401,
    );
  }
  const code = c.req.param("code");
  if (!/^[a-f0-9]{32}$/.test(code)) {
    return c.json({ error: { code: "code", message: "invalid approval link" } }, 404);
  }
  const rows = await sql`
    SELECT device_name AS "deviceName", status, expires_at
    FROM pairing_requests WHERE code = ${code} LIMIT 1`;
  const pr = rows[0];
  if (
    !pr ||
    pr.status !== "pending" ||
    new Date(pr.expires_at as string).getTime() < Date.now()
  ) {
    return c.json(
      { error: { code: "expired", message: "This approval request has expired." } },
      410,
    );
  }

  const dev = newUrlToken("gfa");
  const deviceId = crypto.randomUUID();
  const sealed = sealDelivery(code, dev.raw);
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO account_devices (id, account_id, name, token_hash)
      VALUES (${deviceId}, ${session.accountId}, ${String(pr.deviceName)}, ${dev.hash})`;
    await tx`
      UPDATE pairing_requests
      SET status = 'approved', account_id = ${session.accountId},
          account_device_id = ${deviceId}, delivery = ${sealed}
      WHERE code = ${code}`;
  });
  await sql`
    INSERT INTO audit_log (actor, action, detail)
    VALUES (${session.email}, 'pair.approved', ${sql.json({
      deviceName: String(pr.deviceName),
      accountId: session.accountId,
    })})`;

  return c.json({ ok: true });
});

// --- Session-cookie routes --------------------------------------------------

app.get("/api/me", async (c) => {
  const session = await sessionAccount(c);
  if (!session) return c.json({ error: { code: "unauthorized" } }, 401);
  return c.json({ id: session.accountId, email: session.email });
});

app.post("/api/auth/logout", async (c) => {
  const v = parseCookies(c.req.header("cookie"))[SESSION_COOKIE];
  if (v && /^[A-Za-z0-9_-]+$/.test(v)) {
    await sql`DELETE FROM sessions WHERE token_hash = ${sha256(v)}`;
  }
  c.header("Set-Cookie", clearedSessionCookie());
  return c.json({ ok: true });
});

app.get("/account", async (c) => {
  const session = await sessionAccount(c);
  if (!session) {
    return c.html(
      page(
        "Signed out",
        `<h1>You're signed out.</h1><p>Start again from the app that sent you here.</p>`,
      ),
    );
  }
  return c.html(
    page(
      "Your account",
      `<h1>Signed in ✓</h1><p>${escapeHtml(session.email)}</p>
<p style="font-size:14px">You can close this window.</p>`,
    ),
  );
});

// ---------------------------------------------------------------------------
// Account management — reachable with EITHER credential that proves the
// account: an approved device's bearer token (CLI, agents) OR the browser
// session cookie (dashboard, site tools). Registered above the bearer
// middleware because the browser never sends a bearer.
// ---------------------------------------------------------------------------

async function accountFrom(c: {
  req: { header: (n: string) => string | undefined };
}): Promise<
  | { kind: "account"; accountId: string; email: string; accountDeviceId: string }
  | null
> {
  const raw = tokenFromAuthHeader(c.req.header("Authorization"));
  if (raw) {
    const ctx = await resolveAuthContext(sql, raw);
    if (ctx && ctx.kind === "account") return ctx;
    return null;
  }
  const session = await sessionAccount(c);
  if (!session) return null;
  return { kind: "account", accountId: session.accountId, email: session.email, accountDeviceId: "session" };
}

function billingError(error: unknown): { code: string; message: string; status: 400 | 402 | 409 | 503 } {
  const code = (error as Error).message;
  if (code === "billing-unavailable") return { code, message: "Hosted billing is not available on this server.", status: 503 };
  if (code === "subscription-required") return { code, message: "Start your hosted trial before changing a folder.", status: 402 };
  if (code === "subscription-active") return { code, message: "This account already has hosted access.", status: 409 };
  if (code === "invalid-plan") return { code, message: "Choose a valid plan.", status: 400 };
  if (code === "overage-cap") return { code, message: "Choose no overage or a $10 step between $10 and $100.", status: 400 };
  return { code: "billing-unavailable", message: "Billing could not be reached. Try again shortly.", status: 503 };
}

async function challengeAccessError(accountId: string): Promise<{ code: string; message: string; status: 402 | 403 } | null> {
  if (!challengeEnabled || !challengeExpiry) return null;
  const account = await sql`SELECT email FROM accounts WHERE id = ${accountId} LIMIT 1`;
  if (challengeStaffEmails.has(String(account[0]?.email ?? "").toLowerCase())) return null;
  const grant = await sql`
    SELECT expires_at AS "expiresAt" FROM campaign_access_redemptions
    WHERE account_id = ${accountId} AND campaign = ${CHALLENGE_CAMPAIGN}
    LIMIT 1`;
  if (grant[0] && new Date(String(grant[0].expiresAt)).getTime() > Date.now()) return null;
  if (grant[0]) {
    // The campaign ends cleanly, but a later paid or card-backed trial must
    // be able to restore write access without deleting this historical grant.
    if (billingConfig.mode === "stripe" && (await billing.entitlement(accountId)).canWrite) return null;
    return { code: "challenge-access-ended", message: "Your WebMCP Challenge access ended on October 1. Your folders remain available to read and export; start a hosted trial to keep changing them.", status: 403 };
  }
  return { code: "challenge-access-required", message: "Redeem the WebMCP Challenge code before changing a folder.", status: 402 };
}

async function writeAccessError(accountId: string): Promise<{ code: string; message: string; status: 402 | 403 | 409 } | null> {
  const challengeDenied = await challengeAccessError(accountId);
  if (challengeDenied) return challengeDenied;
  const entitlement = await billing.entitlement(accountId);
  if (entitlement.canWrite) return null;
  if (entitlement.reason === "quota-exceeded") {
    return { code: "quota-exceeded", message: "This account has reached its protected-data limit. Existing files and earlier versions are still available.", status: 409 };
  }
  if (entitlement.reason === "read-only") {
    return { code: "read-only", message: "This account is in read and export mode. Existing files and earlier versions are still available.", status: 403 };
  }
  return { code: "subscription-required", message: "Start the hosted trial before changing a folder.", status: 402 };
}

async function projectWriteAccessError(projectId: string): Promise<{ code: string; message: string; status: 402 | 403 | 409 } | null> {
  const rows = await sql`SELECT account_id AS "accountId" FROM projects WHERE id = ${projectId} LIMIT 1`;
  return rows[0]?.accountId ? writeAccessError(String(rows[0].accountId)) : null;
}

app.get("/api/account/plan", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  return c.json(await billing.plan(acct.accountId));
});

app.get("/api/account/usage", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const plan = await billing.plan(acct.accountId);
  return c.json({
    usageBytes: plan.usageBytes,
    reservedBytes: plan.reservedBytes,
    includedBytes: plan.includedBytes,
    authorizedBytes: plan.authorizedBytes,
    accruedOverageCents: plan.accruedOverageCents,
    accruedExcessGbMonth: plan.accruedExcessGbMonth,
    canWrite: plan.canWrite,
    reason: plan.reason,
  });
});

app.post("/api/access/challenge/redeem", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "Sign in before redeeming a challenge code." } }, 403);
  if (!challengeEnabled || !challengeExpiry || challengeExpiry.getTime() <= Date.now()) {
    return c.json({ error: { code: "challenge-unavailable", message: "WebMCP Challenge access is not available." } }, 404);
  }
  if (!rateLimit("challenge-redeem", acct.accountId, 10, 3_600_000)) {
    return c.json({ error: { code: "rate", message: "Too many code attempts. Try again later." } }, 429);
  }
  const body = await c.req.json<{ code?: string }>().catch(() => ({} as { code?: string }));
  if (!sameSecret(String(body.code ?? "").trim(), challengeCode)) {
    return c.json({ error: { code: "challenge-code", message: "That challenge code is not valid." } }, 400);
  }
  await sql`
    INSERT INTO campaign_access_redemptions (id, account_id, campaign, expires_at)
    VALUES (${crypto.randomUUID()}, ${acct.accountId}, ${CHALLENGE_CAMPAIGN}, ${challengeExpiry})
    ON CONFLICT (account_id, campaign) DO NOTHING`;
  await sql`INSERT INTO audit_log (actor, action, detail)
    VALUES (${acct.email}, 'access.challenge_redeem', ${sql.json({ campaign: CHALLENGE_CAMPAIGN, expiresAt: challengeExpiry.toISOString() })})`;
  return c.json({ ok: true, expiresAt: challengeExpiry.toISOString() });
});

app.get("/api/plans", (c) => c.json(PLANS));

app.post("/api/billing/checkout", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "Sign in before starting a trial." } }, 403);
  const body = await c.req.json<{ plan?: string; interval?: string }>().catch(() => ({} as { plan?: string; interval?: string }));
  const planCode = isPlanCode(body.plan) ? body.plan : null;
  const interval = body.interval === "year" ? "year" : "month";
  if (!planCode) return c.json({ error: { code: "invalid-plan", message: "Choose a valid plan." } }, 400);
  try {
    return c.json(await billing.createCheckout(acct.accountId, acct.email, planCode, interval));
  } catch (error) {
    const failure = billingError(error);
    return c.json({ error: { code: failure.code, message: failure.message } }, failure.status);
  }
});

app.post("/api/billing/portal", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "Sign in to manage billing." } }, 403);
  try {
    return c.json(await billing.createPortal(acct.accountId));
  } catch (error) {
    const failure = billingError(error);
    return c.json({ error: { code: failure.code, message: failure.message } }, failure.status);
  }
});

app.put("/api/billing/overage", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "Sign in to change the spending limit." } }, 403);
  const body = await c.req.json<{ capCents?: number }>().catch(() => ({} as { capCents?: number }));
  try {
    await billing.setOverageCap(acct.accountId, Number(body.capCents));
    return c.json(await billing.plan(acct.accountId));
  } catch (error) {
    const failure = billingError(error);
    return c.json({ error: { code: failure.code, message: failure.message } }, failure.status);
  }
});

app.post("/api/billing/webhook", async (c) => {
  if (!billingConfig.stripe) return c.json({ error: { code: "billing-unavailable" } }, 503);
  const rawBody = await c.req.text();
  let event;
  try {
    event = billing.verifyWebhook(rawBody, c.req.header("Stripe-Signature"));
  } catch {
    return c.json({ error: { code: "signature", message: "Invalid webhook signature." } }, 401);
  }
  try {
    return c.json({ ok: true, result: await billing.applyWebhook(event) });
  } catch (error) {
    console.error("Stripe webhook failed:", error);
    return c.json({ error: { code: "webhook", message: "Webhook processing failed." } }, 500);
  }
});

/** List the account's folders, newest first. */
app.get("/api/projects", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) {
    return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  }
  const rows = await sql`
    SELECT p.id, p.name,
           p.created_at::text AS "createdAt",
           (SELECT MAX(s.seq)::int FROM saves s WHERE s.project_id = p.id) AS "lastSeq",
           (SELECT MAX(s.created_at)::text FROM saves s WHERE s.project_id = p.id) AS "lastSaveAt",
           CASE WHEN p.account_id = ${acct.accountId} THEN 'owner' ELSE 'contributor' END AS role,
           (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id = p.id) AS "contributorCount",
           (SELECT COUNT(*)::int FROM change_proposals cp WHERE cp.project_id = p.id AND cp.status IN ('open','needs-review')) AS "openProposalCount"
    FROM projects p
    LEFT JOIN project_members mine ON mine.project_id = p.id AND mine.account_id = ${acct.accountId}
    WHERE p.account_id = ${acct.accountId} OR mine.account_id = ${acct.accountId}
    ORDER BY p.created_at DESC LIMIT 200`;
  return c.json(rows);
});

/**
 * Create a folder on an approved account: project + transport device +
 * folder token in one transaction. The replacement for dev bootstrap.
 */
app.post("/api/projects", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) {
    return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  }
  const denied = await writeAccessError(acct.accountId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  if (!rateLimit("project-create", acct.accountId, 30, 3_600_000)) {
    return c.json({ error: { code: "rate", message: "too many folders created — try again later" } }, 429);
  }
  const b = await c.req.json<{ name?: string; deviceName?: string }>().catch(
    () => ({}) as { name?: string; deviceName?: string },
  );
  const name =
    typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim().slice(0, 80) || "My Folder" : "My Folder";
  const deviceName =
    typeof b.deviceName === "string"
      ? b.deviceName.replace(/\s+/g, " ").trim().slice(0, 60) || "This device"
      : "This device";

  const projectId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const tok = newToken();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO projects (id, account_id, name)
      VALUES (${projectId}, ${acct.accountId}, ${name})`;
    await tx`
      INSERT INTO devices (id, project_id, name, kind)
      VALUES (${deviceId}, ${projectId}, ${deviceName}, 'user')`;
    await tx`
      INSERT INTO transfer_tokens (token_hash, device_id, expires_at)
      VALUES (${tok.hash}, ${deviceId}, now() + interval '30 days')`;
  });

  const repo = await repos.ensureRepo(projectId);
  await sql`
    INSERT INTO audit_log (actor, action, detail)
    VALUES (${acct.email}, 'project.create', ${sql.json({ projectId, name, repo })})`;

  return c.json({ projectId, deviceId, token: tok.raw, repo });
});

/** Permanently delete one owned GoodFolder after an exact-name confirmation. */
app.delete("/api/projects/:id", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) {
    return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  }
  const projectId = c.req.param("id");
  const body = await c.req.json<{ name?: unknown }>().catch(() => ({} as { name?: unknown }));
  const result = await billing.deleteFolder(
    acct.accountId,
    projectId,
    typeof body.name === "string" ? body.name : "",
    acct.email,
  );
  if (result.status === "not-found") {
    return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  }
  if (result.status === "confirmation") {
    return c.json({
      error: { code: "confirmation", message: "Type the folder's exact name to confirm permanent deletion." },
    }, 409);
  }
  return c.json({ ok: true, projectId, name: result.name });
});

/** Mint an extra folder token (second device / second machine). */
app.post("/api/projects/:id/token", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) {
    return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  }
  const projectId = c.req.param("id");
  const own = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND account_id = ${acct.accountId} LIMIT 1`;
  if (own.length === 0) {
    return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  }
  const denied = await writeAccessError(acct.accountId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  const deviceId = crypto.randomUUID();
  const tok = newToken();
  const body = await c.req.json<{ deviceName?: string }>().catch(
    () => ({}) as { deviceName?: string },
  );
  const deviceName =
    typeof body?.deviceName === "string"
      ? body.deviceName.replace(/\s+/g, " ").trim().slice(0, 60) || "Paired device"
      : "Paired device";
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO devices (id, project_id, name, kind)
      VALUES (${deviceId}, ${projectId}, ${deviceName}, 'user')`;
    await tx`
      INSERT INTO transfer_tokens (token_hash, device_id, expires_at)
      VALUES (${tok.hash}, ${deviceId}, now() + interval '30 days')`;
  });
  await sql`
    INSERT INTO audit_log (actor, action, detail)
    VALUES (${acct.email}, 'project.token_minted', ${sql.json({ projectId })})`;
  return c.json({ projectId, token: tok.raw });
});

/** Timeline read — powers the dashboard, site tools, and CLI log alike. */
app.get("/api/projects/:id/saves", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) {
    return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  }
  const projectId = c.req.param("id");
  const access = await projectAccess(projectId, acct.accountId);
  if (!access) {
    return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  }
  // paths=full swaps the compact receipt for complete path lists (capped),
  // which restore previews need to say what would come back.
  const wantFull = c.req.query("paths") === "full";
  const rows = await sql`
    SELECT s.seq, s.label, s.label_source AS "labelSource", s.collision,
           s.created_at::text AS "createdAt",
           s.added_count AS "addedCount", s.changed_count AS "changedCount",
           s.removed_count AS "removedCount",
           s.top_paths AS "topPaths",
           ${wantFull ? sql`s.changed_paths AS "changedPaths"` : sql`'[]'::jsonb AS "changedPaths"`},
           s.harness, d.name AS "deviceName"
    FROM saves s LEFT JOIN devices d ON d.id = s.actor_device_id
    WHERE s.project_id = ${projectId}
    ORDER BY s.seq DESC LIMIT 100`;
  const shaped = (rows as Array<Record<string, unknown>>).map((r) => {
    if (!wantFull) return r;
    const paths = Array.isArray(r.changedPaths) ? (r.changedPaths as string[]) : [];
    return {
      ...r,
      changedPaths: paths.slice(0, 100),
      changedPathsTruncated: paths.length > 100,
    };
  });
  return c.json(shaped);
});

type ProjectRole = "owner" | "contributor";

async function projectAccess(projectId: string, accountId: string): Promise<ProjectRole | null> {
  const rows = await sql`
    SELECT CASE WHEN p.account_id = ${accountId} THEN 'owner' ELSE pm.role END AS role
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.account_id = ${accountId}
    WHERE p.id = ${projectId} AND (p.account_id = ${accountId} OR pm.account_id = ${accountId})
    LIMIT 1`;
  const role = rows[0]?.role;
  return role === "owner" || role === "contributor" ? role : null;
}

/**
 * What a person may type into directly, here in the browser.
 *
 * Deliberately narrower than what can be *proposed* below. A plain text box
 * is a fine way to fix a sentence or a cell and a poor way to write code —
 * no highlighting, no indentation, nothing that makes source readable. So
 * source files are read here and changed by proposal, not by hand.
 */
const EDITABLE_DOCUMENT = /\.(md|markdown|txt|csv|tsv)$/i;

/**
 * What can be read as text, and therefore what a Change Proposal can anchor
 * into. A proposal replaces an exact passage with another, which works the
 * same on a paragraph and on a function.
 *
 * One predicate rather than a list: this used to be a third hand-kept copy of
 * the text extension list, and it is the one that actually decides, so a type
 * both copies of `previewKindFor` called text could still be refused here.
 */
function isTextDocument(path: string): boolean {
  return previewKindFor(path) === "text";
}

function previewMime(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" } as Record<string, string>)[ext ?? ""] ?? null;
}

async function ensureWebDevice(projectId: string): Promise<string> {
  const existing = await sql`
    SELECT id FROM devices WHERE project_id = ${projectId} AND name = 'GoodFolder web' LIMIT 1`;
  if (existing[0]?.id) return String(existing[0].id);
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO devices (id, project_id, name, kind)
    VALUES (${id}, ${projectId}, 'GoodFolder web', 'user')`;
  return id;
}

async function recordWebSave(input: {
  projectId: string;
  commitSha: string;
  label: string;
  /** Every path this save touched — what tells each file when it last changed. */
  changedPaths: string[];
  accountEmail: string;
  /**
   * What a person should read beside the label. A rename touches two paths
   * per file and changes one file, so the count is not always the length of
   * the list above. Left out, it says the whole list changed.
   */
  counts?: { added?: number; changed?: number; removed?: number };
}): Promise<number> {
  const deviceId = await ensureWebDevice(input.projectId);
  const added = input.counts?.added ?? 0;
  const removed = input.counts?.removed ?? 0;
  const changed = input.counts?.changed ?? (input.counts ? 0 : input.changedPaths.length);
  const rows = await sql`
    INSERT INTO saves (id, project_id, seq, label, label_source, actor_device_id,
                       changed_paths, commit_sha, added_count, changed_count, removed_count,
                       top_paths, harness)
    SELECT ${crypto.randomUUID()}, ${input.projectId}, COALESCE(MAX(s.seq), 0) + 1,
           ${input.label.slice(0, 120)}, 'user', ${deviceId},
           ${sql.json(input.changedPaths)}, ${input.commitSha}, ${added}, ${changed}, ${removed},
           ${sql.json(input.changedPaths.slice(0, 10))}, 'GoodFolder web'
    FROM saves s WHERE s.project_id = ${input.projectId}
    RETURNING seq`;
  await sql`
    INSERT INTO audit_log (actor, action, detail)
    VALUES (${input.accountEmail}, 'document.saved', ${sql.json({ projectId: input.projectId, paths: input.changedPaths })})`;
  void billing.refreshProject(input.projectId, "web-save").catch((error) => {
    console.error("usage refresh after browser save failed:", error);
  });
  return Number(rows[0]!.seq);
}

app.get("/api/projects/:id/files", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  const role = await projectAccess(projectId, acct.accountId);
  if (!role) return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  let head: string | null;
  let tree: Awaited<ReturnType<typeof repos.tree>>;
  try {
    [head, tree] = await Promise.all([repos.head(projectId), repos.tree(projectId)]);
  } catch (error) {
    if ((error as { code?: string }).code === "folder-too-large") {
      return c.json({
        error: {
          code: "folder-too-large",
          message: "This folder holds more files than the browser can show. Open it on the computer where it lives.",
        },
      }, 413);
    }
    throw error;
  }
  return c.json({
    role,
    head,
    files: tree.filter((item) => item.type === "blob").map((item) => ({
      path: item.path,
      size: item.size,
      sha: item.sha,
      editable: EDITABLE_DOCUMENT.test(item.path),
      proposable: isTextDocument(item.path),
      previewable: previewKindFor(item.path) !== null,
      previewKind: previewKindFor(item.path),
    })),
  });
});

app.get("/api/projects/:id/file", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  const role = await projectAccess(projectId, acct.accountId);
  if (!role) return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  const path = safeDocumentPath(c.req.query("path"));
  if (!path) return c.json({ error: { code: "path", message: "valid file path required" } }, 400);
  const file = await repos.readFile(projectId, path);
  if (!file) return c.json({ error: { code: "not-found", message: "file not found" } }, 404);
  const kind = previewKindFor(path);
  // A remotely stored file reads back as a small text pointer. Name the real
  // size and say so — the browser view explains where the bytes live instead
  // of pretending the file is 130 bytes long.
  const pointer = parseStoredFilePointer(file.content);
  if (pointer) {
    return c.json({
      path,
      size: pointer.size,
      sha: file.sha,
      role,
      previewable: false,
      previewKind: null,
      storedForDevice: true,
    });
  }
  const binaryMime = previewMime(path);
  if (binaryMime) {
    if (file.size > 5_000_000) return c.json({ error: { code: "too-large", message: "This preview is too large for the browser." } }, 413);
    return c.json({ path, size: file.size, sha: file.sha, role, previewable: true, editable: false, proposable: false, previewKind: kind, mimeType: binaryMime, contentBase64: file.content.toString("base64") });
  }
  if (file.size > 1_000_000) return c.json({ error: { code: "too-large", message: "This file is too large to preview here." } }, 413);
  if (!isTextDocument(path)) {
    return c.json({ path, size: file.size, sha: file.sha, role, previewable: false, editable: false, proposable: false, previewKind: null, storedForDevice: false });
  }
  return c.json({ path, size: file.size, sha: file.sha, role, previewable: true, editable: EDITABLE_DOCUMENT.test(path), proposable: isTextDocument(path), previewKind: kind, content: file.content.toString("utf8") });
});

// Raw preview bytes for everything the browser can render itself. Text kinds
// keep using /file (JSON). This endpoint either streams bytes with a real
// content type — inline for small files, straight from object storage for
// remotely stored ones, piped through without buffering — or answers with a
// small JSON descriptor explaining why there is nothing to show. It runs
// under the same account authorization as every other /api/projects route.
app.get("/api/projects/:id/file/raw", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  const role = await projectAccess(projectId, acct.accountId);
  if (!role) return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  const path = safeDocumentPath(c.req.query("path"));
  if (!path) return c.json({ error: { code: "path", message: "valid file path required" } }, 400);
  const kind = previewKindFor(path);
  if (kind === "text") {
    return c.json({ error: { code: "unsupported", message: "Text files are read through the document endpoint." } }, 415);
  }
  const file = await repos.readFile(projectId, path);
  if (!file) return c.json({ error: { code: "not-found", message: "file not found" } }, 404);
  const pointer = parseStoredFilePointer(file.content);
  const realSize = pointer ? pointer.size : file.size;
  if (!kind || !previewMimeFor(path)) {
    // Not a browser-viewable byte type. Describe it honestly instead.
    return c.json({
      path,
      size: realSize,
      sha: file.sha,
      role,
      previewable: false,
      previewKind: null,
      storedForDevice: pointer !== null,
    });
  }
  if (realSize > PREVIEW_BYTE_CAP) {
    return c.json({
      size: realSize,
      error: {
        code: "too-large",
        message: `This file is ${(realSize / 1_000_000).toFixed(1)} MB — bigger than the ${(PREVIEW_BYTE_CAP / 1_000_000).toFixed(0)} MB a browser preview can carry. Open it on a connected computer; it is kept safe.`,
      },
    }, 413);
  }
  const mime = previewMimeFor(path)!;
  const headers: Record<string, string> = {
    "content-type": mime,
    "cache-control": "private, max-age=60",
    "x-content-type-options": "nosniff",
  };
  // SVG can run scripts when opened as a document (never through <img>). The
  // sandbox directive gives any direct navigation an isolated origin with
  // scripting disabled; rendering inside <img> is unaffected.
  if (mime === "image/svg+xml") headers["content-security-policy"] = "sandbox";
  try {
    if (pointer) {
      const object = await previewStorage.send(
        new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: `${projectId}/${pointer.oid}` }),
      );
      const body = object.Body ? await object.Body.transformToWebStream() : null;
      if (!body) throw new Error("empty object body");
      headers["content-length"] = String(object.ContentLength ?? realSize);
      return c.body(body, 200, headers);
    }
    const inline = file.content.buffer.slice(
      file.content.byteOffset,
      file.content.byteOffset + file.content.byteLength,
    ) as ArrayBuffer;
    headers["content-length"] = String(inline.byteLength);
    return c.body(inline, 200, headers);
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchKey") {
      return c.json({
        size: realSize,
        error: {
          code: "missing",
          message: "The stored copy of this file is missing. Save the folder again from a connected computer.",
        },
      }, 404);
    }
    throw error;
  }
});

app.post("/api/projects/:id/document/save", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  if (await projectAccess(projectId, acct.accountId) !== "owner") {
    return c.json({ error: { code: "owner-only", message: "Only the folder owner can save directly. Create a Change Proposal instead." } }, 403);
  }
  const denied = await projectWriteAccessError(projectId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  const body = await c.req.json<{ path?: string; content?: string; baseHead?: string | null; label?: string }>().catch(() => ({} as { path?: string; content?: string; baseHead?: string | null; label?: string }));
  const path = safeDocumentPath(body.path);
  if (!path || !EDITABLE_DOCUMENT.test(path)) return c.json({ error: { code: "path", message: "Choose a supported document." } }, 400);
  if (typeof body.content !== "string" || Buffer.byteLength(body.content) > 1_000_000) return c.json({ error: { code: "content", message: "Document is missing or too large." } }, 400);
  const gate = checkWrite({
    tree: await repos.tree(projectId),
    writes: [{ path, sizeBytes: Buffer.byteLength(body.content) }],
  });
  if (!gate.ok) return c.json({ error: { code: gate.refusal.code, message: gate.refusal.message } }, gate.refusal.status);
  const currentFile = await repos.readFile(projectId, path);
  if (currentFile && parseStoredFilePointer(currentFile.content)) {
    return c.json({ error: { code: "stored-for-device", message: "That file is stored on a connected computer and cannot be edited in the browser yet." } }, 409);
  }
  try {
    const saved = await repos.writeFile({ projectId, path, content: Buffer.from(body.content), message: body.label?.slice(0, 80) || `Edited ${path}`, expectedHead: body.baseHead ?? null });
    const seq = await recordWebSave({ projectId, commitSha: saved.commitSha, label: body.label || `Edited ${path}`, changedPaths: [path], accountEmail: acct.email });
    return c.json({ ok: true, head: saved.commitSha, saveNumber: seq });
  } catch (error) {
    if ((error as { code?: string }).code === "newer-work") return c.json({ error: { code: "newer-work", message: "Newer work arrived while you were editing. Your draft is still here; review the latest save before trying again." } }, 409);
    throw error;
  }
});

/* --------------------------------------------------------------------------
   Adding, renaming and taking out files from the browser.

   Only the owner. Someone invited to a folder reaches the same three verbs
   through a Change Proposal, which the owner accepts — the boundary that
   makes an invitation safe to hand out is that nothing an invited person
   does lands in the folder without the owner saying so.

   All three go through `checkWrite` and none of them reach for the engine
   twice: a rename is one save that both adds and takes away, so there is no
   moment where the folder holds two copies or none.
-------------------------------------------------------------------------- */

/** How many files one browser gesture may move at once. */
const BATCH_ENTRY_CAP = 500;

async function requireOwnerWrite(
  c: Context,
): Promise<{ ok: true; projectId: string; email: string } | { ok: false; response: Response }> {
  const acct = await accountFrom(c);
  if (!acct) {
    return { ok: false, response: c.json({ error: { code: "account-scope", message: "account approval required" } }, 403) };
  }
  const projectId = c.req.param("id") ?? "";
  if (await projectAccess(projectId, acct.accountId) !== "owner") {
    return {
      ok: false,
      response: c.json({
        error: { code: "owner-only", message: "Only the folder owner can change files directly. Send a Change Proposal instead." },
      }, 403),
    };
  }
  const denied = await projectWriteAccessError(projectId);
  if (denied) {
    return { ok: false, response: c.json({ error: { code: denied.code, message: denied.message } }, denied.status) };
  }
  return { ok: true, projectId, email: acct.email };
}

/**
 * Count the account's stored bytes the moment they land, rather than waiting
 * for the nightly pass. Someone who adds ten photos and looks at what their
 * folder is using should see the ten photos.
 */
async function confirmStoredObject(projectId: string, oid: string, sizeBytes: number): Promise<void> {
  await sql`
    INSERT INTO stored_objects (project_id, oid, declared_bytes, confirmed_bytes, state, verified_at)
    VALUES (${projectId}, ${oid}, ${sizeBytes}, ${sizeBytes}, 'confirmed', now())
    ON CONFLICT (project_id, oid) DO UPDATE SET confirmed_bytes = EXCLUDED.confirmed_bytes,
      declared_bytes = EXCLUDED.declared_bytes, state = 'confirmed', verified_at = now(),
      reservation_expires_at = NULL, updated_at = now()`;
}

function fileName(path: string): string {
  return path.split("/").pop() || path;
}

function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/**
 * Stop reading once the limit is past. Without this, a body that claims one
 * size and sends another writes the difference to disk before anyone checks.
 */
function cutOffAfter(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      seen += chunk.length;
      if (seen > limit) {
        done(Object.assign(new Error("too-large"), { code: "too-large" }));
        return;
      }
      done(null, chunk);
    },
  });
}

const TOO_MANY_AT_ONCE = `That is more than ${BATCH_ENTRY_CAP} files at once. Do it on the computer where the folder lives, or take a smaller part of it.`;

app.post("/api/projects/:id/files/upload", async (c) => {
  const guard = await requireOwnerWrite(c);
  if (!guard.ok) return guard.response;
  const { projectId } = guard;

  const path = safeDocumentPath(c.req.query("path"));
  if (!path) return c.json({ error: { code: "path", message: "Choose a name for the file." } }, 400);
  // What the person was looking at when they dropped the file. Every one of
  // these three refuses rather than writing over work that arrived since.
  const baseHead = c.req.query("baseHead") ?? null;
  const declared = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > ROUTING_CEILING_BYTES) {
    return c.json({ error: { code: "too-large", message: `The largest file the browser can add is ${Math.round(ROUTING_CEILING_BYTES / (1024 * 1024))} MB.` } }, 413);
  }
  const body = c.req.raw.body;
  if (!body) return c.json({ error: { code: "content", message: "No file arrived. Try again." } }, 400);

  // Straight to disk, never into memory: the box that runs this holds other
  // people's folders too, and a hundred megabytes read into it at once is
  // how one person's upload becomes everybody's outage.
  const dir = await mkdtemp(join(tmpdir(), "gf-upload-"));
  const spooled = join(dir, "bytes");
  try {
    const handle = await openFile(spooled, "w");
    try {
      await pipeline(
        Readable.fromWeb(body as import("node:stream/web").ReadableStream),
        cutOffAfter(ROUTING_CEILING_BYTES),
        handle.createWriteStream(),
      );
    } finally {
      await handle.close();
    }
    const { size } = await stat(spooled);

    const tree = await repos.tree(projectId);
    const gate = checkWrite({ tree, writes: [{ path, sizeBytes: size }] });
    if (!gate.ok) return c.json({ error: { code: gate.refusal.code, message: gate.refusal.message } }, gate.refusal.status);
    const planned = gate.plan.writes[0]!;

    let content: Buffer;
    if (planned.target === "lfs") {
      const stored = await putStoredFileFromPath({
        s3: previewStorage,
        bucket: cfg.s3Bucket,
        projectId,
        sourcePath: spooled,
        size,
        contentType: previewMimeFor(path) ?? undefined,
      });
      await confirmStoredObject(projectId, stored.oid, stored.size);
      content = stored.pointer;
    } else {
      content = await readTempFile(spooled);
    }

    const replacing = tree.some((entry) => entry.type === "blob" && entry.path === path);
    const label = replacing ? `Replaced ${fileName(path)}` : `Added ${fileName(path)}`;
    const saved = await repos.writeFile({
      projectId,
      path,
      content,
      message: label,
      expectedHead: baseHead,
    });
    const saveNumber = await recordWebSave({
      projectId, commitSha: saved.commitSha, label, changedPaths: [path], accountEmail: guard.email,
      counts: replacing ? { changed: 1 } : { added: 1 },
    });
    return c.json({ ok: true, path, head: saved.commitSha, saveNumber });
  } catch (error) {
    if ((error as { code?: string }).code === "too-large") {
      return c.json({ error: { code: "too-large", message: `The largest file the browser can add is ${Math.round(ROUTING_CEILING_BYTES / (1024 * 1024))} MB.` } }, 413);
    }
    if ((error as { code?: string }).code === "newer-work") {
      return c.json({ error: { code: "newer-work", message: "Newer work arrived while the file was on its way. Look at the latest save, then try again." } }, 409);
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

app.post("/api/projects/:id/files/rename", async (c) => {
  const guard = await requireOwnerWrite(c);
  if (!guard.ok) return guard.response;
  const { projectId } = guard;
  const body = await c.req.json<{ from?: string; to?: string; baseHead?: string | null }>()
    .catch(() => ({} as { from?: string; to?: string; baseHead?: string | null }));
  const from = safeDocumentPath(body.from);
  const to = safeDocumentPath(body.to);
  if (!from || !to) return c.json({ error: { code: "path", message: "Choose a name." } }, 400);
  if (from === to) return c.json({ error: { code: "path", message: "That is the name it already has." } }, 400);

  const tree = await repos.tree(projectId);
  const moving = filesUnder(tree, [from]);
  if (moving.length === 0) return c.json({ error: { code: "not-found", message: `“${fileName(from)}” isn’t in this folder any more.` } }, 404);
  if (moving.length > BATCH_ENTRY_CAP) return c.json({ error: { code: "too-many", message: TOO_MANY_AT_ONCE } }, 400);

  const renamed = moving.map((file) => ({ ...file, to: `${to}${file.path.slice(from.length)}` }));
  const gate = checkWrite({
    tree,
    writes: renamed.map((file) => ({ path: file.to, sizeBytes: file.size })),
    removes: renamed.map((file) => file.path),
  });
  if (!gate.ok) return c.json({ error: { code: gate.refusal.code, message: gate.refusal.message } }, gate.refusal.status);

  const changes: FileChange[] = [];
  for (const file of renamed) {
    const current = await repos.readFile(projectId, file.path);
    if (!current) return c.json({ error: { code: "not-found", message: `“${fileName(file.path)}” isn’t in this folder any more.` } }, 404);
    changes.push({ operation: "write", path: file.to, content: current.content });
    changes.push({ operation: "remove", path: file.path });
  }

  const label = directoryOf(from) === directoryOf(to)
    ? `Renamed ${fileName(from)} to ${fileName(to)}`
    : `Moved ${fileName(from)} to ${directoryOf(to) || "the top of the folder"}`;
  try {
    const saved = await repos.changeFiles({ projectId, changes, message: label, expectedHead: body.baseHead ?? null });
    const changedPaths = renamed.flatMap((file) => [file.to, file.path]);
    const saveNumber = await recordWebSave({
      projectId, commitSha: saved.commitSha, label, changedPaths, accountEmail: guard.email,
      counts: { changed: renamed.length },
    });
    return c.json({ ok: true, from, to, head: saved.commitSha, saveNumber });
  } catch (error) {
    if ((error as { code?: string }).code === "newer-work") {
      return c.json({ error: { code: "newer-work", message: "Newer work arrived first. Look at the latest save, then try again." } }, 409);
    }
    throw error;
  }
});

app.post("/api/projects/:id/files/remove", async (c) => {
  const guard = await requireOwnerWrite(c);
  if (!guard.ok) return guard.response;
  const { projectId } = guard;
  const body = await c.req.json<{ paths?: unknown; baseHead?: string | null }>()
    .catch(() => ({} as { paths?: unknown; baseHead?: string | null }));
  const asked = Array.isArray(body.paths) ? body.paths.map((value) => safeDocumentPath(value)) : [];
  if (asked.length === 0 || asked.some((path) => path === null)) {
    return c.json({ error: { code: "path", message: "Choose what to take out." } }, 400);
  }

  const tree = await repos.tree(projectId);
  const going = filesUnder(tree, asked as string[]);
  if (going.length === 0) {
    return c.json({ error: { code: "not-found", message: "That isn’t in this folder any more. Nothing was changed." } }, 404);
  }
  if (going.length > BATCH_ENTRY_CAP) return c.json({ error: { code: "too-many", message: TOO_MANY_AT_ONCE } }, 400);

  const gate = checkWrite({ tree, removes: going.map((file) => file.path) });
  if (!gate.ok) return c.json({ error: { code: gate.refusal.code, message: gate.refusal.message } }, gate.refusal.status);

  const label = going.length === 1
    ? `Took out ${fileName(going[0]!.path)}`
    : `Took out ${going.length} files`;
  try {
    const saved = await repos.changeFiles({
      projectId,
      changes: going.map((file) => ({ operation: "remove", path: file.path }) as const),
      message: label,
      expectedHead: body.baseHead ?? null,
    });
    const changedPaths = going.map((file) => file.path);
    const saveNumber = await recordWebSave({
      projectId, commitSha: saved.commitSha, label, changedPaths, accountEmail: guard.email,
      counts: { removed: going.length },
    });
    return c.json({ ok: true, removed: changedPaths, head: saved.commitSha, saveNumber });
  } catch (error) {
    if ((error as { code?: string }).code === "newer-work") {
      return c.json({ error: { code: "newer-work", message: "Newer work arrived first. Look at the latest save, then try again." } }, 409);
    }
    throw error;
  }
});

app.get("/api/projects/:id/proposals", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  const role = await projectAccess(projectId, acct.accountId);
  if (!role) return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  const rows = await sql`
    SELECT cp.id, cp.title, cp.explanation, cp.status,
           cp.base_commit_sha AS "baseHead", cp.base_save_seq AS "baseSaveNumber",
           cp.created_at::text AS "createdAt", a.email AS "authorEmail",
           COALESCE(json_agg(json_build_object(
             'id', ps.id, 'path', ps.document_path, 'section', ps.section_hint,
             'before', ps.before_text, 'replacement', ps.replacement_text,
             'explanation', ps.explanation, 'status', ps.status,
             'kind', CASE ps.kind
               WHEN 'table' THEN 'table_update' WHEN 'asset' THEN 'asset_replace'
               WHEN 'rename' THEN 'path_rename' WHEN 'remove' THEN 'path_remove'
               ELSE 'text_replace' END,
             'operation', ps.operation, 'baseFileSha', ps.base_file_sha
           ) ORDER BY ps.created_at) FILTER (WHERE ps.id IS NOT NULL), '[]') AS suggestions
    FROM change_proposals cp
    JOIN accounts a ON a.id = cp.author_account_id
    LEFT JOIN proposal_suggestions ps ON ps.proposal_id = cp.id
    WHERE cp.project_id = ${projectId}
    GROUP BY cp.id, a.email ORDER BY cp.created_at DESC LIMIT 100`;
  return c.json({ role, proposals: rows });
});

/**
 * Bytes sent up by someone who cannot save them.
 *
 * An invited person dropping a file into a folder is proposing to add it, and
 * a proposal is a thing the owner reads before anything happens. So the bytes
 * have to wait somewhere that is not the folder: filed by their own hash,
 * under a key the storage count deliberately does not recognise, and swept
 * after a week if nobody accepts them.
 */
const STAGED_UPLOAD_DAYS = 7;
/** What one person may have waiting in one folder at a time. */
const STAGED_UPLOAD_LIMIT = 20;

/**
 * Let go of bytes nobody is waiting on.
 *
 * The same file staged twice is the same bytes under the same name, so the
 * object only goes when the last thing pointing at it does.
 */
async function releaseStagedBytes(projectId: string, oid: string): Promise<void> {
  const left = await sql`
    SELECT 1 FROM staged_uploads WHERE project_id = ${projectId} AND oid = ${oid} LIMIT 1`;
  if (left.length) return;
  await forgetStagedFile({ s3: previewStorage, bucket: cfg.s3Bucket, projectId, oid });
}

/**
 * Sweep bytes nobody accepted. Runs whoever is hosting this and whatever
 * they are or aren't billed — an installation that never charges anyone
 * still shouldn't fill up with files nobody chose to keep.
 */
async function sweepStagedUploads(): Promise<void> {
  const expired = await sql`
    DELETE FROM staged_uploads WHERE expires_at <= now()
    RETURNING project_id AS "projectId", oid`;
  const seen = new Set<string>();
  for (const row of expired) {
    const key = `${row.projectId}/${row.oid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await releaseStagedBytes(String(row.projectId), String(row.oid));
  }
}

app.post("/api/projects/:id/staged-files", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id") ?? "";
  if (!await projectAccess(projectId, acct.accountId)) {
    return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  }
  const denied = await projectWriteAccessError(projectId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);

  const name = safeDocumentPath(c.req.query("name"));
  if (!name) return c.json({ error: { code: "path", message: "Choose a name for the file." } }, 400);
  const declared = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > ROUTING_CEILING_BYTES) {
    return c.json({ error: { code: "too-large", message: `The largest file the browser can add is ${Math.round(ROUTING_CEILING_BYTES / (1024 * 1024))} MB.` } }, 413);
  }
  const waiting = await sql`
    SELECT COUNT(*)::int AS count FROM staged_uploads
    WHERE project_id = ${projectId} AND author_account_id = ${acct.accountId} AND expires_at > now()`;
  if (Number(waiting[0]?.count ?? 0) >= STAGED_UPLOAD_LIMIT) {
    return c.json({
      error: { code: "too-many", message: `You already have ${STAGED_UPLOAD_LIMIT} files waiting for review here. Send those first.` },
    }, 429);
  }
  const body = c.req.raw.body;
  if (!body) return c.json({ error: { code: "content", message: "No file arrived. Try again." } }, 400);

  const dir = await mkdtemp(join(tmpdir(), "gf-staged-"));
  const spooled = join(dir, "bytes");
  try {
    const handle = await openFile(spooled, "w");
    try {
      await pipeline(
        Readable.fromWeb(body as import("node:stream/web").ReadableStream),
        cutOffAfter(ROUTING_CEILING_BYTES),
        handle.createWriteStream(),
      );
    } finally {
      await handle.close();
    }
    const { size } = await stat(spooled);
    const oid = await hashFile(spooled);
    await previewStorage.send(new PutObjectCommand({
      Bucket: cfg.s3Bucket,
      Key: stagingKey(projectId, oid),
      Body: createReadStream(spooled),
      ContentLength: size,
      ...(previewMimeFor(name) ? { ContentType: previewMimeFor(name)! } : {}),
    }));
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO staged_uploads (id, project_id, author_account_id, oid, size_bytes, file_name, mime_type, expires_at)
      VALUES (${id}, ${projectId}, ${acct.accountId}, ${oid}, ${size}, ${fileName(name)}, ${previewMimeFor(name)},
              now() + ${`${STAGED_UPLOAD_DAYS} days`}::interval)`;
    return c.json({ ok: true, stagingId: id, size });
  } catch (error) {
    if ((error as { code?: string }).code === "too-large") {
      return c.json({ error: { code: "too-large", message: `The largest file the browser can add is ${Math.round(ROUTING_CEILING_BYTES / (1024 * 1024))} MB.` } }, 413);
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

app.post("/api/projects/:id/proposals", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  const role = await projectAccess(projectId, acct.accountId);
  if (!role) return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  const denied = await projectWriteAccessError(projectId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  type ProposalOperationInput = {
    path?: string;
    kind?: "text_replace" | "table_update" | "asset_replace" | "path_rename" | "path_remove";
    section?: string;
    /** Where a rename is asking the file to go. */
    to?: string;
    before?: string;
    replacement?: string;
    changes?: Array<{ address?: string; before?: string; replacement?: string }>;
    stagingId?: string;
    mimeType?: string;
    extension?: string;
    explanation?: string;
  };
  type ProposalInput = {
    title?: string;
    explanation?: string;
    // Retained for clients from the text-only release. The server never
    // trusts either value; it stamps the current head and file hash below.
    baseHead?: string | null;
    baseSaveNumber?: number | null;
    operation?: ProposalOperationInput;
    suggestions?: Array<ProposalOperationInput>;
  };
  const body = await c.req.json<ProposalInput>().catch(() => ({} as ProposalInput));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const rawOperations = body.operation
    ? [body.operation]
    : Array.isArray(body.suggestions)
      ? body.suggestions.slice(0, 20)
      : [];
  if (!title || rawOperations.length === 0) return c.json({ error: { code: "proposal", message: "A title and at least one file operation are required." } }, 400);

  /**
   * A generated-media insertion travels as one proposal with two inseparable
   * suggestions: add the waiting bytes, then update the document that refers
   * to them. Neither half reaches the folder before an owner accepts both.
   */
  const proposedAsset = rawOperations.length === 2
    ? rawOperations.find((item) => item?.kind === "asset_replace") ?? null
    : null;
  const proposedText = rawOperations.length === 2
    ? rawOperations.find((item) => (item?.kind ?? "text_replace") === "text_replace") ?? null
    : null;
  if (proposedAsset && proposedText) {
    const assetPath = safeDocumentPath(proposedAsset.path);
    const documentPath = safeDocumentPath(proposedText.path);
    const before = typeof proposedText.before === "string" ? proposedText.before.slice(0, 20_000) : "";
    const replacement = typeof proposedText.replacement === "string" ? proposedText.replacement.slice(0, 20_000) : "";
    const section = typeof proposedText.section === "string" ? proposedText.section.trim().slice(0, 160) : null;
    const assetExplanation = typeof proposedAsset.explanation === "string" ? proposedAsset.explanation.trim().slice(0, 500) : "";
    const textExplanation = typeof proposedText.explanation === "string" ? proposedText.explanation.trim().slice(0, 500) : "";
    if (!assetPath || !documentPath || assetPath === documentPath) {
      return c.json({ error: { code: "suggestion", message: "Choose different safe paths for the document and its media." } }, 400);
    }
    const mediaKind = previewKindFor(assetPath);
    if (!mediaKind || !["image", "video", "audio"].includes(mediaKind)) {
      return c.json({ error: { code: "suggestion", message: "Proposed document media must be a previewable image, video, or audio file." } }, 400);
    }
    if (!isTextDocument(documentPath) || !before || typeof proposedText.replacement !== "string") {
      return c.json({ error: { code: "suggestion", message: "The document change needs an exact passage in a readable text file." } }, 400);
    }
    const stagingId = typeof proposedAsset.stagingId === "string" ? proposedAsset.stagingId.trim() : "";
    const staged = stagingId
      ? await sql`
          SELECT oid, size_bytes AS "sizeBytes", file_name AS "fileName", mime_type AS "mimeType"
          FROM staged_uploads
          WHERE id = ${stagingId} AND project_id = ${projectId}
            AND author_account_id = ${acct.accountId} AND expires_at > now()
          LIMIT 1`
      : [];
    if (!staged.length) {
      return c.json({ error: { code: "suggestion", message: "That media is no longer waiting to be proposed. Add it again." } }, 409);
    }
    const tree = await repos.tree(projectId);
    if (tree.some((entry) => entry.type === "blob" && entry.path === assetPath)) {
      return c.json({ error: { code: "suggestion", message: "Choose a new path for the proposed media." } }, 409);
    }
    const documentEntry = tree.find((entry) => entry.type === "blob" && entry.path === documentPath) ?? null;
    const currentFile = await repos.readFile(projectId, documentPath);
    if (!documentEntry || !currentFile) return c.json({ error: { code: "not-found", message: "That document no longer exists in the folder." } }, 404);
    if (parseStoredFilePointer(currentFile.content)) {
      return c.json({ error: { code: "stored-for-device", message: "That document is stored on a connected computer and cannot be edited in the browser yet." } }, 409);
    }
    const applied = applyProposalOperations(currentFile.content.toString("utf8"), documentPath, [{
      kind: "text",
      before,
      replacement,
      operation: { kind: "text_replace", before, replacement },
    }]);
    if ("error" in applied) {
      return c.json({ error: { code: "suggestion", message: "The exact document passage is missing or appears more than once." } }, 409);
    }
    const row = staged[0]!;
    const sizeBytes = Number(row.sizeBytes);
    const gate = checkWrite({
      tree,
      writes: [
        { path: assetPath, sizeBytes },
        { path: documentPath, sizeBytes: Buffer.byteLength(applied.content) },
      ],
    });
    if (!gate.ok) return c.json({ error: { code: gate.refusal.code, message: gate.refusal.message } }, gate.refusal.status);

    const currentHead = await repos.head(projectId);
    const latest = await sql`SELECT COALESCE(MAX(seq), 0)::int AS seq FROM saves WHERE project_id = ${projectId}`;
    const baseSaveNumber = Number(latest[0]?.seq ?? 0) || null;
    const proposalExplanation = typeof body.explanation === "string" ? body.explanation.slice(0, 1000) : "";
    const id = crypto.randomUUID();
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO change_proposals (id, project_id, author_account_id, title, explanation, base_commit_sha, base_save_seq)
        VALUES (${id}, ${projectId}, ${acct.accountId}, ${title}, ${proposalExplanation}, ${currentHead}, ${baseSaveNumber})`;
      await tx`
        INSERT INTO proposal_suggestions (id, proposal_id, document_path, kind, base_file_sha, operation, section_hint, before_text, replacement_text, explanation)
        VALUES (${crypto.randomUUID()}, ${id}, ${assetPath}, ${"asset"}, ${null}, ${sql.json({
          kind: "asset_replace",
          bundle: "document_media",
          stagingId,
          oid: String(row.oid),
          sizeBytes,
          fileName: String(row.fileName),
          mimeType: row.mimeType == null ? null : String(row.mimeType),
          explanation: assetExplanation,
        })}, ${null}, ${""}, ${""}, ${assetExplanation})`;
      await tx`
        INSERT INTO proposal_suggestions (id, proposal_id, document_path, kind, base_file_sha, operation, section_hint, before_text, replacement_text, explanation)
        VALUES (${crypto.randomUUID()}, ${id}, ${documentPath}, ${"text"}, ${currentFile.sha}, ${sql.json({
          kind: "text_replace",
          bundle: "document_media",
          section,
          before,
          replacement,
          explanation: textExplanation,
        })}, ${section}, ${before}, ${replacement}, ${textExplanation})`;
    });
    return c.json({ ok: true, proposalId: id, title, suggestionCount: 2, url: `https://trygoodfolder.com/dashboard?folder=${projectId}&proposal=${id}` });
  }

  /**
   * Proposing a change to which files the folder holds, rather than to what
   * is inside one.
   *
   * These three carry no text to anchor into and no file to read, so they
   * part company with the rest here rather than being threaded through
   * validation written for passages and cells. They go through the same gate
   * an owner's own change does — a proposal is not a way around it, only a
   * way of asking someone to make it.
   */
  const lone = rawOperations.length === 1 ? rawOperations[0]! : null;
  const loneKind = lone?.kind ?? "";
  if (lone && (loneKind === "asset_replace" || loneKind === "path_rename" || loneKind === "path_remove")) {
    const path = safeDocumentPath(lone.path);
    if (!path) return c.json({ error: { code: "suggestion", message: "Each operation needs a safe file path." } }, 400);
    const explanation = typeof lone.explanation === "string" ? lone.explanation.trim().slice(0, 500) : "";
    const tree = await repos.tree(projectId);
    const here = tree.find((entry) => entry.type === "blob" && entry.path === path) ?? null;

    let stored: "asset" | "rename" | "remove";
    let operation: Record<string, string | number | null>;
    let gate: ReturnType<typeof checkWrite>;

    if (loneKind === "asset_replace") {
      const stagingId = typeof lone.stagingId === "string" ? lone.stagingId.trim() : "";
      const staged = stagingId
        ? await sql`
            SELECT oid, size_bytes AS "sizeBytes", file_name AS "fileName", mime_type AS "mimeType"
            FROM staged_uploads
            WHERE id = ${stagingId} AND project_id = ${projectId}
              AND author_account_id = ${acct.accountId} AND expires_at > now()
            LIMIT 1`
        : [];
      if (!staged.length) {
        return c.json({ error: { code: "suggestion", message: "That file is no longer waiting to be sent. Add it again." } }, 409);
      }
      const row = staged[0]!;
      stored = "asset";
      operation = {
        kind: "asset_replace",
        stagingId,
        oid: String(row.oid),
        sizeBytes: Number(row.sizeBytes),
        fileName: String(row.fileName),
        mimeType: row.mimeType == null ? null : String(row.mimeType),
        explanation,
      };
      gate = checkWrite({ tree, writes: [{ path, sizeBytes: Number(row.sizeBytes) }] });
    } else if (loneKind === "path_rename") {
      const to = safeDocumentPath((lone as { to?: string }).to);
      if (!to) return c.json({ error: { code: "suggestion", message: "Choose a name." } }, 400);
      if (to === path) return c.json({ error: { code: "suggestion", message: "That is the name it already has." } }, 400);
      if (!here) return c.json({ error: { code: "not-found", message: "That file no longer exists in the folder." } }, 404);
      stored = "rename";
      operation = { kind: "path_rename", to, explanation };
      gate = checkWrite({ tree, writes: [{ path: to, sizeBytes: here.size }], removes: [path] });
    } else {
      if (!here) return c.json({ error: { code: "not-found", message: "That file no longer exists in the folder." } }, 404);
      stored = "remove";
      operation = { kind: "path_remove", explanation };
      gate = checkWrite({ tree, removes: [path] });
    }

    if (!gate.ok) return c.json({ error: { code: gate.refusal.code, message: gate.refusal.message } }, gate.refusal.status);

    const currentHead = await repos.head(projectId);
    const latest = await sql`SELECT COALESCE(MAX(seq), 0)::int AS seq FROM saves WHERE project_id = ${projectId}`;
    const baseSaveNumber = Number(latest[0]?.seq ?? 0) || null;
    const proposalExplanation = typeof body.explanation === "string" ? body.explanation.slice(0, 1000) : "";
    const id = crypto.randomUUID();
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO change_proposals (id, project_id, author_account_id, title, explanation, base_commit_sha, base_save_seq)
        VALUES (${id}, ${projectId}, ${acct.accountId}, ${title}, ${proposalExplanation}, ${currentHead}, ${baseSaveNumber})`;
      await tx`
        INSERT INTO proposal_suggestions (id, proposal_id, document_path, kind, base_file_sha, operation, section_hint, before_text, replacement_text, explanation)
        VALUES (${crypto.randomUUID()}, ${id}, ${path}, ${stored}, ${here?.sha ?? null}, ${sql.json(operation)}, ${null}, ${""}, ${""}, ${explanation})`;
    });
    return c.json({ ok: true, proposalId: id, title, suggestionCount: 1, url: `https://trygoodfolder.com/dashboard?folder=${projectId}&proposal=${id}` });
  }

  if (rawOperations.some((item) => !item || !["text_replace", "table_update"].includes(item.kind ?? "text_replace"))) {
    return c.json({
      error: {
        code: "operation",
        message: "Choose text_replace or table_update. Adding, renaming and taking out a file each travel on their own.",
      },
    }, 400);
  }
  if (rawOperations.some((item) => {
    if (!item || typeof item !== "object") return true;
    const kind = item.kind ?? "text_replace";
    if (kind === "text_replace") return typeof item.before !== "string" || typeof item.replacement !== "string";
    if (kind === "table_update") {
      return !Array.isArray(item.changes) ||
        item.changes.length < 1 ||
        item.changes.length > TABLE_EDIT_CAP ||
        item.changes.some((change) => !change || typeof change.address !== "string" || !change.address.trim() || typeof change.before !== "string" || typeof change.replacement !== "string");
    }
    return false;
  })) {
    return c.json({ error: { code: "operation", message: "Each text operation needs exact text, and each table operation needs complete cell values." } }, 400);
  }

  const clean = rawOperations.map((item) => {
    const kind = item.kind ?? "text_replace";
    const path = safeDocumentPath(item.path);
    const explanation = typeof item.explanation === "string" ? item.explanation.trim().slice(0, 500) : "";
    if (kind === "table_update") {
      const changes = Array.isArray(item.changes)
        ? item.changes.slice(0, TABLE_EDIT_CAP + 1).map((change) => {
            const value = change && typeof change === "object" ? change : {};
            return {
              address: typeof value.address === "string" ? value.address.trim().toUpperCase() : "",
              before: typeof value.before === "string" ? value.before.slice(0, 20_000) : "",
              replacement: typeof value.replacement === "string" ? value.replacement.slice(0, 20_000) : "",
            };
          })
        : [];
      return {
        path,
        kind,
        section: null,
        before: "",
        replacement: "",
        explanation,
        changes,
        operation: { kind, changes, explanation },
      };
    }
    if (kind === "asset_replace") {
      return {
        path,
        kind,
        section: null,
        before: "",
        replacement: "",
        explanation,
        changes: [],
        operation: {
          kind,
          stagingId: typeof item.stagingId === "string" ? item.stagingId.slice(0, 200) : "",
          mimeType: typeof item.mimeType === "string" ? item.mimeType.slice(0, 160) : "",
          extension: typeof item.extension === "string" ? item.extension.slice(0, 20) : "",
          explanation,
        },
      };
    }
    const before = typeof item.before === "string" ? item.before.slice(0, 20_000) : "";
    const replacement = typeof item.replacement === "string" ? item.replacement.slice(0, 20_000) : "";
    const section = typeof item.section === "string" ? item.section.trim().slice(0, 160) : null;
    return {
      path,
      kind: "text_replace" as const,
      section,
      before,
      replacement,
      explanation,
      changes: [],
      operation: { kind: "text_replace" as const, section, before, replacement, explanation },
    };
  });
  if (clean.some((item) => !item.path)) return c.json({ error: { code: "suggestion", message: "Each operation needs a safe file path." } }, 400);
  const paths = new Set(clean.map((item) => item.path!));
  if (paths.size !== 1) return c.json({ error: { code: "proposal", message: "A Change Proposal can affect one file at a time." } }, 400);
  const path = clean[0]!.path!;
  // Proposals reach further than hand-editing: anything readable as text can
  // be anchored into, source files included. Typing into it here still cannot.
  if (!isTextDocument(path)) return c.json({ error: { code: "suggestion", message: "Choose a file that can be read as text." } }, 400);
  if (clean.some((item) => item.kind === "table_update" && !/\.(csv|tsv)$/i.test(path))) {
    return c.json({ error: { code: "suggestion", message: "Table updates only apply to CSV and TSV files." } }, 400);
  }
  if (clean.some((item) => item.kind === "text_replace" && !item.before && item.replacement !== "")) {
    return c.json({ error: { code: "suggestion", message: "Text replacements need an exact passage to anchor the change." } }, 400);
  }
  if (clean.some((item) => item.kind === "table_update" && (item.changes.length === 0 || item.changes.length > TABLE_EDIT_CAP || item.changes.some((change) => !change.address)))) {
    return c.json({ error: { code: "suggestion", message: "Table updates need one or more valid cell addresses." } }, 400);
  }

  const currentHead = await repos.head(projectId);
  const currentFile = await repos.readFile(projectId, path);
  if (!currentFile) return c.json({ error: { code: "not-found", message: "That file no longer exists in the folder." } }, 404);
  if (parseStoredFilePointer(currentFile.content)) {
    return c.json({ error: { code: "stored-for-device", message: "That file is stored on a connected computer and cannot be edited in the browser yet." } }, 409);
  }
  const latest = await sql`SELECT COALESCE(MAX(seq), 0)::int AS seq FROM saves WHERE project_id = ${projectId}`;
  const baseSaveNumber = Number(latest[0]?.seq ?? 0) || null;
  const proposalExplanation = typeof body.explanation === "string" ? body.explanation.slice(0, 1000) : "";
  const id = crypto.randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO change_proposals (id, project_id, author_account_id, title, explanation, base_commit_sha, base_save_seq)
      VALUES (${id}, ${projectId}, ${acct.accountId}, ${title}, ${proposalExplanation}, ${currentHead}, ${baseSaveNumber})`;
    for (const item of clean) {
      await tx`
        INSERT INTO proposal_suggestions (id, proposal_id, document_path, kind, base_file_sha, operation, section_hint, before_text, replacement_text, explanation)
        VALUES (${crypto.randomUUID()}, ${id}, ${item.path!}, ${item.kind === "table_update" ? "table" : "text"}, ${currentFile.sha}, ${sql.json(item.operation)}, ${item.section}, ${item.before}, ${item.replacement}, ${item.explanation})`;
    }
  });
  return c.json({ ok: true, proposalId: id, title, suggestionCount: clean.length, url: `https://trygoodfolder.com/dashboard?folder=${projectId}&proposal=${id}` });
});

app.post("/api/projects/:id/proposals/:proposalId/comments", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  if (!await projectAccess(projectId, acct.accountId)) return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  const denied = await projectWriteAccessError(projectId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  const body = await c.req.json<{ body?: string; suggestionId?: string }>().catch(() => ({} as { body?: string; suggestionId?: string }));
  const comment = typeof body.body === "string" ? body.body.trim().slice(0, 4000) : "";
  if (!comment) return c.json({ error: { code: "comment", message: "Comment can't be empty." } }, 400);
  const proposalId = c.req.param("proposalId");
  const owns = await sql`SELECT id FROM change_proposals WHERE id = ${proposalId} AND project_id = ${projectId}`;
  if (!owns.length) return c.json({ error: { code: "not-found", message: "Change Proposal not found." } }, 404);
  await sql`
    INSERT INTO proposal_comments (id, proposal_id, suggestion_id, author_account_id, body)
    VALUES (${crypto.randomUUID()}, ${proposalId}, ${body.suggestionId ?? null}, ${acct.accountId}, ${comment})`;
  return c.json({ ok: true });
});

app.get("/api/projects/:id/document/comments", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  if (!await projectAccess(projectId, acct.accountId)) return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  const path = safeDocumentPath(c.req.query("path"));
  if (!path) return c.json({ error: { code: "path", message: "valid file path required" } }, 400);
  const rows = await sql`
    SELECT dc.id, dc.document_path AS path, dc.quoted_text AS "quotedText", dc.body,
           dc.created_at::text AS "createdAt", a.email AS "authorEmail"
    FROM document_comments dc JOIN accounts a ON a.id = dc.author_account_id
    WHERE dc.project_id = ${projectId} AND dc.document_path = ${path} AND dc.resolved_at IS NULL
    ORDER BY dc.created_at DESC LIMIT 100`;
  return c.json(rows);
});

app.post("/api/projects/:id/document/comments", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  if (!await projectAccess(projectId, acct.accountId)) return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  const denied = await projectWriteAccessError(projectId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  const body = await c.req.json<{ path?: string; quotedText?: string; body?: string }>().catch(() => ({} as { path?: string; quotedText?: string; body?: string }));
  const path = safeDocumentPath(body.path);
  const comment = body.body?.trim().slice(0, 4000) ?? "";
  if (!path || !comment) return c.json({ error: { code: "comment", message: "Choose a document and write a comment." } }, 400);
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO document_comments (id, project_id, document_path, author_account_id, quoted_text, body)
    VALUES (${id}, ${projectId}, ${path}, ${acct.accountId}, ${body.quotedText?.slice(0, 20_000) ?? null}, ${comment})`;
  return c.json({ ok: true, commentId: id });
});

app.post("/api/projects/:id/proposals/:proposalId/review", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  if (await projectAccess(projectId, acct.accountId) !== "owner") return c.json({ error: { code: "owner-only", message: "Only the folder owner can review suggestions." } }, 403);
  const denied = await projectWriteAccessError(projectId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  const reviewerAccountId = acct.accountId;
  const proposalId = c.req.param("proposalId");
  const body = await c.req.json<{ action?: "accept" | "reject"; suggestionId?: string }>().catch(() => ({} as { action?: "accept" | "reject"; suggestionId?: string }));
  if (body.action !== "accept" && body.action !== "reject") return c.json({ error: { code: "action", message: "Choose accept or reject." } }, 400);
  if (body.suggestionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.suggestionId)) return c.json({ error: { code: "suggestion", message: "Suggestion not found." } }, 404);
  type StoredSuggestion = StoredProposalSuggestion & {
    id: string;
    path: string;
    status: "open" | "accepted" | "rejected" | "needs-review";
    baseHead: string | null;
    baseSaveNumber: number | null;
    baseFileSha: string | null;
  };
  const allSuggestions = await sql`
    SELECT ps.id, ps.document_path AS path, ps.before_text AS before,
           ps.replacement_text AS replacement, ps.status, ps.kind,
           ps.base_file_sha AS "baseFileSha", ps.operation,
           cp.base_commit_sha AS "baseHead", cp.base_save_seq AS "baseSaveNumber"
    FROM proposal_suggestions ps JOIN change_proposals cp ON cp.id = ps.proposal_id
    WHERE cp.id = ${proposalId} AND cp.project_id = ${projectId}
    ORDER BY ps.created_at` as unknown as StoredSuggestion[];
  const reviewTogether = isDocumentMediaBundle(allSuggestions);
  if (body.suggestionId && reviewTogether) {
    return c.json({ error: { code: "proposal", message: "The media and its document reference must be reviewed together." } }, 400);
  }
  const suggestions = body.suggestionId
    ? allSuggestions.filter((suggestion) => suggestion.id === body.suggestionId)
    : allSuggestions;
  if (!suggestions.length) return c.json({ error: { code: "not-found", message: "Suggestion not found." } }, 404);

  async function refreshProposalStatus(): Promise<string> {
    const counts = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open')::int AS open,
        COUNT(*) FILTER (WHERE status = 'needs-review')::int AS needs,
        COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted
      FROM proposal_suggestions WHERE proposal_id = ${proposalId}`;
    const open = Number(counts[0]?.open ?? 0);
    const needs = Number(counts[0]?.needs ?? 0);
    const accepted = Number(counts[0]?.accepted ?? 0);
    const status = needs > 0 ? "needs-review" : open > 0 ? "open" : accepted > 0 ? "accepted" : "rejected";
    await sql`UPDATE change_proposals SET status = ${status}, reviewed_at = now(), reviewed_by = ${reviewerAccountId} WHERE id = ${proposalId}`;
    return status;
  }

  async function needsReview(ids: string[]): Promise<string> {
    if (ids.length) await sql`UPDATE proposal_suggestions SET status = 'needs-review', reviewed_at = now() WHERE id IN ${sql(ids)}`;
    return refreshProposalStatus();
  }

  if (body.action === "reject") {
    await sql`UPDATE proposal_suggestions SET status = 'rejected', reviewed_at = now() WHERE id IN ${sql(suggestions.map((s) => s.id))}`;
    // Bytes sent up for a suggestion nobody wants have nothing left to wait for.
    for (const turned of suggestions) {
      if (turned.kind !== "asset") continue;
      const carried = (turned.operation && typeof turned.operation === "object" ? turned.operation : {}) as Record<string, unknown>;
      const oid = typeof carried.oid === "string" ? carried.oid : "";
      const stagingId = typeof carried.stagingId === "string" ? carried.stagingId : "";
      if (!/^[0-9a-f]{64}$/.test(oid) || !stagingId) continue;
      await sql`DELETE FROM staged_uploads WHERE id = ${stagingId} AND project_id = ${projectId}`;
      await releaseStagedBytes(projectId, oid);
    }
    return c.json({ ok: true, status: await refreshProposalStatus(), acceptedSuggestionIds: [], head: null, saveNumber: null });
  }

  const openSuggestions = suggestions.filter((suggestion) => suggestion.status === "open");
  if (!openSuggestions.length) {
    return c.json({ ok: true, status: await refreshProposalStatus(), acceptedSuggestionIds: [], head: null, saveNumber: null });
  }
  const selectedIds = openSuggestions.map((suggestion) => String(suggestion.id));
  const baseHead = openSuggestions[0]!.baseHead ? String(openSuggestions[0]!.baseHead) : null;
  const baseSaveNumber = openSuggestions[0]!.baseSaveNumber == null ? null : Number(openSuggestions[0]!.baseSaveNumber);
  if (new Set(openSuggestions.map((suggestion) => suggestion.baseHead ? String(suggestion.baseHead) : null)).size > 1) {
    const status = await needsReview(selectedIds);
    return c.json({ ok: true, status, acceptedSuggestionIds: [], head: null, saveNumber: null });
  }
  if (new Set(openSuggestions.map((suggestion) => suggestion.baseSaveNumber == null ? null : Number(suggestion.baseSaveNumber))).size > 1) {
    const status = await needsReview(selectedIds);
    return c.json({ ok: true, status, acceptedSuggestionIds: [], head: null, saveNumber: null });
  }
  const currentHead = await repos.head(projectId);
  const currentSaves = await sql`SELECT COALESCE(MAX(seq), 0)::int AS seq FROM saves WHERE project_id = ${projectId}`;
  const currentSaveNumber = Number(currentSaves[0]?.seq ?? 0) || 0;
  const stampedBase = openSuggestions.some((suggestion) => suggestion.baseHead !== null || suggestion.baseFileSha !== null || suggestion.baseSaveNumber !== null);
  if (stampedBase && currentHead !== baseHead) {
    const status = await needsReview(selectedIds);
    return c.json({ ok: true, status, acceptedSuggestionIds: [], head: currentHead, saveNumber: null });
  }
  if (stampedBase && currentSaveNumber !== (baseSaveNumber ?? 0)) {
    const status = await needsReview(selectedIds);
    return c.json({ ok: true, status, acceptedSuggestionIds: [], head: currentHead, saveNumber: null });
  }

  if (reviewTogether) {
    const stale = async () => {
      const status = await needsReview(selectedIds);
      return c.json({ ok: true, status, acceptedSuggestionIds: [], head: currentHead, saveNumber: null });
    };
    if (openSuggestions.length !== 2) return stale();
    const asset = openSuggestions.find((suggestion) => suggestion.kind === "asset");
    const text = openSuggestions.find((suggestion) => suggestion.kind === "text");
    if (!asset || !text || asset.path === text.path) return stale();
    const assetOperation = asset.operation && typeof asset.operation === "object"
      ? asset.operation as Record<string, unknown>
      : {};
    const oid = typeof assetOperation.oid === "string" ? assetOperation.oid : "";
    const stagingId = typeof assetOperation.stagingId === "string" ? assetOperation.stagingId : "";
    const size = Number(assetOperation.sizeBytes ?? -1);
    if (!/^[0-9a-f]{64}$/.test(oid) || !stagingId || !Number.isSafeInteger(size) || size < 0) return stale();
    const stillWaiting = await sql`
      SELECT id FROM staged_uploads
      WHERE id = ${stagingId} AND project_id = ${projectId} AND oid = ${oid} AND expires_at > now()
      LIMIT 1`;
    if (!stillWaiting.length) return stale();

    const currentDocument = await repos.readFile(projectId, text.path);
    if (!currentDocument || (text.baseFileSha && String(text.baseFileSha) !== currentDocument.sha)) return stale();
    if (parseStoredFilePointer(currentDocument.content)) return stale();
    const applied = applyProposalOperations(currentDocument.content.toString("utf8"), text.path, [text]);
    if ("error" in applied) return stale();
    const tree = await repos.tree(projectId);
    if (tree.some((entry) => entry.type === "blob" && entry.path === asset.path)) return stale();
    const gate = checkWrite({
      tree,
      writes: [
        { path: asset.path, sizeBytes: size },
        { path: text.path, sizeBytes: Buffer.byteLength(applied.content) },
      ],
    });
    if (!gate.ok) return stale();

    const assetPlan = gate.plan.writes.find((write) => write.path === asset.path);
    if (!assetPlan) return stale();
    let assetContent: Buffer;
    let copiedToStored = false;
    if (assetPlan.target === "lfs") {
      const accepted = await acceptStagedFile({ s3: previewStorage, bucket: cfg.s3Bucket, projectId, oid, size });
      await confirmStoredObject(projectId, oid, size);
      assetContent = accepted.pointer;
      copiedToStored = true;
    } else {
      const object = await previewStorage.send(
        new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: stagingKey(projectId, oid) }),
      );
      if (!object.Body) return stale();
      assetContent = Buffer.from(await object.Body.transformToByteArray());
    }

    const label = `Added ${fileName(asset.path)} to ${fileName(text.path)}`;
    try {
      const saved = await repos.changeFiles({
        projectId,
        changes: [
          { operation: "write", path: asset.path, content: assetContent },
          { operation: "write", path: text.path, content: Buffer.from(applied.content) },
        ],
        message: label,
        expectedHead: currentHead,
      });
      if (!copiedToStored) await forgetStagedFile({ s3: previewStorage, bucket: cfg.s3Bucket, projectId, oid });
      const saveNumber = await recordWebSave({
        projectId,
        commitSha: saved.commitSha,
        label,
        changedPaths: [asset.path, text.path],
        accountEmail: acct.email,
        counts: { added: 1, changed: 1 },
      });
      await sql`UPDATE proposal_suggestions SET status = 'accepted', reviewed_at = now() WHERE id IN ${sql(selectedIds)}`;
      await sql`DELETE FROM staged_uploads WHERE id = ${stagingId} AND project_id = ${projectId}`;
      const status = await refreshProposalStatus();
      return c.json({ ok: true, status, acceptedSuggestionIds: selectedIds, head: saved.commitSha, saveNumber });
    } catch (error) {
      if ((error as { code?: string }).code === "newer-work") return stale();
      throw error;
    }
  }

  const paths = new Set(openSuggestions.map((suggestion) => String(suggestion.path)));
  if (paths.size !== 1) {
    const status = await needsReview(selectedIds);
    return c.json({ ok: true, status, acceptedSuggestionIds: [], head: null, saveNumber: null });
  }
  const path = [...paths][0]!;
  /**
   * Accepting a change to which files the folder holds.
   *
   * The rest of this handler reads a file, rewrites its text, and writes it
   * back. These three never touch a file's contents — they add one, give one
   * a different name, or take one out — so they part company here and end in
   * one Save of their own, through the same gate the owner's own change goes
   * through.
   */
  if (isFileOperation(openSuggestions[0]!.kind)) {
    if (openSuggestions.length !== 1) {
      const status = await needsReview(selectedIds);
      return c.json({ ok: true, status, acceptedSuggestionIds: [], head: currentHead, saveNumber: null });
    }
    const suggestion = openSuggestions[0]!;
    const operation = (suggestion.operation && typeof suggestion.operation === "object"
      ? suggestion.operation
      : {}) as Record<string, unknown>;
    const tree = await repos.tree(projectId);
    const here = tree.find((entry) => entry.type === "blob" && entry.path === path) ?? null;

    const stale = async () => {
      const status = await needsReview(selectedIds);
      return c.json({ ok: true, status, acceptedSuggestionIds: [], head: currentHead, saveNumber: null });
    };

    let changes: FileChange[];
    let label: string;
    let changedPaths: string[];
    let counts: { added?: number; changed?: number; removed?: number };
    let staged: { oid: string; size: number } | null = null;

    if (suggestion.kind === "asset") {
      const oid = typeof operation.oid === "string" ? operation.oid : "";
      const size = Number(operation.sizeBytes ?? -1);
      if (!/^[0-9a-f]{64}$/.test(oid) || !Number.isSafeInteger(size) || size < 0) return stale();
      const stillWaiting = await sql`
        SELECT id FROM staged_uploads
        WHERE project_id = ${projectId} AND oid = ${oid} AND expires_at > now() LIMIT 1`;
      if (!stillWaiting.length) return stale();
      const gate = checkWrite({ tree, writes: [{ path, sizeBytes: size }] });
      if (!gate.ok) return stale();

      let content: Buffer;
      if (gate.plan.writes[0]!.target === "lfs") {
        const accepted = await acceptStagedFile({ s3: previewStorage, bucket: cfg.s3Bucket, projectId, oid, size });
        await confirmStoredObject(projectId, oid, size);
        content = accepted.pointer;
      } else {
        // Small enough to live in the folder itself, so the bytes come back
        // from where they were waiting and go in as they are.
        const object = await previewStorage.send(
          new GetObjectCommand({ Bucket: cfg.s3Bucket, Key: stagingKey(projectId, oid) }),
        );
        if (!object.Body) return stale();
        content = Buffer.from(await object.Body.transformToByteArray());
        await forgetStagedFile({ s3: previewStorage, bucket: cfg.s3Bucket, projectId, oid });
      }
      staged = { oid, size };
      changes = [{ operation: "write", path, content }];
      label = here ? `Replaced ${fileName(path)}` : `Added ${fileName(path)}`;
      changedPaths = [path];
      counts = here ? { changed: 1 } : { added: 1 };
    } else if (suggestion.kind === "rename") {
      const to = typeof operation.to === "string" ? safeDocumentPath(operation.to) : null;
      if (!to || !here) return stale();
      const gate = checkWrite({ tree, writes: [{ path: to, sizeBytes: here.size }], removes: [path] });
      if (!gate.ok) return stale();
      const current = await repos.readFile(projectId, path);
      if (!current) return stale();
      changes = [
        { operation: "write", path: to, content: current.content },
        { operation: "remove", path },
      ];
      label = directoryOf(path) === directoryOf(to)
        ? `Renamed ${fileName(path)} to ${fileName(to)}`
        : `Moved ${fileName(path)} to ${directoryOf(to) || "the top of the folder"}`;
      changedPaths = [to, path];
      counts = { changed: 1 };
    } else {
      if (!here) return stale();
      const gate = checkWrite({ tree, removes: [path] });
      if (!gate.ok) return stale();
      changes = [{ operation: "remove", path }];
      label = `Took out ${fileName(path)}`;
      changedPaths = [path];
      counts = { removed: 1 };
    }

    try {
      const saved = await repos.changeFiles({ projectId, changes, message: label, expectedHead: currentHead });
      const saveNumber = await recordWebSave({
        projectId, commitSha: saved.commitSha, label, changedPaths, accountEmail: acct.email, counts,
      });
      await sql`UPDATE proposal_suggestions SET status = 'accepted', reviewed_at = now() WHERE id IN ${sql(selectedIds)}`;
      if (staged) await sql`DELETE FROM staged_uploads WHERE project_id = ${projectId} AND oid = ${staged.oid}`;
      const status = await refreshProposalStatus();
      return c.json({ ok: true, status, acceptedSuggestionIds: selectedIds, head: saved.commitSha, saveNumber });
    } catch (error) {
      if ((error as { code?: string }).code === "newer-work") return stale();
      throw error;
    }
  }

  const file = await repos.readFile(projectId, path);
  if (!file || openSuggestions.some((suggestion) => suggestion.baseFileSha && String(suggestion.baseFileSha) !== file.sha)) {
    const status = await needsReview(selectedIds);
    return c.json({ ok: true, status, acceptedSuggestionIds: [], head: currentHead, saveNumber: null });
  }
  const applied = applyProposalOperations(file.content.toString("utf8"), path, openSuggestions);
  if ("error" in applied) {
    const status = await needsReview(selectedIds);
    return c.json({ ok: true, status, acceptedSuggestionIds: [], head: currentHead, saveNumber: null });
  }
  const nextContent = applied.content;

  // The same gate a direct save goes through. Someone else's suggestion is
  // not a reason to relax it, and a change this would spoil goes to review
  // rather than being refused outright — the owner still gets to look.
  const gate = checkWrite({
    tree: await repos.tree(projectId),
    writes: [{ path, sizeBytes: Buffer.byteLength(nextContent) }],
  });
  if (!gate.ok) {
    const status = await needsReview(selectedIds);
    return c.json({ ok: true, status, acceptedSuggestionIds: [], head: currentHead, saveNumber: null });
  }

  try {
    const saved = await repos.writeFile({
      projectId,
      path,
      content: Buffer.from(nextContent),
      message: `Accepted changes to ${path}`,
      expectedHead: currentHead,
    });
    const saveNumber = await recordWebSave({
      projectId,
      commitSha: saved.commitSha,
      label: `Accepted changes to ${path}`,
      changedPaths: [path],
      accountEmail: acct.email,
    });
    await sql`UPDATE proposal_suggestions SET status = 'accepted', reviewed_at = now() WHERE id IN ${sql(selectedIds)}`;
    const status = await refreshProposalStatus();
    return c.json({ ok: true, status, acceptedSuggestionIds: selectedIds, head: saved.commitSha, saveNumber });
  } catch (error) {
    if ((error as { code?: string }).code === "newer-work") {
      const status = await needsReview(selectedIds);
      return c.json({ ok: true, status, acceptedSuggestionIds: [], head: await repos.head(projectId), saveNumber: null });
    }
    throw error;
  }
});

app.get("/api/projects/:id/people", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  const role = await projectAccess(projectId, acct.accountId);
  if (!role) return c.json({ error: { code: "not-found", message: "no such folder on this account" } }, 404);
  const rows = await sql`
    SELECT a.email, 'owner' AS role FROM projects p JOIN accounts a ON a.id = p.account_id WHERE p.id = ${projectId}
    UNION ALL
    SELECT a.email, pm.role FROM project_members pm JOIN accounts a ON a.id = pm.account_id WHERE pm.project_id = ${projectId}`;
  return c.json({ role, people: rows });
});

app.post("/api/projects/:id/invitations", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "account approval required" } }, 403);
  const projectId = c.req.param("id");
  if (await projectAccess(projectId, acct.accountId) !== "owner") return c.json({ error: { code: "owner-only", message: "Only the folder owner can invite people." } }, 403);
  const denied = await projectWriteAccessError(projectId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  // Abuse throttle only — not a collaborator cap. Protects the sending
  // domain's reputation if a credential leaks or a client loops. Real
  // onboarding (even a whole team in one sitting) stays well under this.
  if (!rateLimit("invite-owner", acct.accountId, 20, 3_600_000) ||
      !rateLimit("invite-owner-day", acct.accountId, 60, 86_400_000)) {
    return c.json({ error: { code: "rate", message: "Too many invitations sent in a short time — try again later." } }, 429);
  }
  const body = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) return c.json({ error: { code: "email", message: "Enter a valid email address." } }, 400);
  const project = await sql`SELECT name FROM projects WHERE id = ${projectId}`;
  const invite = newUrlToken("gfi");
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO project_invitations (id, project_id, email, role, invited_by, token_hash, expires_at)
    VALUES (${id}, ${projectId}, ${email}, 'contributor', ${acct.accountId}, ${invite.hash}, now() + interval '7 days')
    ON CONFLICT (project_id, email) DO UPDATE SET token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, accepted_at = NULL`;
  const link = `https://trygoodfolder.com/dashboard?invite=${encodeURIComponent(invite.raw)}`;
  await sendCollaborationInvite(email, String(project[0]?.name ?? "A GoodFolder"), link);
  return c.json({ ok: true });
});

app.post("/api/invitations/accept", async (c) => {
  const acct = await accountFrom(c);
  if (!acct) return c.json({ error: { code: "account-scope", message: "Sign in before accepting this invitation." } }, 403);
  const body = await c.req.json<{ token?: string }>().catch(() => ({} as { token?: string }));
  const token = body.token ?? "";
  const rows = await sql`
    SELECT id, project_id AS "projectId", email FROM project_invitations
    WHERE token_hash = ${sha256(token)} AND expires_at > now() AND accepted_at IS NULL LIMIT 1`;
  const invite = rows[0];
  if (!invite || String(invite.email).toLowerCase() !== acct.email.toLowerCase()) return c.json({ error: { code: "invite", message: "This invitation is invalid, expired, or belongs to another email address." } }, 400);
  const denied = await projectWriteAccessError(String(invite.projectId));
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  await sql.begin(async (tx) => {
    await tx`INSERT INTO project_members (project_id, account_id, role) VALUES (${invite.projectId}, ${acct.accountId}, 'contributor') ON CONFLICT DO NOTHING`;
    await tx`UPDATE project_invitations SET accepted_at = now() WHERE id = ${invite.id}`;
  });
  return c.json({ ok: true, projectId: invite.projectId });
});


// ---------------------------------------------------------------------------
// Bearer auth middleware for /api/* — resolves EITHER a folder transport
// token (project scope, unchanged behavior for git/LFS/saves) OR an account
// device token (management actions below). MUST stay after every route above.
// ---------------------------------------------------------------------------

app.use("/api/*", async (c, next) => {
  const raw = tokenFromAuthHeader(c.req.header("Authorization"));
  const ctx = raw ? await resolveAuthContext(sql, raw) : null;
  if (!ctx) {
    return c.json({ error: { code: "unauthorized", message: "bad token" } }, 401);
  }
  c.set("auth", ctx);
  if (ctx.kind === "project") c.set("scope", ctx);
  await next();
});

/** Record a save after its commit landed. Seq assigned atomically. */
// ---------------------------------------------------------------------------
// Label worker — one plain-language line per save.
//
// Cost rule from TECHNICAL_PROPOSAL.md: the client sends a stat summary plus
// a capped excerpt (≈2000 tokens); media contributes names only. Any failure
// falls back to a generic label — a failed AI summary never blocks a save.
// ---------------------------------------------------------------------------

async function generateLabel(
  ai?: { summary: string; excerpt: string; truncated: boolean },
  userLabel?: string,
): Promise<{ label: string; source: "user" | "agent" }> {
  if (userLabel) return { label: userLabel, source: "user" };
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || !ai || (!ai.excerpt && !ai.summary)) {
    return { label: fallbackOf(ai), source: "agent" };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.LABEL_MODEL || "openai/gpt-4o-mini",
        max_tokens: 60,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You write ONE short plain-language label (max 10 words) describing what changed in someone's folder. No file paths unless helpful, no jargon, no quotes around the label. Example: 'Added trip photos and updated the itinerary'",
          },
          {
            role: "user",
            content:
              `Change summary: ${ai.summary}\n\n` +
              (ai.truncated
                ? "(Preview truncated — the change is larger than shown.)\n\n"
                : "") +
              `Diff preview:\n${ai.excerpt}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`openrouter ${res.status}`);
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("empty label");
    return { label: text.replace(/^["']|["']$/g, "").slice(0, 120), source: "agent" };
  } catch {
    return { label: fallbackOf(ai), source: "agent" };
  }
}

function fallbackOf(ai?: { summary: string }): string {
  return ai?.summary ? `Updated files (${ai.summary.split(".")[0]})` : "Saved changes";
}

app.get("/api/save/preflight", async (c) => {
  const scope = c.get("scope");
  if (!scope) return c.json({ error: { code: "project-scope", message: "folder token required" } }, 403);
  const denied = await writeAccessError(scope.ownerAccountId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  const entitlement = await billing.entitlement(scope.ownerAccountId);
  if (!entitlement.canWrite) {
    const accessDenied = await writeAccessError(scope.ownerAccountId);
    return c.json(
      { error: { code: accessDenied?.code ?? "subscription-required", message: accessDenied?.message ?? "Hosted access is required before saving." } },
      accessDenied?.status ?? 402,
    );
  }
  return c.json({ ok: true, canWrite: true, authorizedBytes: entitlement.authorizedBytes, usageBytes: entitlement.usageBytes, reservedBytes: entitlement.reservedBytes });
});

app.post("/api/saves", async (c) => {
  const scope = c.get("scope");
  if (!scope) {
    return c.json(
      { error: { code: "project-scope", message: "folder token required" } },
      403,
    );
  }
  const denied = await writeAccessError(scope.ownerAccountId);
  if (denied) return c.json({ error: { code: denied.code, message: denied.message } }, denied.status);
  const b = await c.req.json<{
    label?: string;
    labelSource?: "user" | "agent";
    changedPaths?: string[];
    commitSha?: string;
    collision?: string;
    ai?: { summary: string; excerpt: string; truncated: boolean };
    counts?: { added?: number; changed?: number; removed?: number };
    topPaths?: string[];
    harness?: string;
  }>();
  if (!b.commitSha) return c.json({ error: "commitSha required" }, 400);

  // Receipt facts are optional and defensively clamped — a bad client can
  // never corrupt history, only under-report it.
  const clampCount = (v: unknown) =>
    Math.max(0, Math.min(1_000_000, Math.floor(Number(v) || 0)));
  const counts = b.counts
    ? {
        added: clampCount(b.counts.added),
        changed: clampCount(b.counts.changed),
        removed: clampCount(b.counts.removed),
      }
    : null;
  const topPaths = Array.isArray(b.topPaths)
    ? b.topPaths
        .filter((p) => typeof p === "string")
        .map((p) => p.slice(0, 512))
        .slice(0, 10)
    : [];
  const harness =
    typeof b.harness === "string" && /^[A-Za-z0-9 ._-]{1,40}$/.test(b.harness.trim())
      ? b.harness.trim()
      : null;

  const { label, source } = await generateLabel(b.ai, b.label ? b.label : undefined);

  const rows = await sql`
    INSERT INTO saves (id, project_id, seq, label, label_source, actor_device_id, collision, changed_paths, commit_sha,
                       added_count, changed_count, removed_count, top_paths, harness)
    SELECT ${crypto.randomUUID()}, ${scope.projectId},
           COALESCE(MAX(s.seq), 0) + 1,
           ${label}, ${source},
           ${scope.deviceId}, ${b.collision ?? null},
           ${sql.json(b.changedPaths ?? [])}, ${b.commitSha},
           ${counts?.added ?? 0}, ${counts?.changed ?? 0}, ${counts?.removed ?? 0},
           ${sql.json(topPaths)}, ${harness}
    FROM saves s WHERE s.project_id = ${scope.projectId}
    RETURNING id, seq`;
  const save = rows[0]!;
  await sql`
    UPDATE devices SET cursor_save_seq = ${save.seq} WHERE id = ${scope.deviceId}`;
  void billing.refreshProject(scope.projectId, "save").catch((error) => {
    console.error("usage refresh after save failed:", error);
  });
  return c.json({ id: save.id, seq: save.seq, label });
});

app.get("/api/saves", async (c) => {
  const scope = c.get("scope");
  if (!scope) {
    return c.json(
      { error: { code: "project-scope", message: "folder token required" } },
      403,
    );
  }
  const rows = await sql`
    SELECT s.id, s.seq, s.label, s.label_source AS "labelSource", s.collision,
           s.commit_sha AS "commitSha", s.created_at::text AS "createdAt",
           s.added_count AS "addedCount", s.changed_count AS "changedCount",
           s.removed_count AS "removedCount", s.top_paths AS "topPaths",
           s.harness, d.name AS "deviceName"
    FROM saves s LEFT JOIN devices d ON d.id = s.actor_device_id
    WHERE s.project_id = ${scope.projectId}
    ORDER BY s.seq DESC LIMIT 100`;
  return c.json(rows);
});

// ---------------------------------------------------------------------------
// THE INVARIANT — /git/* proxy
//
// No request reaches Gitea except through here, and nothing passes through
// here without a token scoped to the exact project in the path. There is no
// second boundary (identity-boundary test, TECHNICAL_PROPOSAL.md).
// ---------------------------------------------------------------------------

async function gitProxy(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  const deny = (code: number, msg: string, errorCode?: string) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    // RFC-required challenge: stock git clients only offer credentials
    // after seeing this on a 401.
    if (code === 401) headers["www-authenticate"] = 'Basic realm="GoodFolder"';
    res.writeHead(code, headers);
    res.end(JSON.stringify({ error: { code: errorCode ?? (code === 403 ? "project-scope" : "unauthorized"), message: msg } }));
  };

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  // Path shape: /git/<projectId><gitea-repo-path>
  const m = /^\/git\/([0-9a-f-]{36})(\/.*)$/.exec(url.pathname);
  if (!m) return deny(404, "malformed git path");

  const raw = tokenFromAuthHeader(req.headers.authorization);
  const scope = raw ? await resolveScope(sql, raw) : null;
  if (!scope) return deny(401, "unauthorized");
  if (m[1] !== scope.projectId) return deny(403, "token not valid for this project");

  const isWrite = /\/git-receive-pack$/.test(m[2]!) || url.searchParams.get("service") === "git-receive-pack";
  let remainingBytes = Number.POSITIVE_INFINITY;
  if (isWrite) {
    const denied = await writeAccessError(scope.ownerAccountId);
    if (denied) return deny(denied.status, denied.message, denied.code);
    const entitlement = await billing.entitlement(scope.ownerAccountId);
    if (!entitlement.canWrite) {
      const code = entitlement.reason ?? "subscription-required";
      const message = code === "quota-exceeded"
        ? "Protected-data limit reached; existing files and earlier versions remain available."
        : code === "read-only"
          ? "This account is in read and export mode."
          : "Hosted access is required before saving.";
      return deny(code === "quota-exceeded" ? 409 : code === "subscription-required" ? 402 : 403, message, code);
    }
    if (entitlement.authorizedBytes !== null) {
      remainingBytes = Math.max(0, entitlement.authorizedBytes - entitlement.usageBytes - entitlement.reservedBytes);
      const declared = Number(req.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > remainingBytes) {
        return deny(413, "This save is larger than the remaining protected-data allowance.", "quota-exceeded");
      }
    }
  }

  const upstream = `${cfg.giteaInternalUrl}/${cfg.giteaAdminUser}/${m[1]}.git${m[2]}${url.search}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    const key = k.toLowerCase();
    // Node's fetch owns framing for the streamed request body. Forwarding the
    // incoming chunked header makes undici reject the request before it ever
    // reaches the repository service (`UND_ERR_INVALID_ARG`). Keep an explicit
    // content length when the client supplied one, but never forward transfer
    // encoding itself.
    if (key === "authorization" || key === "host" || key === "connection" || key === "expect" || key === "transfer-encoding" || key.startsWith("proxy-")) continue;
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  headers.set("Authorization", `Basic ${Buffer.from(`${cfg.giteaAdminUser}:${cfg.giteaAdminPassword}`).toString("base64")}`);

  let upstreamRes: Response;
  const method = req.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
  };
  if (!["GET", "HEAD"].includes(method)) {
    if (isWrite && Number.isFinite(remainingBytes)) {
      let received = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          received += Buffer.byteLength(chunk);
          if (received > remainingBytes) return callback(new Error("quota-exceeded"));
          callback(null, chunk);
        },
      });
      req.pipe(meter);
      init.body = meter as unknown as import("node:stream/web").ReadableStream;
    } else {
      init.body = req as unknown as import("node:stream/web").ReadableStream;
    }
    init.duplex = "half";
  }
  try {
    upstreamRes = await fetch(upstream, init);
  } catch (e) {
    if ((e as Error).message.includes("quota-exceeded")) {
      return deny(413, "This save is larger than the remaining protected-data allowance.", "quota-exceeded");
    }
    console.error("transport upstream request failed:", e);
    return deny(502, "repository service unreachable");
  }

  const outHeaders: Record<string, string> = {};
  upstreamRes.headers.forEach((v, k) => {
    if (!["transfer-encoding", "content-encoding", "content-length"].includes(k)) outHeaders[k] = v;
  });
  res.writeHead(upstreamRes.status, outHeaders);
  if (upstreamRes.body) {
    const reader = upstreamRes.body.getReader();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) await new Promise<void>((r) => res.once("drain", r));
        }
      } finally {
        res.end();
      }
    })();
  } else {
    res.end();
  }
}

const listener = getRequestListener(app.fetch);

// Dev-topology bridge: locally there is no Caddy, so the control plane plays
// the single-public-origin role and forwards /lfs/* to the LFS app. In
// production Caddy performs exactly this routing.
async function lfsProxy(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  const target = process.env.LFS_INTERNAL_URL ?? "http://127.0.0.1:4101";
  const url = new URL(req.url ?? "/", target);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    const key = k.toLowerCase();
    if (key === "host" || key === "connection" || key === "expect" || key === "transfer-encoding" || key.startsWith("proxy-")) continue;
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  // Pass the resolved token downstream so the LFS app can build self-
  // authenticated action hrefs (interim until presigned R2 URLs).
  const inner = tokenFromAuthHeader(req.headers.authorization);
  if (inner) headers.set("x-gf-token", inner);
  // Preserve the ORIGINAL public host: undici derives Host from the target
  // URL, so the LFS app would otherwise see the internal service name.
  if (req.headers.host) headers.set("x-forwarded-host", req.headers.host);
  try {
    const method = req.method ?? "GET";
    const init: RequestInit & { duplex?: "half" } = { method, headers };
    if (!["GET", "HEAD"].includes(method)) {
      init.body = req as unknown as import("node:stream/web").ReadableStream;
      init.duplex = "half";
    }
    const upstreamRes = await fetch(new URL(url.pathname + url.search, target), init);
    const outHeaders: Record<string, string> = {};
    upstreamRes.headers.forEach((v, k) => {
      if (!["transfer-encoding", "content-encoding", "content-length"].includes(k)) outHeaders[k] = v;
    });
    res.writeHead(upstreamRes.status, outHeaders);
    if (upstreamRes.body) {
      const reader = upstreamRes.body.getReader();
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.write(value)) await new Promise<void>((r) => res.once("drain", r));
          }
        } finally {
          res.end();
        }
      })();
    } else {
      res.end();
    }
  } catch (e) {
    console.error("lfs proxy failed:", e);
    res.writeHead(502);
    res.end("lfs unreachable");
  }
}

const server = createServer((req, res) => {
  const p = req.url ?? "";
  if (p.startsWith("/git/")) return void gitProxy(req, res);
  if (p.startsWith("/lfs/")) return void lfsProxy(req, res);
  return listener(req, res);
});

const stagingSweep = setInterval(() => {
  void sweepStagedUploads().catch((error) => console.error("sweep of unaccepted uploads failed:", error));
}, 6 * 60 * 60_000);
stagingSweep.unref();

if (billingConfig.mode === "stripe") {
  const reconcileTimer = setTimeout(() => {
    void billing.reconcile().catch((error) => console.error("usage reconciliation failed:", error));
  }, 10_000);
  reconcileTimer.unref();
  const daily = setInterval(() => {
    void billing.reconcile().catch((error) => console.error("usage reconciliation failed:", error));
  }, 24 * 60 * 60_000);
  daily.unref();
  const hourly = setInterval(() => {
    void billing.settleUpcomingOverage().catch((error) => console.error("overage worker failed:", error));
  }, 60 * 60_000);
  hourly.unref();
}

server.listen(Number(process.env.PORT ?? 4100), () => {
  console.log(`control plane listening on :${process.env.PORT ?? 4100}`);
});
