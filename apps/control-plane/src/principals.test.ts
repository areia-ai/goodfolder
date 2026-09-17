import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "hono";
import type { Sql } from "@goodfolder/serverlib";
import { makePrincipals } from "./principals.ts";

/**
 * Scope enforcement for the REST surface, driven through the same helper
 * every external route calls. The database is faked at the tagged-template
 * boundary: the helper's decisions depend only on which rows come back.
 */

interface FakeOptions {
  service?: {
    credentialId: string;
    accountId: string;
    email: string;
    name: string;
    scopes: string[];
    projectId: string | null;
  } | null;
  accountDevice?: { accountId: string; email: string; deviceId: string } | null;
  projectToken?: boolean;
  session?: { accountId: string; email: string } | null;
}

function fakeSql(options: FakeOptions = {}): Sql {
  const query = async (strings: TemplateStringsArray) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    if (text.includes("FROM transfer_tokens")) {
      return options.projectToken
        ? [{ device_id: "device-1", project_id: "folder-1", account_id: "account-1", device_kind: "user" }]
        : [];
    }
    if (text.includes("FROM account_devices")) {
      return options.accountDevice
        ? [{ account_device_id: options.accountDevice.deviceId, account_id: options.accountDevice.accountId, email: options.accountDevice.email }]
        : [];
    }
    if (text.includes("FROM service_credentials sc JOIN accounts")) {
      return options.service ? [options.service] : [];
    }
    if (text.includes("FROM sessions")) {
      return options.session ? [{ accountId: options.session.accountId, email: options.session.email }] : [];
    }
    return [];
  };
  const tagged = query as unknown as Sql;
  tagged.json = ((value: unknown) => value) as Sql["json"];
  return tagged;
}

function request(headers: Record<string, string>): Context {
  const lowered = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    req: {
      header: (name: string) => lowered[name.toLowerCase()],
      method: "GET",
      path: "/api/projects/folder-1/saves",
    },
  } as unknown as Context;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

const serviceKey = (overrides: Partial<NonNullable<FakeOptions["service"]>> = {}) => ({
  credentialId: "cred-1",
  accountId: "account-1",
  email: "owner@example.com",
  name: "Instinct",
  scopes: ["read:folders"],
  projectId: null,
  ...overrides,
});

test("a scoped key passes only the routes its scopes cover", async () => {
  const { externalCaller } = makePrincipals(fakeSql({ service: serviceKey({ scopes: ["read:folders", "read:files"] }) }));
  const c = request(bearer("gfx_key"));

  assert.equal((await externalCaller(c, "read:folders", "folder-1"))?.kind, "service");
  assert.equal((await externalCaller(c, "read:files", "folder-1"))?.kind, "service");
  assert.equal(await externalCaller(c, "write:proposals", "folder-1"), null);
  assert.equal(await externalCaller(c, "git:read", "folder-1"), null);
  assert.equal(await externalCaller(c, "git:write", "folder-1"), null);
});

test("a key bound to one folder cannot reach another", async () => {
  const { externalCaller } = makePrincipals(fakeSql({
    service: serviceKey({ scopes: ["read:folders", "git:write"], projectId: "folder-1" }),
  }));
  const c = request(bearer("gfx_key"));

  assert.equal((await externalCaller(c, "read:folders", "folder-1"))?.kind, "service");
  assert.equal(await externalCaller(c, "read:folders", "folder-2"), null);
  assert.equal(await externalCaller(c, "git:write", "folder-2"), null);
});

test("a revoked or unknown key never becomes a caller", async () => {
  const { externalCaller } = makePrincipals(fakeSql({ service: null }));
  assert.equal(await externalCaller(request(bearer("gfx_gone")), "read:folders", "folder-1"), null);
});

test("an account approval still reaches everything, as before", async () => {
  const { externalCaller } = makePrincipals(fakeSql({
    accountDevice: { accountId: "account-1", email: "owner@example.com", deviceId: "device-9" },
  }));
  const c = request(bearer("gfa_account"));
  for (const scope of ["read:folders", "read:files", "write:proposals", "git:read", "git:write"] as const) {
    const caller = await externalCaller(c, scope, "folder-1");
    assert.equal(caller?.kind, "account");
  }
});

test("a folder's own credential is not an external caller", async () => {
  const { externalCaller } = makePrincipals(fakeSql({ projectToken: true }));
  assert.equal(await externalCaller(request(bearer("folder-token")), "read:folders", "folder-1"), null);
});

test("a browser session works without any bearer", async () => {
  const { externalCaller } = makePrincipals(fakeSql({
    session: { accountId: "account-1", email: "owner@example.com" },
  }));
  const c = request({ Cookie: "gf_session=abcdefghijklmnopqrstuvwx" });
  const caller = await externalCaller(c, "read:folders", "folder-1");
  assert.equal(caller?.kind, "account");
});

test("no credential at all is refused", async () => {
  const { externalCaller } = makePrincipals(fakeSql());
  assert.equal(await externalCaller(request({}), "read:folders", "folder-1"), null);
});
