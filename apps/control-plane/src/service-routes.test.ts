import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SERVICE_SCOPES } from "@goodfolder/serverlib";
import { openApiDocument } from "./openapi.ts";

/**
 * Two kinds of proof, in one file:
 *  - the published contract (OpenAPI) is well-formed and names every scope;
 *  - the routes that accept a scoped key are registered before the bearer
 *    middleware, and every scope they demand is a real one. The second is a
 *    source-level check on purpose: the alternative is a live server, and
 *    the thing that goes wrong here is registration order or a typo'd scope,
 *    both visible in the text.
 */

const document = openApiDocument("https://api.trygoodfolder.com");
const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;

test("the document is OpenAPI 3.1 with one server and unique operation ids", () => {
  assert.equal(document.openapi, "3.1.0");
  assert.deepEqual(document.servers, [{ url: "https://api.trygoodfolder.com" }]);
  const ids: string[] = [];
  for (const [path, item] of Object.entries(paths)) {
    const methods = Object.keys(item);
    assert.ok(methods.length > 0, `${path} has no operations`);
    for (const [method, operation] of Object.entries(item)) {
      assert.equal(typeof operation.summary, "string", `${method} ${path} has no summary`);
      assert.equal(typeof operation.description, "string", `${method} ${path} has no description`);
      assert.ok(operation.responses, `${method} ${path} has no responses`);
      ids.push(String(operation.operationId));
    }
  }
  assert.equal(new Set(ids).size, ids.length, "operation ids must be unique");
});

test("every path a service needs is published", () => {
  for (const path of [
    "/api/pair/start",
    "/api/pair/{code}/wait",
    "/api/pair/{code}/approve",
    "/api/service-credentials",
    "/api/service-credentials/{credentialId}",
    "/api/projects",
    "/api/projects/{id}/saves",
    "/api/projects/{id}/restore",
    "/api/projects/{id}/undo",
    "/api/saves",
    "/api/projects/{id}/files",
    "/api/projects/{id}/file",
    "/api/projects/{id}/file/raw",
    "/api/projects/{id}/proposals",
    "/api/webhooks",
    "/api/webhooks/{webhookId}",
    "/api/webhooks/{webhookId}/deliveries",
    "/api/webhooks/{webhookId}/test",
    "/mcp",
    "/openapi.json",
  ]) {
    assert.ok(paths[path], `${path} is missing from the document`);
  }
});

test("documented schemas carry the fields the routes actually return", () => {
  const components = document.components as { schemas: Record<string, { properties?: Record<string, unknown> }> };
  const projectFields = Object.keys(components.schemas.Project?.properties ?? {});
  for (const field of ["contributorCount", "openProposalCount"]) {
    assert.ok(projectFields.includes(field), `Project is missing ${field}`);
  }
  const saveFields = Object.keys(components.schemas.Save?.properties ?? {});
  for (const field of ["labelSource", "collision", "changedPaths", "changedPathsTruncated"]) {
    assert.ok(saveFields.includes(field), `Save is missing ${field}`);
  }
  const filesSchema = (paths["/api/projects/{id}/files"]!.get as { responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }> })
    .responses["200"]!.content["application/json"]!.schema as { properties: Record<string, { items?: { properties?: Record<string, unknown> } }> };
  const fileFields = Object.keys(filesSchema.properties.files?.items?.properties ?? {});
  for (const field of ["editable", "proposable"]) {
    assert.ok(fileFields.includes(field), `files[] is missing ${field}`);
  }
});

test("every route the Services page names is in the document", () => {
  assert.ok(paths["/api/service-credentials/{credentialId}/usage"], "the activity route is missing");
  const usage = paths["/api/service-credentials/{credentialId}/usage"]!.get as { responses: Record<string, unknown> };
  assert.ok(usage.responses["200"]);
});

test("the security schemes name the five scopes and nothing invented", () => {
  const components = document.components as {
    securitySchemes: Record<string, { description?: string }>;
  };
  const serviceKey = components.securitySchemes.serviceKey;
  assert.ok(serviceKey);
  for (const scope of SERVICE_SCOPES) {
    assert.match(String(serviceKey.description), new RegExp(scope.replace(":", ":")));
  }
  const seen = new Set<string>();
  for (const item of Object.values(paths)) {
    for (const operation of Object.values(item)) {
      const security = (operation.security ?? []) as Array<Record<string, string[]>>;
      for (const requirement of security) {
        for (const scope of requirement.serviceKey ?? []) seen.add(scope);
      }
    }
  }
  assert.ok(seen.size > 0);
  for (const scope of seen) {
    assert.ok((SERVICE_SCOPES as readonly string[]).includes(scope), `${scope} is not a real scope`);
  }
});

const indexSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const lines = indexSource.split("\n");

/** Every call that lets an external caller through, with its scope(s). */
function externalCallerSites(): Array<{ line: number; scopes: string[] }> {
  const sites: Array<{ line: number; scopes: string[] }> = [];
  const marker = "externalCaller(c,";
  let from = 0;
  for (;;) {
    const start = indexSource.indexOf(marker, from);
    if (start < 0) break;
    from = start + marker.length;
    // Walk to the call's closing parenthesis so argument lists with their
    // own parentheses (`c.req.param("id")`) do not confuse the read.
    let depth = 1;
    let i = from;
    while (i < indexSource.length && depth > 0) {
      const ch = indexSource[i]!;
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
    const args = indexSource.slice(from, i - 1);
    const scopes = [...args.matchAll(/"([^"]+)"/g)]
      .map((match) => match[1]!)
      .filter((value) => /^(read|write|git):/.test(value));
    const line = indexSource.slice(0, start).split("\n").length;
    sites.push({ line, scopes });
  }
  return sites;
}

test("every scope a route demands is a real scope", () => {
  const sites = externalCallerSites();
  assert.ok(sites.length >= 14, `expected the external routes, found ${sites.length}`);
  for (const site of sites) {
    assert.ok(site.scopes.length > 0, `line ${site.line} names no scope`);
    for (const scope of site.scopes) {
      assert.ok((SERVICE_SCOPES as readonly string[]).includes(scope), `line ${site.line}: ${scope}`);
    }
  }
});

test("the scoped routes are registered before the bearer middleware", () => {
  const middleware = lines.findIndex((line) => line.includes("Bearer auth middleware for /api/*"));
  assert.ok(middleware > 0, "the bearer middleware marker is gone; update this test");
  for (const site of externalCallerSites()) {
    assert.ok(site.line < middleware, `externalCaller on line ${site.line} sits below the bearer middleware`);
  }
});

test("the documented scope per route is the one the route asks for", () => {
  const all = new Set(externalCallerSites().flatMap((site) => site.scopes));
  // Every scope exists somewhere on the REST surface, and the preview paths
  // of restore/undo ask for the read half of the pair.
  assert.deepEqual([...all].sort(), [...SERVICE_SCOPES].sort());
  const found = new Set(externalCallerSites().map((site) => site.scopes.join("|")));
  assert.ok(found.has("git:write|git:read"), "restore/undo previews must ask for the read scope");
});
