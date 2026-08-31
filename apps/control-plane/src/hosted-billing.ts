import type Stripe from "stripe";
import {
  ListObjectsV2Command,
  DeleteObjectsCommand,
  accountEntitlement,
  calculateOverage,
  createStripeClient,
  isPlanCode,
  verifyStripeWebhook,
  DEFAULT_PLAN,
  type BillingConfig,
  type BillingStatus,
  type Entitlement,
  type PlanCode,
  type RepositoryAdapter,
  type S3Client,
  type Sql,
} from "@goodfolder/serverlib";

const dateOrNull = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000);

/** Reads the flat-rate subscription item's period, not the (possibly absent) top-level one. */
function subscriptionPeriod(subscription: Stripe.Subscription, planCode: PlanCode, config: BillingConfig): { start: Date | null; end: Date | null } {
  const flatPriceIds = new Set(Object.values(config.stripe?.prices[planCode] ?? {}));
  const item = subscription.items.data.find((i: Stripe.SubscriptionItem) => flatPriceIds.has(i.price.id))
    ?? subscription.items.data[0];
  return {
    start: item ? new Date(item.current_period_start * 1000) : null,
    end: item ? new Date(item.current_period_end * 1000) : null,
  };
}

function planCodeFromSubscription(subscription: Stripe.Subscription, config: BillingConfig): PlanCode {
  for (const item of subscription.items.data) {
    for (const [plan, prices] of Object.entries(config.stripe?.prices ?? {})) {
      if (prices.month === item.price.id || prices.year === item.price.id) return plan as PlanCode;
    }
  }
  return DEFAULT_PLAN;
}

export class HostedBilling {
  private stripe: Stripe | null;

  constructor(
    private sql: Sql,
    private config: BillingConfig,
    private repos: RepositoryAdapter,
    private storage: S3Client,
    private bucket: string,
  ) {
    this.stripe = config.stripe ? createStripeClient(config.stripe.apiKey) : null;
  }

  entitlement(accountId: string): Promise<Entitlement> {
    return accountEntitlement(this.sql, this.config, accountId);
  }

  async plan(accountId: string): Promise<Entitlement & { accruedOverageCents: number; accruedExcessGbMonth: number }> {
    const entitlement = await this.entitlement(accountId);
    const accrued = await this.accruedOverage(accountId);
    return { ...entitlement, accruedOverageCents: accrued.amountCents, accruedExcessGbMonth: accrued.excessGbMonth };
  }

  async createCheckout(
    accountId: string, email: string, planCode: PlanCode, interval: "month" | "year",
  ): Promise<{ url: string }> {
    if (!this.stripe || !this.config.stripe) throw new Error("billing-unavailable");
    if (!isPlanCode(planCode)) throw new Error("invalid-plan");
    const current = await this.sql`
      SELECT status FROM account_billing WHERE account_id = ${accountId} LIMIT 1`;
    if (["trialing", "active", "past_due"].includes(String(current[0]?.status ?? ""))) {
      throw new Error("subscription-active");
    }
    // The customer is made here rather than left to Checkout. A setup-mode
    // session opened with only `customer_email` completes with `customer`
    // still null, and the webhook that finishes the subscription has nothing
    // to attach the card to — the person pays, sees the success page, and
    // gets no trial. Reuse the one this account already has if there is one.
    const known = await this.sql`
      SELECT provider_customer_id AS "customerId" FROM account_billing
      WHERE account_id = ${accountId} LIMIT 1`;
    const customerId = known[0]?.customerId
      ? String(known[0].customerId)
      : (await this.stripe.customers.create({
          email,
          metadata: { goodfolder_account_id: accountId },
        })).id;

    // Mixed-interval subscriptions (annual flat fee + monthly metered overage)
    // can't be created through Checkout, so Checkout only collects the
    // payment method here; the webhook finishes creating the subscription.
    const session = await this.stripe.checkout.sessions.create({
      mode: "setup",
      // Setup mode has no line items to imply one, and Stripe refuses the
      // session without it. GoodFolder Hosted is priced in USD everywhere.
      currency: "usd",
      customer: customerId,
      success_url: this.config.stripe.checkoutSuccessUrl,
      metadata: { goodfolder_account_id: accountId, plan_code: planCode, interval },
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return { url: session.url };
  }

  async createPortal(accountId: string): Promise<{ url: string }> {
    if (!this.stripe || !this.config.stripe) throw new Error("billing-unavailable");
    const rows = await this.sql`
      SELECT provider_customer_id AS "customerId" FROM account_billing
      WHERE account_id = ${accountId} LIMIT 1`;
    const customerId = rows[0]?.customerId ? String(rows[0].customerId) : "";
    if (!customerId) throw new Error("subscription-required");
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: this.config.stripe.portalReturnUrl,
    });
    return { url: session.url };
  }

