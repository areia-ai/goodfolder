import Stripe from "stripe";
import type { Sql } from "./config.ts";

export const DECIMAL_GB = 1_000_000_000;
export const TRIAL_INCLUDED_BYTES = 10 * DECIMAL_GB;
export const DEFAULT_OVERAGE_CAP_CENTS = 2_000;
export const MAX_OVERAGE_CAP_CENTS = 10_000;

export type PlanCode = "starter" | "plus" | "studio";
export const PLAN_CODES: PlanCode[] = ["starter", "plus", "studio"];
export const DEFAULT_PLAN: PlanCode = "plus";

export function isPlanCode(value: unknown): value is PlanCode {
  return value === "starter" || value === "plus" || value === "studio";
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  includedBytes: number;
  overageCentsPerGbMonth: number;
  monthlyPriceCents: number;
  annualPriceCents: number;
}

/**
 * Prices anchor around Plus: Starter and Studio exist as much to make Plus
 * look like the reasonable middle choice as to be bought themselves.
 * Annual prices are 20% off the monthly rate x12, the current SaaS norm.
 */
export const PLANS: Record<PlanCode, PlanDefinition> = {
  starter: {
    code: "starter", name: "Starter",
    includedBytes: 25 * DECIMAL_GB, overageCentsPerGbMonth: 10,
    monthlyPriceCents: 1_500, annualPriceCents: 14_400,
  },
  plus: {
    code: "plus", name: "Plus",
    includedBytes: 100 * DECIMAL_GB, overageCentsPerGbMonth: 10,
    monthlyPriceCents: 2_900, annualPriceCents: 27_800,
  },
  studio: {
    code: "studio", name: "Studio",
    includedBytes: 300 * DECIMAL_GB, overageCentsPerGbMonth: 8,
    monthlyPriceCents: 7_900, annualPriceCents: 75_800,
  },
};

export type BillingMode = "disabled" | "stripe";
export type BillingEnforcement = "observe" | "enforce";
export type BillingStatus = "none" | "trialing" | "active" | "past_due" | "canceled" | "paused";
export type BillingInterval = "month" | "year";
export type AccessReason = "subscription-required" | "read-only" | "quota-exceeded" | null;

export interface StripePlanPrices {
  /** Flat recurring price id for the monthly interval. */
  month: string;
  /** Flat recurring price id for the annual interval. */
  year: string;
  /** Metered price id (per-unit, one unit = one GB-month of overage). */
  overage: string;
}

export interface BillingConfig {
  mode: BillingMode;
  enforcement: BillingEnforcement;
  stripe?: {
    apiKey: string;
    webhookSecret: string;
    /** event_name configured on the Stripe Billing Meter for overage. */
    meterEventName: string;
    checkoutSuccessUrl: string;
    portalReturnUrl: string;
    prices: Record<PlanCode, StripePlanPrices>;
    apiBase: string;
  };
}

