#!/bin/bash
# Applies any files in /goodfolder-migrations that this database has not seen
# yet. Runs on every `docker compose up` before the services start; running it
# again with nothing new is a no-op. Each file's name is recorded in the
# schema_migrations table, so a file is only ever run once.
set -euo pipefail

for _ in $(seq 1 60); do
  pg_isready -q && break
  sleep 1
done
pg_isready -q

have_table=$(psql -tA -c \
  "SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'")

if [ "$have_table" != "1" ]; then
  # A database without the record table is either brand new (initdb did not
  # finish marking it) or predates tracked upgrades. Treat it as current —
  # there is no reliable way to tell which old files already ran — and say so.
  psql -v ON_ERROR_STOP=1 --single-transaction \
    -f /goodfolder-migrations/2026-09-13-schema-migrations.sql
  for f in /goodfolder-migrations/*.sql; do
    name="$(basename "$f")"
    psql -v ON_ERROR_STOP=1 \
      -c "INSERT INTO schema_migrations (name) VALUES ('$name') ON CONFLICT DO NOTHING"
  done
  echo "No record of earlier upgrades was found, so the schema is assumed current."
  echo "If this installation predates 2026-09-13, see docs/self-hosting.md -> Upgrading."
  exit 0
fi

applied=0
for f in /goodfolder-migrations/*.sql; do
  name="$(basename "$f")"
  seen=$(psql -tA -c "SELECT 1 FROM schema_migrations WHERE name = '$name'")
  if [ "$seen" = "1" ]; then
    continue
  fi
  echo "applying $name"
  psql -v ON_ERROR_STOP=1 --single-transaction -f "$f"
  psql -v ON_ERROR_STOP=1 \
    -c "INSERT INTO schema_migrations (name) VALUES ('$name')"
  applied=1
done

if [ "$applied" = "0" ]; then
  echo "schema up to date"
fi
