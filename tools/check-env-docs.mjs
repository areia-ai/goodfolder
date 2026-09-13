#!/usr/bin/env node
// Environment-documentation gate — every variable in .env.example must appear
// in docs/configuration.md, and the doc must not name a variable the file
// does not carry. Catches the drift where one side gets a new name and the
// other doesn't.
//
// How it works: collects `KEY=` names from .env.example (skipping comments
// and blanks) and backticked `KEY` names from docs/configuration.md, then
// fails on any name present on exactly one side.
//
// Run: node tools/check-env-docs.mjs   (exit 1 on any drift)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const envText = readFileSync(join(ROOT, ".env.example"), "utf8");
const docText = readFileSync(join(ROOT, "docs/configuration.md"), "utf8");

const envNames = new Set(
  envText
    .split("\n")
    .map((line) => /^([A-Z][A-Z_0-9]*)=/.exec(line)?.[1])
    .filter(Boolean),
);

const docNames = new Set(
  [...docText.matchAll(/`([A-Z][A-Z_0-9]{2,})`/g)].map((m) => m[1]),
);

const missingFromDoc = [...envNames].filter((name) => !docNames.has(name));
const missingFromEnv = [...docNames].filter((name) => !envNames.has(name));

if (missingFromDoc.length || missingFromEnv.length) {
  if (missingFromDoc.length) {
    console.error("in .env.example but not docs/configuration.md:");
    for (const name of missingFromDoc) console.error(`  ${name}`);
  }
  if (missingFromEnv.length) {
    console.error("in docs/configuration.md but not .env.example:");
    for (const name of missingFromEnv) console.error(`  ${name}`);
  }
  process.exit(1);
}

console.log(`env docs: ${envNames.size} variables documented on both sides ✓`);
