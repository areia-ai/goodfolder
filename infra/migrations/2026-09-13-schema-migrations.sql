-- Records which files in this directory have been applied, so an upgrade
-- applies only the new ones. Fresh installs get every current file marked
-- as applied at first start, because schema.sql already contains them.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
