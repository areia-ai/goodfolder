-- 2026-09-17 — scoped service access + outbound webhooks.
-- Additive; mirrors the block at the end of infra/schema.sql.
--
-- A third-party assistant (a hosted agent, a cloud runner, a service that
-- keeps someone's folder up to date) gets its own revocable credential with
-- a narrow scope list instead of an account device token. The credential is
-- bound to one folder when the person approves it that way, otherwise it
-- reaches every folder on the account but still only through the scopes it
-- was granted. Saves it records are attributed to a device row created on
-- first use, one per (credential, folder), so the timeline never says
-- "someone" and the usage pass counts the same bytes either way.

CREATE TABLE IF NOT EXISTS service_credentials (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_via TEXT NOT NULL DEFAULT 'dashboard'
    CHECK (created_via IN ('dashboard', 'device')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS service_credentials_account ON service_credentials (account_id);
CREATE INDEX IF NOT EXISTS service_credentials_project ON service_credentials (project_id);

CREATE TABLE IF NOT EXISTS service_credential_devices (
  credential_id UUID NOT NULL REFERENCES service_credentials(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (credential_id, project_id)
);

-- The browser approval ceremony now covers two things: a computer (existing
-- account_devices row) and a service (service_credentials row). The extra
-- columns are only ever set for the second.
ALTER TABLE pairing_requests ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE pairing_requests ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE pairing_requests ADD COLUMN IF NOT EXISTS credential_kind TEXT NOT NULL DEFAULT 'device';
ALTER TABLE pairing_requests ADD COLUMN IF NOT EXISTS created_credential_id UUID REFERENCES service_credentials(id) ON DELETE SET NULL;

-- Outbound webhooks. An endpoint belongs to the account, and carries a
-- folder when it should only hear about that one folder. project_id NULL
-- means every folder on the account.
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_delivered_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_account ON webhook_endpoints (account_id);
CREATE INDEX IF NOT EXISTS webhook_endpoints_project ON webhook_endpoints (project_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY,
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  project_id UUID,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at DESC);
