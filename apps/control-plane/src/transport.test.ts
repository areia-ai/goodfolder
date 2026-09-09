import assert from "node:assert/strict";
import { test } from "node:test";
import { transportRoute } from "./transport.ts";

const PROJECT = "7f7ee58f-9106-4573-ba8e-7c125056f66f";
const route = (path: string) => transportRoute(new URL(path, "http://api.test"));

test("the three smart HTTP endpoints pass, and only they", () => {
  assert.deepEqual(route(`/git/${PROJECT}/info/refs?service=git-upload-pack`), {
    projectId: PROJECT, subpath: "/info/refs", isWrite: false,
  });
  assert.deepEqual(route(`/git/${PROJECT}/info/refs?service=git-receive-pack`), {
    projectId: PROJECT, subpath: "/info/refs", isWrite: true,
  });
  assert.equal(route(`/git/${PROJECT}/git-upload-pack`)?.isWrite, false);
  assert.equal(route(`/git/${PROJECT}/git-receive-pack`)?.isWrite, true);
});

test("the engine's own pages under the project path are refused", () => {
  for (const path of [
    `/git/${PROJECT}/settings`,
    `/git/${PROJECT}/settings/delete`,
    `/git/${PROJECT}/raw/branch/main/notes.md`,
    `/git/${PROJECT}/_edit/main/notes.md`,
    `/git/${PROJECT}/info/lfs/objects/batch`,
    `/git/${PROJECT}/HEAD`,
    `/git/${PROJECT}/objects/info/packs`,
    `/git/${PROJECT}/info/refs/extra`,
    `/git/${PROJECT}/info/refs?service=something-else`,
  ]) {
    assert.equal(route(path), null, path);
  }
});

test("a path that is not a project is refused", () => {
  assert.equal(route("/git/not-a-project/info/refs"), null);
  assert.equal(route(`/git/${PROJECT}`), null);
  assert.equal(route(`/git/${PROJECT}/`), null);
  assert.equal(route(`/api/projects`), null);
});

test("dot segments cannot escape the project path", () => {
  // The URL parser folds these before the route is read; what is left must
  // still be one of the three endpoints or nothing.
  assert.equal(route(`/git/${PROJECT}/../../api/v1/admin/users`), null);
  assert.equal(route(`/git/${PROJECT}/info/../info/refs`)?.subpath, "/info/refs");
});
