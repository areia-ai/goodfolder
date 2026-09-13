#!/bin/bash
# Applies the GoodFolder schema to the database 10-goodfolder.sh just created.
# Runs once, during first-time cluster initialisation, where local socket auth
# is trusted. Files ending .sql in this directory would target Gitea's database
# instead, which is why this is a script.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username goodfolder --dbname goodfolder -f /goodfolder-schema.sql
echo "goodfolder schema applied"

# schema.sql already contains everything the migration files do, so a fresh
# install records every one of them as applied. The upgrade runner
# (infra/selfhost/migrate.sh) then only ever runs files added later.
for f in /goodfolder-migrations/*.sql; do
  name="$(basename "$f")"
  psql -v ON_ERROR_STOP=1 --username goodfolder --dbname goodfolder \
    -c "INSERT INTO schema_migrations (name) VALUES ('$name') ON CONFLICT DO NOTHING"
done
echo "schema migrations recorded: $(ls /goodfolder-migrations/*.sql | wc -l | tr -d ' ') files"
