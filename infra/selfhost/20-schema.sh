#!/bin/bash
# Applies the GoodFolder schema to the database 10-goodfolder.sh just created.
# Runs once, during first-time cluster initialisation, where local socket auth
# is trusted. Files ending .sql in this directory would target Gitea's database
# instead, which is why this is a script.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username goodfolder --dbname goodfolder -f /goodfolder-schema.sql
echo "goodfolder schema applied"
