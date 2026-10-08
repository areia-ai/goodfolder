import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { makeRateLimiter } from "./rate-limit.ts";

test("a key at its limit stays limited after 10,001 other keys arrive", () => {
  const rateLimit = makeRateLimiter();
  assert.equal(rateLimit("names", "victim", 2, 60_000), true);
  assert.equal(rateLimit("names", "victim", 2, 60_000), true);
  assert.equal(rateLimit("names", "victim", 2, 60_000), false);
  for (let i = 0; i < 10_001; i += 1) rateLimit("names", `junk-${i}`, 1, 60_000);
  // The old limiter wiped the whole bucket at 10k keys; a flood would lift
  // the limit on a caller that was actively being refused.
  assert.equal(rateLimit("names", "victim", 2, 60_000), false);
});

test("stale keys are the ones evicted when the bucket fills", () => {
  mock.timers.enable({ apis: ["Date"], now: 0 });
  try {
    const rateLimit = makeRateLimiter(2);
    rateLimit("names", "old", 5, 60_000); // hit at t=0
    mock.timers.tick(50_000);
    rateLimit("names", "live", 1, 60_000); // hit at t=50s
    mock.timers.tick(11_000); // t=61s — old's hit is stale, live's is not
    rateLimit("names", "new", 1, 60_000); // pushes the bucket over cap
    assert.equal(rateLimit("names", "new", 1, 60_000), false);
    // "old" was evicted as stale, so it is no longer recorded at all.
    assert.equal(rateLimit("names", "old", 5, 60_000), true);
    assert.equal(rateLimit("names", "live", 1, 60_000), false);
  } finally {
    mock.timers.reset();
  }
});

test("a full bucket never lifts an existing key's limit", () => {
  const rateLimit = makeRateLimiter(2);
  rateLimit("names", "a", 1, 60_000);
  rateLimit("names", "b", 1, 60_000);
  assert.equal(rateLimit("names", "a", 1, 60_000), false);
  // A new key while the bucket is full of fresh records passes untracked —
  // it is not allowed to push a recorded limit out.
  assert.equal(rateLimit("names", "c", 1, 60_000), true);
  assert.equal(rateLimit("names", "a", 1, 60_000), false);
  assert.equal(rateLimit("names", "b", 1, 60_000), false);
});