  async setOverageCap(accountId: string, capCents: number): Promise<Entitlement> {
    if (!Number.isInteger(capCents) || capCents < 0 || capCents > 10_000 || capCents % 1_000 !== 0) {
      throw new Error("overage-cap");
    }
    const updated = await this.sql`
      UPDATE account_billing SET overage_cap_cents = ${capCents}, updated_at = now()
      WHERE account_id = ${accountId} AND status IN ('active', 'past_due')
      RETURNING account_id`;
    if (!updated.length) throw new Error("subscription-required");
    await this.sql`
      INSERT INTO audit_log (actor, action, detail)
      SELECT email, 'billing.overage_cap', ${this.sql.json({ capCents })} FROM accounts WHERE id = ${accountId}`;
    return this.entitlement(accountId);
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): Stripe.Event {
    if (!this.stripe || !this.config.stripe) throw new Error("billing-unavailable");
    return verifyStripeWebhook(this.stripe, rawBody, signatureHeader, this.config.stripe.webhookSecret);
  }

  async applyWebhook(event: Stripe.Event): Promise<"processed" | "duplicate" | "ignored"> {
    if (!this.stripe || !this.config.stripe) throw new Error("billing-unavailable");
    const object = event.data.object as { id?: string; status?: string; customer?: string };
    const minimalPayload = { id: object.id ?? null, status: object.status ?? null, customer: object.customer ?? null };
    const inserted = await this.sql`
      INSERT INTO billing_events (event_id, event_type, occurred_at, payload)
      VALUES (${event.id}, ${event.type}, ${new Date(event.created * 1000)}, ${this.sql.json(minimalPayload)})
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
    if (!inserted.length) return "duplicate";

    if (event.type === "checkout.session.completed") {
      await this.finishCheckout(event.data.object as Stripe.Checkout.Session);
      await this.sql`UPDATE billing_events SET status = 'processed', processed_at = now() WHERE event_id = ${event.id}`;
      return "processed";
    }
    if (event.type.startsWith("customer.subscription.")) {
      await this.applySubscriptionEvent(event.data.object as Stripe.Subscription, new Date(event.created * 1000));
      await this.sql`UPDATE billing_events SET status = 'processed', processed_at = now() WHERE event_id = ${event.id}`;
      return "processed";
    }
    await this.sql`UPDATE billing_events SET status = 'ignored', processed_at = now() WHERE event_id = ${event.id}`;
    return "ignored";
  }

  /** Runs after Checkout (setup mode) collects a payment method: creates the real subscription via the API. */
  private async finishCheckout(session: Stripe.Checkout.Session): Promise<void> {
    if (!this.stripe || !this.config.stripe) return;
    if (session.mode !== "setup") return;
    // Every reason to stop here is said out loud. Someone has just handed over
    // a card and been shown a success page; a subscription that quietly never
    // gets made is the worst way for this to fail.
    const decline = (why: string) => {
      console.error(`Stripe checkout ${session.id} completed but no subscription was created: ${why}`);
    };
    const accountId = session.metadata?.goodfolder_account_id;
    const rawPlanCode = session.metadata?.plan_code;
    const rawInterval = session.metadata?.interval;
    if (!accountId) return decline("no account in the session metadata");
    if (!isPlanCode(rawPlanCode)) return decline(`unknown plan ${String(rawPlanCode)}`);
    if (rawInterval !== "month" && rawInterval !== "year") return decline(`unknown interval ${String(rawInterval)}`);
    const planCode = rawPlanCode;
    const interval = rawInterval;
    const customerId = String(session.customer ?? "");
    const setupIntentId = String(session.setup_intent ?? "");
    if (!customerId) return decline("the session carries no customer");
    if (!setupIntentId) return decline("the session carries no setup intent");
    const setupIntent = await this.stripe.setupIntents.retrieve(setupIntentId);
    const paymentMethod = String(setupIntent.payment_method ?? "");
    if (!paymentMethod) return;
    await this.stripe.paymentMethods.attach(paymentMethod, { customer: customerId });
    await this.stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethod } });
    const prices = this.config.stripe.prices[planCode];
    await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: prices[interval] }, { price: prices.overage }],
      trial_period_days: 7,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      default_payment_method: paymentMethod,
      metadata: { goodfolder_account_id: accountId, plan_code: planCode, interval },
    });
  }

  private async applySubscriptionEvent(subscription: Stripe.Subscription, occurredAt: Date): Promise<void> {
    const accountId = subscription.metadata?.goodfolder_account_id
      ?? (await this.sql`
        SELECT account_id AS "accountId" FROM account_billing
        WHERE provider_subscription_id = ${subscription.id} LIMIT 1`)[0]?.accountId;
    if (!accountId || !(await this.sql`SELECT id FROM accounts WHERE id = ${accountId} LIMIT 1`).length) return;

    const status = subscription.status as BillingStatus;
    if (!["trialing", "active", "past_due", "canceled", "paused"].includes(status)) return;
    const planCode = isPlanCode(subscription.metadata?.plan_code) ? subscription.metadata.plan_code as PlanCode
      : planCodeFromSubscription(subscription, this.config);
    const interval = subscription.metadata?.interval === "year" ? "year" : "month";
    const { start, end } = subscriptionPeriod(subscription, planCode, this.config);
    const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
    const existing = await this.sql`
      SELECT current_period_end AS "periodEnd" FROM account_billing WHERE account_id = ${accountId}`;
    const retainedPeriodEnd = end ?? dateOrNull(existing[0]?.periodEnd);
    const writeEnd = status === "past_due" ? addDays(occurredAt, 7) : null;
    const retentionBase = status === "canceled" ? (retainedPeriodEnd ?? occurredAt)
      : status === "past_due" ? addDays(occurredAt, 7)
      : status === "paused" ? occurredAt
      : null;
    const retentionEnd = retentionBase ? addDays(retentionBase, 30) : null;

    await this.sql`
      INSERT INTO account_billing (
        account_id, provider_customer_id, provider_subscription_id, plan_code, billing_interval, status,
        trial_ends_at, current_period_start, current_period_end,
        write_access_ends_at, retention_ends_at, last_provider_event_at, updated_at
      ) VALUES (
        ${String(accountId)}, ${String(subscription.customer)}, ${subscription.id}, ${planCode}, ${interval}, ${status},
        ${trialEnd}, ${start}, ${retainedPeriodEnd}, ${writeEnd}, ${retentionEnd}, ${occurredAt}, now()
      )
      ON CONFLICT (account_id) DO UPDATE SET
        provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, account_billing.provider_customer_id),
        provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, account_billing.provider_subscription_id),
        plan_code = EXCLUDED.plan_code,
        billing_interval = EXCLUDED.billing_interval,
        status = EXCLUDED.status,
        trial_ends_at = COALESCE(EXCLUDED.trial_ends_at, account_billing.trial_ends_at),
        current_period_start = COALESCE(EXCLUDED.current_period_start, account_billing.current_period_start),
        current_period_end = COALESCE(EXCLUDED.current_period_end, account_billing.current_period_end),
        write_access_ends_at = EXCLUDED.write_access_ends_at,
        retention_ends_at = EXCLUDED.retention_ends_at,
        last_provider_event_at = EXCLUDED.last_provider_event_at,
        updated_at = now()
      WHERE account_billing.last_provider_event_at IS NULL
         OR account_billing.last_provider_event_at <= EXCLUDED.last_provider_event_at`;
    if (start) {
      await this.sql`
        UPDATE usage_settlements SET status = 'charged', updated_at = now()
        WHERE account_id = ${String(accountId)} AND status = 'submitted' AND period_end <= ${start}`;
    }
  }

  async recordUsageSample(accountId: string, source: string): Promise<void> {
    const totals = await this.sql`
      SELECT COALESCE((SELECT SUM(repository_bytes) FROM projects WHERE account_id = ${accountId}), 0)::bigint AS "repositoryBytes",
             COALESCE((SELECT SUM(o.confirmed_bytes) FROM stored_objects o JOIN projects p ON p.id = o.project_id WHERE p.account_id = ${accountId} AND o.state = 'confirmed'), 0)::bigint AS "objectBytes"`;
    const repositoryBytes = Number(totals[0]?.repositoryBytes ?? 0);
    const objectBytes = Number(totals[0]?.objectBytes ?? 0);
    const totalBytes = repositoryBytes + objectBytes;
    const last = await this.sql`
      SELECT total_bytes AS "totalBytes" FROM usage_samples
      WHERE account_id = ${accountId} ORDER BY recorded_at DESC LIMIT 1`;
    if (Number(last[0]?.totalBytes ?? -1) === totalBytes) return;
    await this.sql`
      INSERT INTO usage_samples (account_id, repository_bytes, object_bytes, total_bytes, source)
      VALUES (${accountId}, ${repositoryBytes}, ${objectBytes}, ${totalBytes}, ${source})`;
  }

  async refreshProject(projectId: string, source = "save"): Promise<void> {
    const repositoryBytes = await this.repos.repositorySizeBytes(projectId);
    const owner = await this.sql`
      UPDATE projects SET repository_bytes = ${repositoryBytes}, usage_reconciled_at = now()
      WHERE id = ${projectId} RETURNING account_id AS "accountId"`;
    if (owner[0]?.accountId) await this.recordUsageSample(String(owner[0].accountId), source);
  }

  async reconcile(): Promise<boolean> {
    if (this.config.mode === "disabled") return false;
    const lock = await this.sql`SELECT pg_try_advisory_lock(694663) AS locked`;
    if (!lock[0]?.locked) return false;
    try {
      const projects = await this.sql`SELECT id FROM projects ORDER BY id`;
      for (const project of projects) await this.refreshProject(String(project.id), "daily-reconcile");

      let continuationToken: string | undefined;
      do {
        const page = await this.storage.send(new ListObjectsV2Command({
          Bucket: this.bucket,
          ContinuationToken: continuationToken,
        }));
        for (const object of page.Contents ?? []) {
          const match = /^([0-9a-f-]{36})\/([a-f0-9]{64})$/.exec(object.Key ?? "");
          if (!match || object.Size == null) continue;
          await this.sql`
            INSERT INTO stored_objects (project_id, oid, declared_bytes, confirmed_bytes, state, verified_at)
            SELECT ${match[1]!}, ${match[2]!}, ${object.Size}, ${object.Size}, 'confirmed', now()
            WHERE EXISTS (SELECT 1 FROM projects WHERE id = ${match[1]!})
            ON CONFLICT (project_id, oid) DO UPDATE SET confirmed_bytes = EXCLUDED.confirmed_bytes,
              declared_bytes = EXCLUDED.declared_bytes, state = 'confirmed', verified_at = now(),
              reservation_expires_at = NULL, updated_at = now()`;
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
      await this.sql`DELETE FROM stored_objects WHERE state = 'reserved' AND reservation_expires_at <= now()`;
      const accounts = await this.sql`SELECT id FROM accounts`;
      for (const account of accounts) await this.recordUsageSample(String(account.id), "daily-reconcile");
      return true;
    } finally {
      await this.sql`SELECT pg_advisory_unlock(694663)`;
    }
  }

  async accruedOverage(accountId: string): Promise<{ excessGbMonth: number; amountCents: number }> {
    const billing = await this.sql`
      SELECT current_period_start AS "start", current_period_end AS "end",
             overage_cap_cents AS "cap", plan_code AS "planCode"
      FROM account_billing WHERE account_id = ${accountId} LIMIT 1`;
    const row = billing[0];
    const start = dateOrNull(row?.start);
    const configuredEnd = dateOrNull(row?.end);
    if (!start || !configuredEnd) return { excessGbMonth: 0, amountCents: 0 };
    const end = new Date(Math.min(configuredEnd.getTime(), Date.now()));
    const samples = await this.sql`
      SELECT recorded_at AS "at", total_bytes AS "totalBytes" FROM usage_samples
      WHERE account_id = ${accountId} AND recorded_at <= ${end}
        AND recorded_at >= ${new Date(start.getTime() - 35 * 86_400_000)}
      ORDER BY recorded_at`;
    return calculateOverage(
      samples.map((sample) => ({ at: new Date(String(sample.at)), totalBytes: Number(sample.totalBytes) })),
      start, end, Number(row?.cap ?? 0),
      isPlanCode(row?.planCode) ? row.planCode : DEFAULT_PLAN,
    );
  }

  /**
   * Reports each active account's overage as a Stripe Billing Meter event
   * once per period. Stripe aggregates and invoices it at renewal — this
   * only has to report the net excess once, near the end of the period.
   */
  async settleUpcomingOverage(): Promise<number> {
    if (!this.stripe || !this.config.stripe || this.config.enforcement !== "enforce") return 0;
    const rows = await this.sql`
      SELECT account_id AS "accountId", provider_customer_id AS "customerId",
             current_period_start AS "start", current_period_end AS "end", overage_cap_cents AS "cap"
      FROM account_billing
      WHERE status = 'active' AND provider_subscription_id IS NOT NULL
        AND current_period_end BETWEEN now() + interval '31 minutes' AND now() + interval '91 minutes'`;
    let submitted = 0;
    for (const row of rows) {
      const accountId = String(row.accountId);
      const start = new Date(String(row.start));
      const end = new Date(String(row.end));
      const accrued = await this.accruedOverage(accountId);
      const settlementId = crypto.randomUUID();
      const claim = await this.sql`
        INSERT INTO usage_settlements (id, account_id, period_start, period_end, excess_gb_month, amount_cents, status)
        VALUES (${settlementId}, ${accountId}, ${start}, ${end}, ${accrued.excessGbMonth}, ${accrued.amountCents}, 'submitting')
        ON CONFLICT (account_id, period_start, period_end) DO NOTHING RETURNING id`;
      if (!claim.length) continue;
      if (accrued.excessGbMonth <= 0) {
        await this.sql`UPDATE usage_settlements SET status = 'void', updated_at = now() WHERE id = ${settlementId}`;
        continue;
      }
      try {
        await this.stripe.billing.meterEvents.create({
          event_name: this.config.stripe.meterEventName,
          identifier: settlementId,
          payload: { value: String(accrued.excessGbMonth), stripe_customer_id: String(row.customerId) },
        });
        await this.sql`UPDATE usage_settlements SET status = 'submitted', provider_event_id = ${settlementId}, updated_at = now() WHERE id = ${settlementId}`;
        submitted++;
      } catch (error) {
        await this.sql`UPDATE usage_settlements SET status = 'failed', updated_at = now() WHERE id = ${settlementId}`;
        console.error("overage settlement failed:", error);
      }
    }
    return submitted;
  }

  async deleteProtectedData(accountId: string): Promise<{ folders: number; objects: number }> {
    const projects = await this.sql`SELECT id FROM projects WHERE account_id = ${accountId} ORDER BY id`;
    let objects = 0;
    for (const project of projects) {
      const projectId = String(project.id);
      let continuationToken: string | undefined;
      do {
        const page = await this.storage.send(new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${projectId}/`,
          ContinuationToken: continuationToken,
        }));
        const keys = (page.Contents ?? []).flatMap((item) => item.Key ? [{ Key: item.Key }] : []);
        if (keys.length) {
          await this.storage.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
          objects += keys.length;
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
      await this.repos.deleteRepo(projectId);
    }
    await this.sql.begin(async (tx) => {
      for (const project of projects) {
        const projectId = String(project.id);
        await tx`DELETE FROM saves WHERE project_id = ${projectId}`;
        await tx`DELETE FROM transfer_tokens WHERE device_id IN (SELECT id FROM devices WHERE project_id = ${projectId})`;
        await tx`DELETE FROM devices WHERE project_id = ${projectId}`;
        await tx`DELETE FROM projects WHERE id = ${projectId}`;
      }
      await tx`INSERT INTO audit_log (actor, action, detail)
        SELECT email, 'retention.deleted', ${tx.json({ folders: projects.length, objects })}
        FROM accounts WHERE id = ${accountId}`;
    });
    await this.recordUsageSample(accountId, "retention-deletion");
    return { folders: projects.length, objects };
  }
}
