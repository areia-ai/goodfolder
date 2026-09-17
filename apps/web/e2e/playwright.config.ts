import { defineConfig, devices } from "@playwright/test";

/**
 * The browser check is driven by e2e/run-services.mjs, which brings up the
 * scratch database, the control plane and the dashboard before Playwright
 * runs and tears them down afterwards. This file only says how the browser
 * itself behaves: one worker (one dialog, one account), no retries (a flaky
 * pass would hide a real race), and a trace kept when something fails.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "services.spec.ts",
  outputDir: ".tmp/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
