import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  DECIMAL_GB,
  PLANS,
  calculateOverage,
  createStripeClient,
  deriveEntitlement,
  loadBillingConfig,
  verifyStripeWebhook,
} from "./billing.ts";
import { normalizeGiteaRepositorySize } from "./adapter.ts";

const now = new Date("2026-08-30T12:00:00.000Z");

test("billing is disabled and unlimited by default", () => {
  assert.deepEqual(loadBillingConfig({}), { mode: "disabled", enforcement: "observe" });
  const access = deriveEntitlement({ billingMode: "disabled", enforcement: "observe", usageBytes: 900 * DECIMAL_GB });
  assert.equal(access.status, "self_hosted");
  assert.equal(access.canWrite, true);
  assert.equal(access.authorizedBytes, null);
});

test("Stripe mode fails closed when provider settings are missing", () => {
  assert.throws(() => loadBillingConfig({ BILLING_MODE: "stripe" }), /STRIPE_API_KEY/);
  assert.deepEqual(loadBillingConfig({ BILLING_MODE: "stripe", BILLING_ENFORCEMENT: "enforce" }, false), {
    mode: "stripe",
    enforcement: "enforce",
  });
});

test("trial has 10 GB and no overage, regardless of the chosen plan", () => {
  const access = deriveEntitlement({
    billingMode: "stripe", enforcement: "enforce", status: "trialing", planCode: "studio", now,
    trialEndsAt: new Date("2026-09-01T12:00:00Z"), overageCapCents: 2_000,
    usageBytes: 10 * DECIMAL_GB,
  });
  assert.equal(access.authorizedBytes, 10 * DECIMAL_GB);
  assert.equal(access.canWrite, false);
  assert.equal(access.reason, "quota-exceeded");
});

test("a $20 ceiling authorizes 300 GB on Plus", () => {
  const access = deriveEntitlement({
    billingMode: "stripe", enforcement: "enforce", status: "active", now,
    overageCapCents: 2_000, usageBytes: 299 * DECIMAL_GB,
  });
  assert.equal(access.planCode, "plus");
  assert.equal(access.authorizedBytes, 300 * DECIMAL_GB);
  assert.equal(access.canWrite, true);
});

test("plans differ in included bytes and overage rate", () => {
  assert.equal(PLANS.starter.includedBytes, 25 * DECIMAL_GB);
  assert.equal(PLANS.plus.includedBytes, 100 * DECIMAL_GB);
  assert.equal(PLANS.studio.includedBytes, 300 * DECIMAL_GB);
  assert.equal(PLANS.studio.overageCentsPerGbMonth, 8);

  // Studio's cheaper overage rate buys more extra capacity for the same cap.
  const studio = deriveEntitlement({
    billingMode: "stripe", enforcement: "enforce", status: "active", planCode: "studio", now,
    overageCapCents: 2_000, usageBytes: 0,
  });
  assert.equal(studio.authorizedBytes, (300 + 250) * DECIMAL_GB);
});

test("past-due grace becomes read-only without deleting access", () => {
  const grace = deriveEntitlement({
    billingMode: "stripe", enforcement: "enforce", status: "past_due", now,
    writeAccessEndsAt: new Date("2026-08-31T12:00:00Z"),
    retentionEndsAt: new Date("2026-09-30T12:00:00Z"),
  });
  assert.equal(grace.canWrite, true);
  const readOnly = deriveEntitlement({
    billingMode: "stripe", enforcement: "enforce", status: "past_due", now,
    writeAccessEndsAt: new Date("2026-08-29T12:00:00Z"),
    retentionEndsAt: new Date("2026-09-30T12:00:00Z"),
  });
  assert.equal(readOnly.access, "read_only");
  assert.equal(readOnly.reason, "read-only");
});

test("observation mode reports the decision without refusing the write", () => {
  const access = deriveEntitlement({ billingMode: "stripe", enforcement: "observe", status: "none", now });
  assert.equal(access.canWrite, true);
  assert.equal(access.reason, null);
  assert.equal(access.observedReason, "subscription-required");
});

test("enforced Hosted access refuses an account without a trial or subscription", () => {
  const access = deriveEntitlement({ billingMode: "stripe", enforcement: "enforce", status: "none", now });
  assert.equal(access.canWrite, false);
  assert.equal(access.reason, "subscription-required");
  assert.equal(access.observedReason, "subscription-required");
});

test("an active full-access override wins over subscription state", () => {
  const access = deriveEntitlement({
    billingMode: "stripe", enforcement: "enforce", status: "none", now,
    overrideMode: "full", overrideExpiresAt: new Date("2026-09-30T12:00:00Z"),
  });
  assert.equal(access.canWrite, true);
  assert.equal(access.access, "full");
});

test("overage integrates excess bytes over the billing period", () => {
  const start = new Date("2026-08-01T00:00:00Z");
  const end = new Date("2026-08-31T00:00:00Z");
  const result = calculateOverage([
    { at: start, totalBytes: 100 * DECIMAL_GB },
    { at: new Date("2026-08-16T00:00:00Z"), totalBytes: 200 * DECIMAL_GB },
  ], start, end, 2_000);
  assert.equal(result.excessGbMonth, 50);
  assert.equal(result.amountCents, 500);
});

test("overage never exceeds the customer ceiling", () => {
  const start = new Date("2026-08-01T00:00:00Z");
  const end = new Date("2026-09-01T00:00:00Z");
  const result = calculateOverage([{ at: start, totalBytes: 1_100 * DECIMAL_GB }], start, end, 2_000);
  assert.equal(result.amountCents, 2_000);
});

test("overage is computed against the account's own plan", () => {
  const start = new Date("2026-08-01T00:00:00Z");
  const end = new Date("2026-09-01T00:00:00Z");
  // Studio includes 300 GB and overages at 8c/GB-month, not Plus's 100 GB / 10c.
  const result = calculateOverage([{ at: start, totalBytes: 400 * DECIMAL_GB }], start, end, 2_000, "studio");
  assert.equal(result.excessGbMonth, 100);
  assert.equal(result.amountCents, 800);
});

test("Stripe webhook signatures use the raw body and reject stale requests", () => {
  const client = createStripeClient("sk_test_dummy");
  const raw = '{"id":"evt_1","type":"customer.subscription.updated"}';
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = "whsec_test";
  const sign = (ts: number) => createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");

  const event = verifyStripeWebhook(client, raw, `t=${timestamp},v1=${sign(timestamp)}`, secret);
  assert.equal(event.id, "evt_1");
  assert.throws(() => verifyStripeWebhook(client, `${raw} `, `t=${timestamp},v1=${sign(timestamp)}`, secret));

  const staleTimestamp = timestamp - 400;
  assert.throws(() => verifyStripeWebhook(client, raw, `t=${staleTimestamp},v1=${sign(staleTimestamp)}`, secret));
});

test("Gitea repository sizes normalize from KiB to bytes", () => {
  assert.equal(normalizeGiteaRepositorySize(1.5), 1536);
  assert.equal(normalizeGiteaRepositorySize("bad"), 0);
});
