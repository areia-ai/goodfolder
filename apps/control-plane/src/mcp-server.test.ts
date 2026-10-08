import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { RepositoryAdapter, Sql } from "@goodfolder/serverlib";
import {
  MCP_BODY_LIMIT,
  buildServer,
  handleMcpRequest,
  readJsonBody,
  resolveMcpCaller,
  type McpAuth,
  type McpServices,
} from "./mcp-server.ts";

const TOOL_NAMES = [
  "goodfolder_create",
  "goodfolder_clone",
  "goodfolder_connect",
  "goodfolder_rename",
  "goodfolder_save",
  "goodfolder_sync",
  "goodfolder_log",
  "goodfolder_restore",
  "goodfolder_undo",
];

function fakeSql(options: { service?: boolean; accountDevice?: boolean; projectToken?: boolean } = {}): Sql {
  const query = async (strings: TemplateStringsArray) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    if (text.includes("FROM transfer_tokens")) {
      return options.projectToken ? [{ device_id: "d", project_id: "folder-1", account_id: "account-1", device_kind: "user" }] : [];
    }
    if (text.includes("FROM account_devices")) {
      return options.accountDevice
        ? [{ account_device_id: "ad-1", account_id: "account-1", email: "owner@example.com" }]
        : [];
    }
    if (text.includes("FROM service_credentials sc JOIN accounts")) {
      return options.service
        ? [{
            credentialId: "cred-1",
            accountId: "account-1",
            email: "owner@example.com",
            name: "Instinct",
            scopes: ["read:folders", "read:files", "git:read", "git:write"],
            projectId: null,
          }]
        : [];
    }
    if (text.startsWith("SELECT id, name FROM projects")) return [{ id: "folder-1", name: "Recipes" }];
    if (text.startsWith("SELECT s.seq, s.label")) {
      return [{
        seq: 3, label: "Added the plan", createdAt: "2026-09-17T10:00:00.000Z", harness: "Instinct",
        commitSha: "head-1", addedCount: 1, changedCount: 0, removedCount: 0, topPaths: [], deviceName: "Instinct",
      }];
    }
    if (text.startsWith("SELECT seq, label, commit_sha")) return [{ seq: 3, label: "Added the plan", commitSha: "head-0" }];
    if (text.startsWith("INSERT INTO saves")) return [{ seq: 4 }];
    return [];
  };
  const tagged = query as unknown as Sql;
  tagged.json = ((value: unknown) => value) as Sql["json"];
  tagged.begin = (async (work: (tx: Sql) => Promise<unknown>) => work(tagged)) as unknown as Sql["begin"];
  return tagged;
}

function services(sql: Sql): McpServices {
  const repos = {
    head: async () => "head-1",
    tree: async (_projectId: string, ref = "main") =>
      ref === "head-0" ? [] : [{ path: "plan.md", type: "blob", size: 10, sha: "plan-sha" }],
    readFile: async () => null,
    changeFiles: async () => ({ commitSha: "head-2" }),
  } as unknown as RepositoryAdapter;
  return {
    deps: {
      sql,
      repos,
      writeAccessError: async () => null,
      refreshUsage: () => {},
      labelFor: async (_ai, label) => (label ? { label, source: "user" } : { label: "Saved changes", source: "agent" }),
    },
    publicBase: "https://api.trygoodfolder.com",
    createFolder: async () => ({ projectId: "folder-new", name: "New" }),
    renameFolder: async () => ({ ok: true }),
    deviceFor: async () => "device-1",
  };
}

async function connected(auth: McpAuth, sql: Sql) {
  const server = buildServer(services(sql), auth);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport as unknown as Parameters<typeof server.connect>[0]);
  const client = new Client({ name: "test-client", version: "0" });
  await client.connect(clientTransport);
  return client;
}

const serviceAuth = (scopes: McpAuth["scopes"]): McpAuth => ({
  caller: {
    kind: "service",
    accountId: "account-1",
    email: "owner@example.com",
    boundProjectId: null,
    serviceName: "Instinct",
    credentialId: "cred-1",
  },
  scopes,
  credentialId: "cred-1",
});

const accountAuth: McpAuth = {
  caller: { kind: "account", accountId: "account-1", email: "owner@example.com", boundProjectId: null },
  scopes: "account",
  credentialId: null,
};

test("the hosted surface offers exactly the nine known shapes", async () => {
  const client = await connected(accountAuth, fakeSql());
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
  const save = tools.tools.find((tool) => tool.name === "goodfolder_save");
  assert.deepEqual(Object.keys(save?.inputSchema.properties ?? {}).sort(), ["folder", "label"]);
  const undo = tools.tools.find((tool) => tool.name === "goodfolder_undo");
  assert.deepEqual(Object.keys(undo?.inputSchema.properties ?? {}).sort(), ["confirm", "folder", "session"]);
});

test("a key without the tool's scope is refused with a readable sentence", async () => {
  const client = await connected(serviceAuth(["read:folders"]), fakeSql());
  const log = await client.callTool({ name: "goodfolder_log", arguments: { folder: "Recipes" } });
  assert.equal(log.isError, undefined);
  assert.match(String((log.content as Array<{ text: string }>)[0]!.text), /Added the plan/);

  const save = await client.callTool({ name: "goodfolder_save", arguments: { folder: "Recipes", label: "x" } });
  assert.equal(save.isError, true);
  assert.match(String((save.content as Array<{ text: string }>)[0]!.text), /git:write/);
});

