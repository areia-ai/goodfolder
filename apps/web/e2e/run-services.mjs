#!/usr/bin/env node
// Browser check for the dashboard's service-key surface.
//
// Brings up everything the check needs on a scratch database and a real
// Chromium, drives the dialog, and tears it all down:
//
//   1. creates a throwaway database (or uses E2E_DATABASE_URL) and applies
//      infra/schema.sql to it;
//   2. seeds one account, one folder and one browser session;
//   3. starts the control plane against that database;
//   4. builds the dashboard with NEXT_PUBLIC_API_URL pointing at it, and
//      serves the static export;
//   5. runs the Playwright spec in e2e/services.spec.ts, which signs in with
//      the seeded session, creates and approves keys, audits and revokes;
//   6. drops the database and stops everything (keep with E2E_KEEP=1).
//
// Usage:
//   E2E_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres \
//     pnpm --filter @goodfolder/web e2e:services
//
// E2E_POSTGRES_URL must allow CREATE DATABASE. E2E_DATABASE_URL uses an
// existing scratch database instead (nothing is dropped then). Artifacts —
// screenshots and the API log — land in e2e/artifacts and e2e/.tmp.
//
// A note on the build: NEXT_PUBLIC_API_URL is baked into the static export,
// so this rebuilds apps/web/out pointing at the scratch API. Running
// `pnpm build` afterwards restores the production default.

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_DIR = join(HERE, "..");
const ROOT = join(WEB_DIR, "..", "..");
const TMP = join(HERE, ".tmp");
const ARTIFACTS = join(HERE, "artifacts");

const API_PORT = Number(process.env.E2E_API_PORT ?? 4211);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 8898);
const API = `http://localhost:${API_PORT}`;
const WEB = `http://localhost:${WEB_PORT}`;
const EMAIL = "e2e@example.com";
const FOLDER_NAME = "Recipes";
const DB_NAME = `gf_e2e_${Date.now().toString(36)}`;
const KEEP = process.env.E2E_KEEP === "1";

const log = (message) => console.log(`[e2e] ${message}`);

function databaseUrlFor(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function waitForOk(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

/** The static export, with the same extension fallbacks nginx.conf uses. */
function staticServer(root) {
  return createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const candidates = [
      join(root, safe),
      join(root, `${safe}.html`),
      join(root, safe, "index.html"),
    ];
    for (const candidate of candidates) {
      try {
        if (!statSync(candidate).isFile()) continue;
      } catch {
        continue;
      }
      const body = readFileSync(candidate);
      res.writeHead(200, {
        "content-type": MIME[extname(candidate)] ?? "application/octet-stream",
        "content-length": body.byteLength,
      });
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  });
}

async function main() {
  mkdirSync(TMP, { recursive: true });
  rmSync(ARTIFACTS, { recursive: true, force: true });
  mkdirSync(ARTIFACTS, { recursive: true });

  const adminUrl = process.env.E2E_POSTGRES_URL;
  const directUrl = process.env.E2E_DATABASE_URL;
  if (!adminUrl && !directUrl) {
    console.error(
      "Set E2E_POSTGRES_URL (a database you may CREATE DATABASE on), or E2E_DATABASE_URL for an existing scratch database.",
    );
    process.exit(2);
  }

  let admin = null;
  let dbUrl;
  if (directUrl) {
    dbUrl = directUrl;
    log("using the database in E2E_DATABASE_URL (it will not be dropped)");
  } else {
    admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE "${DB_NAME}"`);
    dbUrl = databaseUrlFor(adminUrl, DB_NAME);
    log(`created scratch database ${DB_NAME}`);
  }

  const scratch = postgres(dbUrl, { max: 1, onnotice: () => {} });
  await scratch.unsafe(readFileSync(join(ROOT, "infra", "schema.sql"), "utf8"));

  const accountId = randomUUID();
  const folderId = randomUUID();
  const sessionRaw = `e2e${randomUUID().replace(/-/g, "")}`;
  const sessionHash = createHash("sha256").update(sessionRaw).digest("hex");
  await scratch`
    INSERT INTO accounts (id, email) VALUES (${accountId}, ${EMAIL})`;
  await scratch`
    INSERT INTO projects (id, account_id, name) VALUES (${folderId}, ${accountId}, ${FOLDER_NAME})`;
  await scratch`
    INSERT INTO sessions (token_hash, account_id, expires_at)
    VALUES (${sessionHash}, ${accountId}, now() + interval '1 hour')`;
  await scratch.end();
  log(`seeded account, session and folder “${FOLDER_NAME}”`);

  const apiLog = openSync(join(TMP, "api.log"), "w");
  const api = spawn(
    process.execPath,
    ["--experimental-transform-types", join(ROOT, "apps", "control-plane", "src", "index.ts")],
    {
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        PORT: String(API_PORT),
        PUBLIC_URL: API,
        GITEA_INTERNAL_URL: "http://127.0.0.1:1",
        GITEA_ADMIN_PASSWORD: "e2e",
        S3_ENDPOINT: "http://127.0.0.1:1",
        S3_ACCESS_KEY_ID: "e2e",
        S3_SECRET_ACCESS_KEY: "e2e",
        S3_BUCKET: "e2e",
        LFS_INTERNAL_URL: "http://127.0.0.1:1",
        MAGIC_LINK_DEBUG: "1",
      },
      stdio: ["ignore", apiLog, apiLog],
    },
  );
  closeSync(apiLog);
  await waitForOk(`${API}/healthz`);
  log(`control plane up on ${API} (log: e2e/.tmp/api.log)`);

  if (process.env.E2E_SKIP_WEB_BUILD === "1") {
    log("reusing apps/web/out (E2E_SKIP_WEB_BUILD=1)");
  } else {
    log("building the dashboard with NEXT_PUBLIC_API_URL pointing at the scratch API …");
    execFileSync("pnpm", ["run", "build"], {
      cwd: WEB_DIR,
      env: { ...process.env, NEXT_PUBLIC_API_URL: API },
      stdio: "inherit",
    });
  }

  const server = staticServer(join(WEB_DIR, "out"));
  await new Promise((resolve) => server.listen(WEB_PORT, resolve));
  log(`dashboard served on ${WEB}`);

  let failed = false;
  try {
    // Spawned, not run with execFileSync: this process is also serving the
    // dashboard, and a synchronous child would block its event loop — the
    // browser would wait on a page nobody was left to answer.
    const playwright = spawn(
      "pnpm",
      ["exec", "playwright", "test", "--config", "e2e/playwright.config.ts"],
      {
        cwd: WEB_DIR,
        stdio: "inherit",
        env: {
          ...process.env,
          E2E_API_URL: API,
          E2E_WEB_URL: WEB,
          E2E_EMAIL: EMAIL,
          E2E_SESSION_COOKIE: sessionRaw,
          E2E_FOLDER_ID: folderId,
          E2E_FOLDER_NAME: FOLDER_NAME,
          E2E_ARTIFACTS: ARTIFACTS,
        },
      },
    );
    const exitCode = await new Promise((resolve) => playwright.on("exit", resolve));
    if (exitCode !== 0) failed = true;
  } catch {
    failed = true;
  }

  server.close();
  api.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (api.exitCode === null) api.kill("SIGKILL");

  if (admin) {
    if (KEEP) {
      log(`keeping scratch database ${DB_NAME} (E2E_KEEP=1)`);
    } else {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
    }
    await admin.end();
  }
  log(`screenshots in apps/web/e2e/artifacts`);
  if (failed) process.exit(1);
  log("done");
}

main().catch((error) => {
  console.error("[e2e] failed:", error);
  process.exit(1);
});