export function loadBillingConfig(env: NodeJS.ProcessEnv = process.env, requireProvider = true): BillingConfig {
  const rawMode = env.BILLING_MODE ?? "disabled";
  if (rawMode !== "disabled" && rawMode !== "stripe") {
    throw new Error("BILLING_MODE must be disabled or stripe");
  }
  const enforcement = env.BILLING_ENFORCEMENT === "enforce" ? "enforce" : "observe";
  if (rawMode === "disabled") return { mode: "disabled", enforcement: "observe" };
  if (!requireProvider) return { mode: "stripe", enforcement };

  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing env ${name} while BILLING_MODE=stripe`);
    return value;
  };
  const pricesFor = (plan: PlanCode): StripePlanPrices => {
    const prefix = plan.toUpperCase();
    return {
      month: required(`STRIPE_PRICE_${prefix}_MONTH`),
      year: required(`STRIPE_PRICE_${prefix}_YEAR`),
      overage: required(`STRIPE_OVERAGE_PRICE_${prefix}`),
    };
  };
  return {
    mode: "stripe",
    enforcement,
    stripe: {
      apiKey: required("STRIPE_API_KEY"),
      webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
      meterEventName: required("STRIPE_METER_EVENT_NAME"),
      checkoutSuccessUrl: required("STRIPE_CHECKOUT_SUCCESS_URL"),
      portalReturnUrl: required("STRIPE_PORTAL_RETURN_URL"),
      prices: { starter: pricesFor("starter"), plus: pricesFor("plus"), studio: pricesFor("studio") },
      apiBase: env.STRIPE_API_BASE?.trim() || "https://api.stripe.com",
    },
  };
}

export function createStripeClient(apiKey: string): Stripe {
  return new Stripe(apiKey, { timeout: 15_000 });
}

/** Verifies and parses a Stripe webhook. Throws on a bad or stale signature. */
export function verifyStripeWebhook(client: Stripe, rawBody: string, header: string | undefined, secret: string): Stripe.Event {
  if (!header) throw new Error("missing signature");
  return client.webhooks.constructEvent(rawBody, header, secret);
}

export interface EntitlementInput {
  billingMode: BillingMode;
  enforcement: BillingEnforcement;
  status?: BillingStatus | undefined;
  planCode?: PlanCode | undefined;
  trialEndsAt?: Date | null | undefined;
  currentPeriodEnd?: Date | null | undefined;
  writeAccessEndsAt?: Date | null | undefined;
  retentionEndsAt?: Date | null | undefined;
  overageCapCents?: number | undefined;
  usageBytes?: number | undefined;
  reservedBytes?: number | undefined;
  overrideMode?: "full" | "read_only" | null | undefined;
  overrideExpiresAt?: Date | null | undefined;
  now?: Date | undefined;
}

export interface Entitlement {
  billingMode: BillingMode;
  enforcement: BillingEnforcement;
  status: BillingStatus | "self_hosted" | "expired";
  planCode: PlanCode | null;
  access: "full" | "read_only" | "expired";
  canWrite: boolean;
  reason: AccessReason;
  observedReason: AccessReason;
  includedBytes: number | null;
  authorizedBytes: number | null;
  usageBytes: number;
  reservedBytes: number;
  overageCapCents: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  writeAccessEndsAt: string | null;
  retentionEndsAt: string | null;
}

const iso = (value?: Date | null): string | null => value ? value.toISOString() : null;
const alive = (value: Date | null | undefined, now: Date): boolean => !value || value.getTime() > now.getTime();

export function deriveEntitlement(input: EntitlementInput): Entitlement {
  const now = input.now ?? new Date();
  const usageBytes = Math.max(0, Math.floor(input.usageBytes ?? 0));
  const reservedBytes = Math.max(0, Math.floor(input.reservedBytes ?? 0));
  const cap = Math.max(0, Math.min(MAX_OVERAGE_CAP_CENTS, Math.floor(input.overageCapCents ?? 0)));
  if (input.billingMode === "disabled") {
    return {
      billingMode: "disabled", enforcement: "observe", status: "self_hosted", planCode: null, access: "full",
      canWrite: true, reason: null, observedReason: null, includedBytes: null, authorizedBytes: null,
      usageBytes, reservedBytes, overageCapCents: 0, trialEndsAt: null, currentPeriodEnd: null,
      writeAccessEndsAt: null, retentionEndsAt: null,
    };
  }

  const plan = PLANS[input.planCode ?? DEFAULT_PLAN];
  const overrideActive = input.overrideMode && alive(input.overrideExpiresAt, now);
  const status = input.status ?? "none";
  const includedBytes = status === "trialing" ? TRIAL_INCLUDED_BYTES : plan.includedBytes;
  const authorizedBytes = includedBytes + (status === "trialing" ? 0 : (cap / plan.overageCentsPerGbMonth) * DECIMAL_GB);
  let access: Entitlement["access"] = "read_only";
  let reason: AccessReason = "subscription-required";

  if (overrideActive) {
    access = input.overrideMode === "full" ? "full" : "read_only";
    reason = input.overrideMode === "full" ? null : "read-only";
  } else if (status === "trialing") {
    if (input.trialEndsAt && input.trialEndsAt.getTime() <= now.getTime()) {
      access = alive(input.retentionEndsAt, now) ? "read_only" : "expired";
      reason = "read-only";
    } else {
      access = "full";
      reason = null;
    }
  } else if (status === "active") {
    access = "full";
    reason = null;
  } else if (status === "past_due") {
    if (alive(input.writeAccessEndsAt, now)) {
      access = "full";
      reason = null;
    } else {
      access = alive(input.retentionEndsAt, now) ? "read_only" : "expired";
      reason = "read-only";
    }
  } else if (status === "canceled") {
    if (input.currentPeriodEnd && input.currentPeriodEnd.getTime() > now.getTime()) {
      access = "full";
      reason = null;
    } else {
      access = alive(input.retentionEndsAt, now) ? "read_only" : "expired";
      reason = "read-only";
    }
  } else if (status === "paused") {
    access = alive(input.retentionEndsAt, now) ? "read_only" : "expired";
    reason = "read-only";
  }

  if (access === "full" && usageBytes + reservedBytes >= authorizedBytes) {
    reason = "quota-exceeded";
  }
  const observedReason = reason;
  const canWrite = input.enforcement === "observe" || (access === "full" && reason === null);
  return {
    billingMode: "stripe", enforcement: input.enforcement,
    status: access === "expired" ? "expired" : status, planCode: plan.code, access, canWrite,
    reason: canWrite ? null : reason, observedReason,
    includedBytes, authorizedBytes, usageBytes, reservedBytes, overageCapCents: cap,
    trialEndsAt: iso(input.trialEndsAt), currentPeriodEnd: iso(input.currentPeriodEnd),
    writeAccessEndsAt: iso(input.writeAccessEndsAt), retentionEndsAt: iso(input.retentionEndsAt),
  };
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function accountEntitlement(
  sql: Sql,
  config: BillingConfig,
  accountId: string,
  now = new Date(),
): Promise<Entitlement> {
  if (config.mode === "disabled") return deriveEntitlement({ billingMode: "disabled", enforcement: "observe" });
  const rows = await sql`
    SELECT b.status, b.plan_code AS "planCode", b.trial_ends_at AS "trialEndsAt",
           b.current_period_end AS "currentPeriodEnd",
           b.write_access_ends_at AS "writeAccessEndsAt",
           b.retention_ends_at AS "retentionEndsAt",
           COALESCE(b.overage_cap_cents, 0)::int AS "overageCapCents",
           COALESCE((SELECT SUM(p.repository_bytes) FROM projects p WHERE p.account_id = ${accountId}), 0)::bigint AS "repositoryBytes",
           COALESCE((SELECT SUM(o.confirmed_bytes) FROM stored_objects o JOIN projects p ON p.id = o.project_id WHERE p.account_id = ${accountId} AND o.state = 'confirmed'), 0)::bigint AS "objectBytes",
           COALESCE((SELECT SUM(o.declared_bytes) FROM stored_objects o JOIN projects p ON p.id = o.project_id WHERE p.account_id = ${accountId} AND o.state = 'reserved' AND o.reservation_expires_at > now()), 0)::bigint AS "reservedBytes",
           ov.mode AS "overrideMode", ov.expires_at AS "overrideExpiresAt"
    FROM accounts a
    LEFT JOIN account_billing b ON b.account_id = a.id
    LEFT JOIN LATERAL (
      SELECT mode, expires_at FROM account_access_overrides
      WHERE account_id = a.id AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC LIMIT 1
    ) ov ON true
    WHERE a.id = ${accountId}
    LIMIT 1`;
  const row = rows[0];
  if (!row) return deriveEntitlement({ billingMode: "stripe", enforcement: config.enforcement });
  return deriveEntitlement({
    billingMode: "stripe", enforcement: config.enforcement,
    status: (row.status ?? "none") as BillingStatus,
    planCode: isPlanCode(row.planCode) ? row.planCode : DEFAULT_PLAN,
    trialEndsAt: asDate(row.trialEndsAt), currentPeriodEnd: asDate(row.currentPeriodEnd),
    writeAccessEndsAt: asDate(row.writeAccessEndsAt), retentionEndsAt: asDate(row.retentionEndsAt),
    overageCapCents: Number(row.overageCapCents ?? 0),
    usageBytes: Number(row.repositoryBytes ?? 0) + Number(row.objectBytes ?? 0),
    reservedBytes: Number(row.reservedBytes ?? 0),
    overrideMode: row.overrideMode as "full" | "read_only" | null,
    overrideExpiresAt: asDate(row.overrideExpiresAt), now,
  });
}

export async function projectOwnerAccountId(sql: Sql, projectId: string): Promise<string | null> {
  const rows = await sql`SELECT account_id AS "accountId" FROM projects WHERE id = ${projectId} LIMIT 1`;
  return rows[0]?.accountId ? String(rows[0].accountId) : null;
}

export async function projectEntitlement(sql: Sql, config: BillingConfig, projectId: string): Promise<Entitlement | null> {
  const accountId = await projectOwnerAccountId(sql, projectId);
  return accountId ? accountEntitlement(sql, config, accountId) : null;
}

export interface UsagePoint { at: Date; totalBytes: number }

export function calculateOverage(
  samples: UsagePoint[],
  periodStart: Date,
  periodEnd: Date,
  overageCapCents: number,
  planCode: PlanCode = DEFAULT_PLAN,
): { excessGbMonth: number; amountCents: number } {
  const plan = PLANS[planCode];
  const start = periodStart.getTime();
  const end = periodEnd.getTime();
  if (!(end > start)) return { excessGbMonth: 0, amountCents: 0 };
  const sorted = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  let current = 0;
  for (const point of sorted) if (point.at.getTime() <= start) current = point.totalBytes;
  let cursor = start;
  let byteMillis = 0;
  const addUntil = (until: number) => {
    const bounded = Math.max(cursor, Math.min(end, until));
    byteMillis += Math.max(0, current - plan.includedBytes) * (bounded - cursor);
    cursor = bounded;
  };
  for (const point of sorted) {
    const at = point.at.getTime();
    if (at <= start || at >= end) continue;
    addUntil(at);
    current = Math.max(0, point.totalBytes);
  }
  addUntil(end);
  const raw = byteMillis / DECIMAL_GB / (end - start);
  const excessGbMonth = Math.round(raw * 100) / 100;
  const amountCents = Math.min(Math.max(0, overageCapCents), Math.round(excessGbMonth * plan.overageCentsPerGbMonth));
  return { excessGbMonth, amountCents };
}