test("a key with git:write records a save for the folder it names", async () => {
  const client = await connected(serviceAuth(["git:write"]), fakeSql());
  const saved = await client.callTool({ name: "goodfolder_save", arguments: { folder: "Recipes", label: "Added the plan" } });
  assert.equal(saved.isError, undefined);
  assert.match(String((saved.content as Array<{ text: string }>)[0]!.text), /#4/);
});

test("only an account approval may create or rename folders", async () => {
  const service = await connected(serviceAuth(["read:folders"]), fakeSql());
  const created = await service.callTool({ name: "goodfolder_create", arguments: { name: "New" } });
  assert.equal(created.isError, true);
  assert.match(String((created.content as Array<{ text: string }>)[0]!.text), /account approval/);
  const renamed = await service.callTool({ name: "goodfolder_rename", arguments: { folder: "Recipes", name: "Dinner" } });
  assert.equal(renamed.isError, true);

  const account = await connected(accountAuth, fakeSql());
  const ok = await account.callTool({ name: "goodfolder_create", arguments: { name: "New" } });
  assert.equal(ok.isError, undefined);
  assert.match(String((ok.content as Array<{ text: string }>)[0]!.text), /folder-new/);
});

function request(headers: Record<string, string>): IncomingMessage {
  const lowered = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return { headers: lowered } as unknown as IncomingMessage;
}

/** A streamed request fake: real chunks, declared headers, a method and a url. */
function streamedRequest(chunks: string[], headers: Record<string, string>, method = "POST"): IncomingMessage {
  const lowered = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  const req = Readable.from(chunks.map((chunk) => Buffer.from(chunk))) as IncomingMessage;
  req.headers = lowered;
  req.method = method;
  req.url = "/mcp";
  return req;
}

class FakeResponse extends EventEmitter {
  status = 0;
  body = "";
  writeHead(status: number) {
    this.status = status;
    return this;
  }
  end(body?: string) {
    this.body = body ?? "";
    return this;
  }
}

test("readJsonBody parses a body inside the limit", async () => {
  const req = streamedRequest(['{"a":"xy"}'], {});
  const read = await readJsonBody(req, 64);
  assert.deepEqual(read, { ok: true, body: { a: "xy" } });
});

test("readJsonBody refuses a declared size without reading the stream", async () => {
  const req = streamedRequest(["x".repeat(128)], { "content-length": "65" });
  const read = await readJsonBody(req, 64);
  assert.deepEqual(read, { ok: false, status: 413, message: "That request is too large." });
  assert.equal(req.readableDidRead, false);
  assert.equal(req.listenerCount("data"), 0);
});

test("readJsonBody refuses a streamed body the moment it crosses the limit", async () => {
  const req = streamedRequest(["x".repeat(40), "y".repeat(40)], {});
  const read = await readJsonBody(req, 64);
  assert.deepEqual(read, { ok: false, status: 413, message: "That request is too large." });
});

test("readJsonBody answers 400 on bytes that are not JSON", async () => {
  const req = streamedRequest(["not json"], {});
  const read = await readJsonBody(req, 64);
  assert.deepEqual(read, { ok: false, status: 400, message: "That request was not valid JSON." });
});

test("the endpoint refuses an oversized request before the SDK sees it", async () => {
  const req = streamedRequest(["{}"], {
    authorization: "Bearer x",
    "content-length": String(MCP_BODY_LIMIT + 1),
    "content-type": "application/json",
  });
  const res = new FakeResponse();
  await handleMcpRequest(services(fakeSql({ accountDevice: true })), fakeSql({ accountDevice: true }), req, res as unknown as ServerResponse);
  assert.equal(res.status, 413);
  const body = JSON.parse(res.body) as { error: { code: string } };
  assert.equal(body.error.code, "too-large");
});

test("a real socket gets the 413, not a reset", async () => {
  const server = http.createServer((req, res) => {
    void handleMcpRequest(services(fakeSql({ accountDevice: true })), fakeSql({ accountDevice: true }), req, res);
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          authorization: "Bearer x",
          "content-type": "application/json",
          "content-length": String(MCP_BODY_LIMIT + 1),
        },
      });
      req.on("response", (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.write("x".repeat(100));
    });
    assert.equal(result.status, 413);
    assert.equal((JSON.parse(result.body) as { error: { code: string } }).error.code, "too-large");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the endpoint refuses a folder's own credential", async () => {
  const refused = await resolveMcpCaller(fakeSql({ projectToken: true }), request({ authorization: "Bearer folder-token" }));
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.status, 403);
});

test("the endpoint takes an account approval or a scoped key, and nothing else", async () => {
  assert.equal((await resolveMcpCaller(fakeSql(), request({}))).ok, false);
  const account = await resolveMcpCaller(fakeSql({ accountDevice: true }), request({ authorization: "Bearer gfa_account" }));
  assert.equal(account.ok, true);
  if (account.ok) assert.equal(account.scopes, "account");
  const service = await resolveMcpCaller(fakeSql({ service: true }), request({ authorization: "Bearer gfx_service" }));
  assert.equal(service.ok, true);
  if (service.ok) {
    assert.deepEqual(service.scopes, ["read:folders", "read:files", "git:read", "git:write"]);
    assert.equal(service.caller.serviceName, "Instinct");
  }
});
