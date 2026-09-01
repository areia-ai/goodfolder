// Guards the webmcp-evals fixtures without running an LLM.
//
//   node --experimental-transform-types --test apps/web/lib/webmcp.evals.test.ts
//
//   - webmcp.schema.json is regenerated in memory and must match what is checked
//     in. A drift means a tool changed and nobody ran `pnpm webmcp:schema`.
//   - webmcp.evals.json must be a well-formed webmcp-evals suite whose every
//     expected call names a real tool and passes it only arguments that tool
//     declares.
//
// The scored LLM run (`pnpm webmcp:evals`) lives in its own workflow because it
// needs a model key and is non-deterministic; this file keeps the inputs honest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderWebMcpSchemaFile, type WebMcpToolSchema } from "./webmcp-schema.ts";

const SCHEMA_PATH = fileURLToPath(new URL("./webmcp.schema.json", import.meta.url));
const EVALS_PATH = fileURLToPath(new URL("./webmcp.evals.json", import.meta.url));

const MATCHER_OPERATORS = new Set(["$pattern", "$contains", "$gt", "$gte", "$lt", "$lte", "$type", "$any"]);
const CALL_META_KEYS = new Set(["functionName", "arguments", "optional", "result"]);

interface JsonSchemaNode {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  enum?: unknown[];
}

interface FunctionCall {
  functionName: string;
  arguments?: Record<string, unknown>;
  optional?: boolean;
}

// webmcp-evals lets an expectedCall entry be a plain call or an ordering group.
type ExpectedNode = FunctionCall | { ordered: ExpectedNode[] } | { unordered: ExpectedNode[] };

interface EvalCase {
  name: string;
  messages: Array<{ role: string; type?: string; content: string }>;
  expectedCall: ExpectedNode[];
}

/** Depth-first list of the leaf function calls in an expectedCall tree. */
function flattenCalls(nodes: ExpectedNode[]): FunctionCall[] {
  return nodes.flatMap((node) => {
    if ("ordered" in node) return flattenCalls(node.ordered);
    if ("unordered" in node) return flattenCalls(node.unordered);
    return [node];
  });
}

function isMatcher(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => key.startsWith("$"));
}

/** Every argument key must be a property the tool declares; recurse through objects and arrays. */
function checkArguments(where: string, schema: JsonSchemaNode, args: Record<string, unknown>): void {
  const properties = schema.properties ?? {};
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    assert.ok(property, `${where}: argument "${key}" is not a parameter of the tool`);

    if (isMatcher(value)) {
      for (const operator of Object.keys(value)) {
        assert.ok(MATCHER_OPERATORS.has(operator), `${where}.${key}: unknown matcher operator "${operator}"`);
      }
      continue;
    }
    if (property.enum && (typeof value === "string" || typeof value === "number")) {
      assert.ok(property.enum.includes(value), `${where}.${key}: ${JSON.stringify(value)} is not in the enum`);
    }
    if (property.type === "object" && typeof value === "object" && value !== null) {
      checkArguments(`${where}.${key}`, property, value as Record<string, unknown>);
    }
    if (property.type === "array") {
      assert.ok(Array.isArray(value), `${where}.${key}: expected an array`);
      const itemSchema = property.items;
      if (itemSchema?.type === "object") {
        for (const [index, element] of (value as unknown[]).entries()) {
          if (isMatcher(element)) continue;
          assert.ok(
            typeof element === "object" && element !== null,
            `${where}.${key}[${index}]: expected an object`,
          );
          checkArguments(`${where}.${key}[${index}]`, itemSchema, element as Record<string, unknown>);
        }
      }
    }
  }
}

test("webmcp.schema.json is in sync with the registered tools", async () => {
  const onDisk = readFileSync(SCHEMA_PATH, "utf8");
  const regenerated = await renderWebMcpSchemaFile();
  assert.equal(
    onDisk,
    regenerated,
    "webmcp.schema.json is stale — regenerate it with `pnpm webmcp:schema`",
  );
});

test("webmcp.evals.json is a well-formed suite bound to real tools", async () => {
  const tools: WebMcpToolSchema[] = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")).tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool.inputSchema as JsonSchemaNode]));
  const cases: EvalCase[] = JSON.parse(readFileSync(EVALS_PATH, "utf8"));

  assert.ok(Array.isArray(cases) && cases.length > 0, "the suite must hold at least one case");
  const names = new Set<string>();

  for (const testCase of cases) {
    const where = `case "${testCase.name}"`;
    assert.ok(testCase.name && typeof testCase.name === "string", `${where}: missing name`);
    assert.ok(!names.has(testCase.name), `${where}: duplicate case name`);
    names.add(testCase.name);

    assert.ok(Array.isArray(testCase.messages) && testCase.messages.length > 0, `${where}: needs messages`);
    assert.equal(testCase.messages[0]?.role, "user", `${where}: first message must be from the user`);
    assert.ok(
      testCase.messages.every((message) => typeof message.content === "string" && message.content.length > 0),
      `${where}: every message needs content`,
    );

    assert.ok(
      Array.isArray(testCase.expectedCall) && testCase.expectedCall.length > 0,
      `${where}: needs at least one expected call`,
    );

    for (const call of flattenCalls(testCase.expectedCall)) {
      for (const key of Object.keys(call)) {
        assert.ok(CALL_META_KEYS.has(key), `${where}: unexpected key "${key}" on an expected call`);
      }
      const schema = byName.get(call.functionName);
      assert.ok(schema, `${where}: "${call.functionName}" is not a registered tool`);
      if (call.arguments) {
        assert.ok(
          typeof call.arguments === "object" && !Array.isArray(call.arguments),
          `${where}: arguments must be an object`,
        );
        checkArguments(`${where} → ${call.functionName}`, schema, call.arguments);
      }
    }
  }
});

test("the suite never expects a state-changing or review tool that does not exist", async () => {
  const cases: EvalCase[] = JSON.parse(readFileSync(EVALS_PATH, "utf8"));
  const called = new Set(
    cases.flatMap((testCase) => flattenCalls(testCase.expectedCall).map((call) => call.functionName)),
  );
  // GoodFolder has no accept / reject / delete / permission tool on purpose.
  for (const forbidden of ["accept_change_proposal", "reject_change_proposal", "save_document", "delete_file", "grant_access"]) {
    assert.ok(!called.has(forbidden), `the suite expects "${forbidden}", which must never exist`);
  }
});
