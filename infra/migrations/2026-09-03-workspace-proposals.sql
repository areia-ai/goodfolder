-- Reviewable creation of a brand-new GoodFolder. The project itself is not
-- created until the owner accepts this account-level proposal.
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
