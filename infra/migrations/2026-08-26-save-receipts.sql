-- 2026-08-26 — save receipts.
-- Structured facts behind every save's label: counts, top paths, and the
-- tool (harness) that drove the work. Additive; applied before the
-- receipt-aware control-plane deploys. Mirrors infra/schema.sql.

ALTER TABLE saves
  ADD COLUMN IF NOT EXISTS added_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS changed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS removed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top_paths JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS harness TEXT;
