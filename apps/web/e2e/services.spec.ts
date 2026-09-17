import { expect, test, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The dashboard's service-key surface, in a real browser against a real
 * control plane on a scratch database:
 *
 *  - the dialog opens and shows what the account currently has;
 *  - a key is created with two scopes and a one-folder binding, and both
 *    the fresh key and the granted scopes render correctly;
 *  - the approval ceremony for a device-flow request names the requested
 *    scopes and the folder, in words, before anything is granted;
 *  - the usage view shows the audit rows for a key that was actually used;
 *  - revoking a key kills it immediately while another key keeps working.
 *
 * run-services.mjs provides every E2E_* value and the seeded session.
 */

const API = process.env.E2E_API_URL!;
const WEB = process.env.E2E_WEB_URL!;
const EMAIL = process.env.E2E_EMAIL!;
const SESSION = process.env.E2E_SESSION_COOKIE!;
const FOLDER_ID = process.env.E2E_FOLDER_ID!;
const FOLDER_NAME = process.env.E2E_FOLDER_NAME!;
const ARTIFACTS = process.env.E2E_ARTIFACTS!;

async function listFolders(request: APIRequestContext, key: string) {
  const res = await request.get(`${API}/api/projects`, {
    headers: { authorization: `Bearer ${key}` },
  });
  return { status: res.status(), body: res.ok() ? await res.json() : null };
}

test("services dialog: create, approve, audit, revoke", async ({ page, context, request }) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: join(ARTIFACTS, `${name}.png`) });

  // The session cookie the runner seeded stands in for a finished sign-in;
  // the dialog under test is what this check is about.
  // secure: false on purpose: the check runs over http://localhost, where a
  // Secure cookie would be dropped at set time. The server still writes the
  // real cookie with Secure over HTTPS; this stands in for one.
  await context.addCookies([
    { name: "gf_session", value: SESSION, url: WEB, httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
  await page.goto(`${WEB}/dashboard`);
  const accountMenu = page.getByRole("button", { name: `Account: ${EMAIL}` });
  await expect(accountMenu).toBeVisible({ timeout: 30_000 });

  /* ------------------------------------------------ the dialog and a key */

  await accountMenu.click();
  await page.getByRole("menuitem", { name: "Services and assistants" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Services and assistants" })).toBeVisible();
  await expect(dialog.getByText("No services have access to this account.")).toBeVisible();
  await shot("01-services-dialog-empty");

  await dialog.getByRole("button", { name: "Add a service" }).click();
  await dialog.getByLabel("What is it called?").fill("Instinct");
  await dialog.getByLabel("See folders and their history").check();
  await dialog.getByLabel("Send changed files back to the folder").check();
  await dialog.getByLabel("Which folders?").selectOption({ label: FOLDER_NAME });
  await shot("02-key-form");

  await dialog.getByRole("button", { name: "Create the key" }).click();
  const freshKey = dialog.locator("code");
  await expect(freshKey).toContainText("gfx");
  const dashboardKey = (await freshKey.textContent())!.trim();
  await shot("03-key-created");
  await dialog.getByRole("button", { name: "I have saved it" }).click();

  const keyRow = dialog.locator("li", { hasText: "Instinct" });
  await expect(keyRow).toContainText("See folders and their history");
  await expect(keyRow).toContainText("Send changed files back to the folder");
  await expect(keyRow).toContainText(`Only “${FOLDER_NAME}”`);
  await shot("04-key-row");

  /* --------------------------------- the approval ceremony, in words */

  const started = await request.post(`${API}/api/pair/start`, {
    data: { deviceName: "Cloud runner", scopes: ["read:folders", "read:files"], projectId: FOLDER_ID },
  });
  expect(started.status()).toBe(200);
  const { code } = await started.json();

  await page.goto(`${API}/pair/${code}`);
  await expect(page.getByRole("heading", { name: "Approve “Cloud runner”?" })).toBeVisible();
  const scopes = page.locator("ul.scopes");
  await expect(scopes).toContainText("read:folders");
  await expect(scopes).toContainText("See folders and their history");
  await expect(scopes).toContainText("read:files");
  await expect(scopes).toContainText("Read files");
  await expect(page.getByText(`only to the folder “${FOLDER_NAME}”`)).toBeVisible();
  await shot("05-approval-ceremony");

  await page.getByRole("button", { name: "Approve this service" }).click();
  await expect(page.getByText("Approved. You can close this window and return to your app.")).toBeVisible();
  await shot("06-approved");

  const waited = await request.get(`${API}/api/pair/${code}/wait`);
  const { token: cloudKey } = await waited.json();
  expect(cloudKey).toMatch(/^gfx/);

  // The granted scopes work; a scope that was not granted does not.
  const granted = await listFolders(request, cloudKey);
  expect(granted.status).toBe(200);
  expect(granted.body.map((folder: { name: string }) => folder.name)).toEqual([FOLDER_NAME]);
  const refused = await request.post(`${API}/api/service-credentials`, {
    headers: { authorization: `Bearer ${cloudKey}` },
    data: { name: "should not work", scopes: ["read:folders"] },
  });
  expect(refused.status()).toBe(403);

  /* ------------------------------------------- usage view, then revoke */

  await page.goto(`${WEB}/dashboard`);
  await page.getByRole("button", { name: `Account: ${EMAIL}` }).click();
  await page.getByRole("menuitem", { name: "Services and assistants" }).click();
  const reopened = page.getByRole("dialog");
  const used = await listFolders(request, dashboardKey);
  expect(used.status).toBe(200);

  const usedRow = reopened.locator("li", { hasText: "Instinct" });
  await usedRow.getByRole("button", { name: "What it did" }).click();
  await expect(usedRow).toContainText("/api/projects");
  await expect(usedRow).toContainText("read:folders");
  await shot("07-usage-audit");

  await usedRow.getByRole("button", { name: "Take back" }).click();
  await expect(reopened.locator("li", { hasText: "Instinct" })).toHaveCount(0);
  await shot("08-revoked");

  const dead = await listFolders(request, dashboardKey);
  expect(dead.status).toBeGreaterThanOrEqual(400);
  const alive = await listFolders(request, cloudKey);
  expect(alive.status).toBe(200);
});
