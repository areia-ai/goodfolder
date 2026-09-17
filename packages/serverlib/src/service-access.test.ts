import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SERVICE_SCOPES,
  SERVICE_SCOPE_LABELS,
  isServiceScope,
  parseServiceScopes,
  serviceAllows,
  type ServiceScope,
} from "./service-access.ts";

test("the scope catalog is exactly the five approved names", () => {
  assert.deepEqual([...SERVICE_SCOPES], [
    "read:folders",
    "read:files",
    "write:proposals",
    "git:read",
    "git:write",
  ]);
  for (const scope of SERVICE_SCOPES) assert.equal(isServiceScope(scope), true);
  for (const scope of SERVICE_SCOPE_LABELS) assert.equal(SERVICE_SCOPES.includes(scope.scope), true);
  assert.equal(SERVICE_SCOPE_LABELS.length, SERVICE_SCOPES.length);
});

test("a scope list refuses unknown names instead of dropping them", () => {
  assert.deepEqual(parseServiceScopes(["read:files", "git:write"]), ["read:files", "git:write"]);
  // Order always follows the catalog, and repeats collapse.
  assert.deepEqual(parseServiceScopes(["git:write", "read:files", "git:write"]), ["read:files", "git:write"]);
  assert.equal(parseServiceScopes(["read:folders", "admin:everything"]), null);
  assert.equal(parseServiceScopes(["git"]), null);
  assert.equal(parseServiceScopes([]), null);
  assert.equal(parseServiceScopes("read:files"), null);
  assert.equal(parseServiceScopes(null), null);
});

test("a key only carries the scopes it was approved for", () => {
  const key = { scopes: ["read:folders", "read:files"] as ServiceScope[], projectId: null };
  assert.equal(serviceAllows(key, "read:folders"), true);
  assert.equal(serviceAllows(key, "read:files"), true);
  assert.equal(serviceAllows(key, "write:proposals"), false);
  assert.equal(serviceAllows(key, "git:read"), false);
  assert.equal(serviceAllows(key, "git:write"), false);
});

test("a key bound to one folder is refused everywhere else", () => {
  const key = { scopes: ["read:folders", "git:write"] as ServiceScope[], projectId: "folder-a" };
  assert.equal(serviceAllows(key, "read:folders", "folder-a"), true);
  assert.equal(serviceAllows(key, "git:write", "folder-a"), true);
  assert.equal(serviceAllows(key, "git:write", "folder-b"), false);
  // A route that names no folder can still be reached by a bound key; the
  // route itself narrows the answer to the bound folder.
  assert.equal(serviceAllows(key, "read:folders"), true);
});

test("an account-wide key is still limited by its scopes", () => {
  const key = { scopes: ["git:read"] as ServiceScope[], projectId: null };
  assert.equal(serviceAllows(key, "git:read", "any-folder"), true);
  assert.equal(serviceAllows(key, "git:write", "any-folder"), false);
});
