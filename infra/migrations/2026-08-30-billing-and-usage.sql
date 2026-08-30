-- 2026-08-30 - hosted billing, protected-data accounting, and access states.
-- Additive. BILLING_MODE=disabled leaves self-hosted installations unlimited.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS repository_bytes BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_reconciled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS account_billing (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_customer_id TEXT UNIQUE,
  provider_subscription_id TEXT UNIQUE,
  plan_code TEXT NOT NULL DEFAULT 'plus' CHECK (plan_code IN ('starter', 'plus', 'studio')),
  billing_interval TEXT NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month', 'year')),
  status TEXT NOT NULL DEFAULT 'none'
    CHECK (status IN ('none', 'trialing', 'active', 'past_due', 'canceled', 'paused')),
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  write_access_ends_at TIMESTAMPTZ,
  retention_ends_at TIMESTAMPTZ,
  overage_cap_cents INTEGER NOT NULL DEFAULT 0
    CHECK (overage_cap_cents BETWEEN 0 AND 10000 AND overage_cap_cents % 1000 = 0),
  last_provider_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_access_overrides (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('full', 'read_only')),
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_access_overrides_current
  ON account_access_overrides (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stored_objects (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  oid TEXT NOT NULL CHECK (oid ~ '^[a-f0-9]{64}$'),
  declared_bytes BIGINT NOT NULL CHECK (declared_bytes >= 0),
  confirmed_bytes BIGINT CHECK (confirmed_bytes >= 0),
  state TEXT NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved', 'confirmed')),
  reservation_expires_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, oid)
);
CREATE INDEX IF NOT EXISTS stored_objects_reservations
  ON stored_objects (reservation_expires_at) WHERE state = 'reserved';

CREATE TABLE IF NOT EXISTS usage_samples (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  repository_bytes BIGINT NOT NULL CHECK (repository_bytes >= 0),
  object_bytes BIGINT NOT NULL CHECK (object_bytes >= 0),
  total_bytes BIGINT NOT NULL CHECK (total_bytes >= 0),
  source TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_samples_account_time
  ON usage_samples (account_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS usage_settlements (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  excess_gb_month NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitting', 'submitted', 'charged', 'failed', 'void')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, period_start, period_end)
);
