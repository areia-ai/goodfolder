import { test } from "node:test";
import assert from "node:assert/strict";
import { magicLinkEmail } from "./magic-link-email.ts";

test("both email alternatives preserve the one-time link and its lifetime", () => {
  const link = "https://example.test/auth/verify?t=sample&next=https%3A%2F%2Fexample.test%2Fdashboard";
  const email = magicLinkEmail(link, 15);
  assert.ok(email.text.includes(link));
  assert.equal((email.html.match(/href="https:\/\/example.test\/auth\/verify\?t=sample&amp;next=/g) ?? []).length, 2);
  for (const body of [email.html, email.text]) {
    assert.match(body, /15 minutes/);
    assert.match(body, /ignore this email/);
  }
});

test("URL content cannot inject markup into the email", () => {
  const email = magicLinkEmail('https://example.test/?t=<tag>"\'&x=1', 8);
  assert.ok(!email.html.includes("<tag>"));
  assert.ok(email.html.includes("&lt;tag&gt;&quot;&#39;&amp;x=1"));
  assert.match(email.html, /8 minutes/);
});
