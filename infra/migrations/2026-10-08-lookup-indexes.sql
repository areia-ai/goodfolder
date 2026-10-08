-- 2026-10-08 — indexes for the lookups every request runs.
-- Additive; mirrors infra/schema.sql.
--
-- These are the lookups every request or every write runs: account →
-- projects on entitlement checks and the folder list, project → devices on
-- transport auth, service-key usage over audit_log, suggestions and
-- comments per proposal, delivery history per webhook. None had an index,
-- so each scanned its whole table and degraded with the number of tenants
-- rather than the caller's own data.

CREATE INDEX IF NOT EXISTS projects_account ON projects (account_id);
CREATE INDEX IF NOT EXISTS project_members_account ON project_members (account_id);
CREATE INDEX IF NOT EXISTS devices_project ON devices (project_id);
CREATE INDEX IF NOT EXISTS proposal_suggestions_proposal ON proposal_suggestions (proposal_id, created_at);
CREATE INDEX IF NOT EXISTS proposal_comments_proposal ON proposal_comments (proposal_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_service_request
  ON audit_log ((detail->>'credentialId'), created_at DESC)
  WHERE action = 'service.request';
CREATE INDEX IF NOT EXISTS webhook_deliveries_created ON webhook_deliveries (created_at);
