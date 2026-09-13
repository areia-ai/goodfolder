import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardLink } from "./links.ts";

function withWebUrl(value: string | undefined, fn: () => void) {
  const previous = process.env.WEB_URL;
  if (value === undefined) delete process.env.WEB_URL;
  else process.env.WEB_URL = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = previous;
  }
}

test("dashboardLink defaults to the hosted dashboard", () => {
  withWebUrl(undefined, () => {
    assert.equal(dashboardLink("?invite=abc"), "https://trygoodfolder.com/dashboard?invite=abc");
  });
});

test("dashboardLink honours WEB_URL and drops trailing slashes", () => {
  withWebUrl("http://localhost:4300/", () => {
    assert.equal(
      dashboardLink("?folder=p1&proposal=p2"),
      "http://localhost:4300/dashboard?folder=p1&proposal=p2",
    );
  });
});
