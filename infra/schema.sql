-- GoodFolder control-plane schema v0
CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  repository_bytes BIGINT NOT NULL DEFAULT 0,
  usage_reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'agent')),
  cursor_save_seq INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE saves (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  seq INTEGER NOT NULL,
  label TEXT NOT NULL,
  label_source TEXT NOT NULL CHECK (label_source IN ('user', 'agent')),
  actor_device_id UUID NOT NULL REFERENCES devices(id),
  collision TEXT CHECK (collision IN ('none', 'auto-merged', 'text-overlap', 'binary-conflict')),
  changed_paths JSONB NOT NULL DEFAULT '[]',
  commit_sha TEXT NOT NULL,
  -- Save receipt: the structured evidence beneath the label.
  added_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  removed_count INTEGER NOT NULL DEFAULT 0,
  top_paths JSONB NOT NULL DEFAULT '[]',
  harness TEXT, -- MCP clientInfo.name; null = a person ran the command directly
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, seq)
);
CREATE INDEX saves_project_created ON saves (project_id, created_at DESC);

-- v0 auth: bearer tokens bound to one device + one project.
CREATE TABLE transfer_tokens (
  token_hash TEXT PRIMARY KEY, -- sha256 hex of the raw token
  device_id UUID NOT NULL UNIQUE REFERENCES devices(id),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Magic-link auth + browser pairing (2026-08-25)
--
-- Two-layer credential model:
--   account_devices — the "approve this computer" credential. Account-scoped,
--     lives in the OS keychain, covers every agent on the machine.
--   transfer_tokens (above) — per-folder transport credentials for git/LFS/
--     saves, minted THROUGH an account device instead of dev bootstrap.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS account_devices (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, -- sha256 hex of the raw token
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS account_devices_account ON account_devices (account_id);

CREATE TABLE IF NOT EXISTS magic_links (
  token_hash TEXT PRIMARY KEY,     -- sha256 hex of the raw link token
  email TEXT NOT NULL,
  next_path TEXT,                  -- where the browser goes after sign-in
  pair_code TEXT,                  -- pending pairing to return to, if any
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS magic_links_email ON magic_links (email);

-- OAuth-device-flow-style pairing: the CLI holds `code` as its bearer while
-- polling; the browser session approves. The minted device token is stored
-- encrypted with a key derived from the code itself, so a database leak alone
-- cannot recover it and only the polling CLI can decrypt the delivery.
CREATE TABLE IF NOT EXISTS pairing_requests (
  code TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
  account_id UUID REFERENCES accounts(id),
  account_device_id UUID REFERENCES account_devices(id),
  delivery BYTEA,                  -- iv(12) || tag(16) || ciphertext
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,     -- sha256 hex of the cookie value
  account_id UUID NOT NULL REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);

-- Dashboard collaboration (2026-08-27). Owners remain projects.account_id;
-- contributors can read, comment, and submit change proposals.
CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('contributor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, account_id)
);

CREATE TABLE IF NOT EXISTS project_invitations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('contributor')),
  invited_by UUID NOT NULL REFERENCES accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);

CREATE TABLE IF NOT EXISTS change_proposals (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_account_id UUID NOT NULL REFERENCES accounts(id),
  title TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  base_commit_sha TEXT,
  base_save_seq INTEGER,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'rejected', 'needs-review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS change_proposals_project
  ON change_proposals(project_id, created_at DESC);

-- A proposed GoodFolder has no project yet, so it is reviewed at the account
-- level. Accepting one creates the project; rejecting it leaves no folder.
CREATE TABLE IF NOT EXISTS workspace_proposals (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  author_account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES accounts(id),
  created_project_id UUID REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS workspace_proposals_account
  ON workspace_proposals(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS proposal_suggestions (
  id UUID PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES change_proposals(id) ON DELETE CASCADE,
  document_path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text'
    CHECK (kind IN ('text', 'table', 'asset', 'rename', 'remove')),
  base_file_sha TEXT,
  operation JSONB NOT NULL DEFAULT '{}'::jsonb,
  section_hint TEXT,
  before_text TEXT NOT NULL,
  replacement_text TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'rejected', 'needs-review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

-- Typed proposal fields were added after the first text-only collaboration
-- release. Keep the legacy before/replacement columns so old clients and
-- already-created text proposals remain readable during the transition.
ALTER TABLE proposal_suggestions
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE proposal_suggestions
  ADD COLUMN IF NOT EXISTS base_file_sha TEXT;
ALTER TABLE proposal_suggestions
  ADD COLUMN IF NOT EXISTS operation JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proposal_suggestions'::regclass
      AND conname = 'proposal_suggestions_kind_check'
  ) THEN
    ALTER TABLE proposal_suggestions
      ADD CONSTRAINT proposal_suggestions_kind_check
      CHECK (kind IN ('text', 'table', 'asset'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS proposal_comments (
  id UUID PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES change_proposals(id) ON DELETE CASCADE,
  suggestion_id UUID REFERENCES proposal_suggestions(id) ON DELETE CASCADE,
  author_account_id UUID NOT NULL REFERENCES accounts(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_comments (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_path TEXT NOT NULL,
  author_account_id UUID NOT NULL REFERENCES accounts(id),
  quoted_text TEXT,
  body TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_comments_project_path
  ON document_comments(project_id, document_path, created_at DESC);

-- Hosted billing and protected-data accounting (2026-08-30).
-- Self-hosted installations use BILLING_MODE=disabled and remain unlimited.
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

-- A temporary, code-redeemed hosted-access campaign. This is deliberately
-- separate from billing: redemption never creates a provider customer or a
-- subscription, and expiry leaves the account and its files intact.
CREATE TABLE IF NOT EXISTS campaign_access_redemptions (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign TEXT NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (account_id, campaign)
);
CREATE INDEX IF NOT EXISTS campaign_access_redemptions_current
  ON campaign_access_redemptions (account_id, expires_at DESC);

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

-- Bytes an invited person has sent up but nobody has accepted into a folder.
-- They live under a `staging/` key in object storage, which the usage pass
-- deliberately does not match: nothing here counts against anyone's storage
-- until an owner accepts it, and unaccepted bytes are swept after a week.
CREATE TABLE IF NOT EXISTS staged_uploads (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  oid TEXT NOT NULL CHECK (oid ~ '^[a-f0-9]{64}$'),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  file_name TEXT NOT NULL,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS staged_uploads_expiry ON staged_uploads (expires_at);
CREATE INDEX IF NOT EXISTS staged_uploads_project ON staged_uploads (project_id, created_at DESC);

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
