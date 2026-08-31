-- 2026-08-31 - a contributor can propose adding, renaming and taking out files.
--
-- Until now a Change Proposal could only rewrite a file that was already in
-- the folder. The three verbs the owner gained in the browser are the same
-- three an invited person needs, so they arrive as proposal kinds: the owner
-- still decides, and nothing lands without them.
--
-- Additive. Existing rows keep their kinds and their meaning.

-- First, a repair. `proposal_suggestions` was created before the columns the
-- code has written since 2026-08-29, and no migration ever added them — so
-- every installation older than that has a table three columns short of what
-- the server expects, and creating a Change Proposal on one fails. The
-- statements below are written to be safe whether the columns are there or
-- not, so this file brings any installation up to date in one pass.
ALTER TABLE proposal_suggestions
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS base_file_sha TEXT,
  ADD COLUMN IF NOT EXISTS operation JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE proposal_suggestions
  DROP CONSTRAINT IF EXISTS proposal_suggestions_kind_check;
ALTER TABLE proposal_suggestions
  ADD CONSTRAINT proposal_suggestions_kind_check
  CHECK (kind IN ('text', 'table', 'asset', 'rename', 'remove'));

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
