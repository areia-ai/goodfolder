-- 2026-08-27 — dashboard collaboration and change proposals.
-- Additive. Owners remain the projects.account_id account; members extend access.

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

CREATE TABLE IF NOT EXISTS proposal_suggestions (
  id UUID PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES change_proposals(id) ON DELETE CASCADE,
  document_path TEXT NOT NULL,
  section_hint TEXT,
  before_text TEXT NOT NULL,
  replacement_text TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'rejected', 'needs-review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

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
