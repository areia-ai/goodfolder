#!/bin/bash
# Creates the GoodFolder control-plane role + database alongside Gitea's.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
	CREATE ROLE goodfolder LOGIN PASSWORD '${GOODFOLDER_DB_PASSWORD}';
	CREATE DATABASE goodfolder OWNER goodfolder;
EOSQL
