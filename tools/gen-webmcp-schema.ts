// Writes apps/web/lib/webmcp.schema.json from the live tool registration.
//
//   pnpm webmcp:schema
//   node --experimental-transform-types tools/gen-webmcp-schema.ts
//
// CI never runs this — webmcp.evals.test.ts fails when the checked-in file is
// stale, and a human regenerates it here.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderWebMcpSchemaFile } from "../apps/web/lib/webmcp-schema.ts";

const target = fileURLToPath(new URL("../apps/web/lib/webmcp.schema.json", import.meta.url));
writeFileSync(target, await renderWebMcpSchemaFile());
console.log(`wrote ${target}`);
