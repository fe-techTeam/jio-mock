#!/usr/bin/env bash
# Idempotently creates the jio_ipo_test database on the compose Postgres.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
psql_admin() { docker compose exec -T db psql -U jio -d postgres -tA "$@"; }
exists=$(psql_admin -c "select 1 from pg_database where datname = 'jio_ipo_test'")
if [ "$exists" != "1" ]; then
  psql_admin -c "CREATE DATABASE jio_ipo_test" >/dev/null
fi
echo "jio_ipo_test ready"
