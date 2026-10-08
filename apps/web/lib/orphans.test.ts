/**
 * Every component and lib module must be reachable: an orphan file ships in
 * no bundle and rots unseen. Resolves `@/…`, relative specifiers with or
 * without the extension, and index files; tools/*.ts count as importers.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(WEB_DIR, "..", "..");

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") yield* sourceFiles(path);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield path;
  }
}

const isTest = (file: string) => file.endsWith(".test.ts") || file.endsWith(".test.tsx");

function importers(): string[] {
  const files: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const file of sourceFiles(join(WEB_DIR, dir))) files.push(file);
  }
  const hook = join(WEB_DIR, "instrumentation-client.ts");
  if (existsSync(hook)) files.push(hook);
  const tools = join(REPO_ROOT, "tools");
  if (existsSync(tools)) {
    for (const entry of readdirSync(tools)) {
      if (/\.(ts|mts)$/.test(entry)) files.push(join(tools, entry));
    }
  }
  return files;
}

const SPECIFIER = /(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g;

function resolveSpecifier(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/")
    ? join(WEB_DIR, spec.slice(2))
    : spec.startsWith("./") || spec.startsWith("../")
      ? resolvePath(dirname(fromFile), spec)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return base;
}

describe("module reachability", () => {
  test("every component and lib module is imported by something", () => {
    const targets = [
      ...sourceFiles(join(WEB_DIR, "components")),
      ...sourceFiles(join(WEB_DIR, "lib")),
    ].filter((file) => !isTest(file));
    const reachable = new Set<string>();
    for (const file of importers()) {
      for (const m of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
        const resolved = resolveSpecifier(m[1]!, file);
        if (resolved) reachable.add(resolved);
      }
    }
    const orphans = targets.filter((file) => !reachable.has(file));
    assert.deepEqual(orphans, []);
  });
});
