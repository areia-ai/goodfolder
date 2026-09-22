-- 2026-09-23 — device-reported skipped files on saves.
-- Additive; mirrors the saves table in infra/schema.sql.
--
-- A save can now carry what the device left out: the server never receives
-- skipped files, so the device's report is the only witness. Both columns
-- are nullable on purpose — NULL means the save carried no report (browser
-- saves, services that don't report, older devices), which is not the same
-- as "nothing was skipped".

ALTER TABLE saves
  ADD COLUMN IF NOT EXISTS skipped jsonb,
  ADD COLUMN IF NOT EXISTS skipped_total integer;
