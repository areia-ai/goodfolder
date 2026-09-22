-- 2026-09-22 — save warnings.
-- Additive; mirrors the saves table in infra/schema.sql.
--
-- A save now remembers which added files had names that suggest secrets
-- (the warn tier — saved, but said out loud). Credential-shaped or
-- ignore-listed files that landed anyway are raised separately as the
-- save.flagged audit row and webhook; nothing here blocks a save.

ALTER TABLE saves ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]'::jsonb;
