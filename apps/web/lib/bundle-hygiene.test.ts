/**
 * Keeps heavy packages off the critical path. posthog-js, mammoth, xlsx,
 * docx and fflate are each used on one surface or behind one flag; a static
 * import would land them in every page's shared chunk. Dynamic imports are
 * allowed, and for posthog-js they must live in exactly one place,
 * lib/analytics.ts, so the rest of the app goes through its helpers.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEAVY = /(posthog-js|mammoth|xlsx|docx|fflate)/;
const STATIC_IMPORT = /^import\s[^;]*from\s+["'](posthog-js|mammoth|xlsx|docx|fflate)["']/gm;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
      yield path;
    }
  }
}

function webSourceFiles(): string[] {
  const files: string[] = [];
  for (const dir of ["app", "components", "lib"]) files.push(...sourceFiles(join(WEB_DIR, dir)));
  const hook = join(WEB_DIR, "instrumentation-client.ts");
  if (statSync(hook, { throwIfNoEntry: false })) files.push(hook);
  return files;
}

describe("bundle hygiene", () => {
  test("no heavy package is imported statically", () => {
    const violations: string[] = [];
    for (const file of webSourceFiles()) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(STATIC_IMPORT)) {
        const line = m[0];
        if (/^import\s+type\b/.test(line)) continue;
        violations.push(`${file}: ${line.trim()}`);
      }
    }
    assert.deepEqual(violations, []);
  });

  test("posthog-js is loaded dynamically in exactly one place", () => {
    const holders = webSourceFiles().filter((file) =>
      readFileSync(file, "utf8").includes('import("posthog-js")'),
    );
    assert.deepEqual(holders, [join(WEB_DIR, "lib", "analytics.ts")]);
  });
});
