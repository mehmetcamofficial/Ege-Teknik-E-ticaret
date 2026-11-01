#!/usr/bin/env bash
# EGE TEKNIK — Isolated PostgreSQL 18 commerce/EFT verification.
# This process creates ONLY its own temporary PGDATA and sprintb_* database.
# Existing clusters, Production, Preview and pre-existing databases are untouched.
set -Eeuo pipefail

die() { printf '[eft-pg18] BLOCKED: %s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" == "Darwin" ]] || die "Mac-only runner (uses local Homebrew PostgreSQL 18)"
command -v brew >/dev/null 2>&1 || die "Homebrew is missing"
PG_BIN="$(brew --prefix postgresql@18 2>/dev/null)/bin" || die "PostgreSQL 18 is not installed"
for cmd in initdb pg_ctl pg_isready psql createdb; do
  [[ -x "$PG_BIN/$cmd" ]] || die "PostgreSQL 18 binary missing: $cmd"
done
[[ "$("$PG_BIN/pg_ctl" --version)" == *"PostgreSQL) 18."* ]] || die "PostgreSQL 18 required"

# Never consume inherited DB connection variables as the test target.
PORT=55571
DB=sprintb_eft_isolated_20261102
ROLE=eft_qa_local_admin
if "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$PORT" -t 1 >/dev/null 2>&1; then
  die "Port $PORT is occupied by an existing PostgreSQL server. Nothing touched."
fi
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | grep -q .; then
  die "Port $PORT already has a listener. Nothing touched."
fi
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ege-eft-pg18.XXXXXXXX")" || die "Could not create new temporary directory"
PGDATA="$ROOT/pgdata"
STARTED=0
cleanup() {
  code=$?
  trap - EXIT INT TERM
  if [[ "$STARTED" == 1 ]]; then
    "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast -w -t 25 stop >/dev/null 2>&1 || {
      printf '[eft-pg18] BLOCKED: temporary server stop failed; inspect %s and stop it manually\n' "$PGDATA" >&2
      exit 1
    }
  fi
  # ROOT is this process's new mktemp directory; remove ONLY after server is stopped.
  if [[ -n "${ROOT:-}" && -d "$ROOT" && "$ROOT" == *"/ege-eft-pg18."* ]]; then
    rm -rf -- "$ROOT"
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Authentication is trust only inside this throwaway local instance, which listens on loopback.
"$PG_BIN/initdb" -D "$PGDATA" -U "$ROLE" --auth-local=trust --auth-host=trust --encoding=UTF8 --no-instructions > "$ROOT/initdb.log" 2>&1 || die "initdb failed (no other cluster touched)"
printf '[eft-pg18] Starting disposable PG18 on loopback port %s\n' "$PORT"
"$PG_BIN/pg_ctl" -D "$PGDATA" -l "$ROOT/postgres.log" -o "-c listen_addresses=127.0.0.1 -p $PORT -c unix_socket_directories=$ROOT" -w -t 25 start >/dev/null || die "start failed (no other cluster touched)"
STARTED=1
"$PG_BIN/createdb" -h 127.0.0.1 -p "$PORT" -U "$ROLE" -O "$ROLE" "$DB" || die "Could not create disposable DB"
identity="$("$PG_BIN/psql" -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$ROLE" -d "$DB" -c "select current_database() || '|' || current_user || '|' || inet_server_port() || '|' || current_setting('server_version_num')" )" || die "Identity query failed"
[[ "$identity" == "$DB|$ROLE|$PORT|"18* ]] || die "Unexpected DB identity; aborting"
printf '[eft-pg18] Verified local disposable database identity. Running real-PostgreSQL commerce gate.\n'
# This runner resets PUBLIC SCHEMA in this newly created DB before EACH suite.
# It enforces 0 skipped / 0 failed, and includes concurrent EFT reference tests.
# Unset inherited connection values to prevent accidental use.
env -u DATABASE_URL -u STOREFRONT_DATABASE_URL -u ADMIN_DATABASE_URL \
  -u FINANCE_TEST_DATABASE_URL -u SPRINTB_PG_URL -u P3B_PG_URL \
  COMMERCE_PG_URL="postgresql://$ROLE@127.0.0.1:$PORT/$DB" \
  pnpm test:commerce-postgres
printf '[eft-pg18] PASS: commerce PostgreSQL regression gate.\n'
printf '[eft-pg18] Running EFT-04C.2 real HTTP RBAC and listing test on the same disposable instance.\n'
env -u DATABASE_URL -u STOREFRONT_DATABASE_URL -u ADMIN_DATABASE_URL \
  -u FINANCE_TEST_DATABASE_URL -u SPRINTB_PG_URL -u P3B_PG_URL \
  EFT04C_ISOLATED_QA="1" \
  EFT04C_HTTP_PG_URL="postgresql://$ROLE@127.0.0.1:$PORT/$DB" \
  node scripts/test-eft04c-http.mjs
printf '[eft-pg18] PASS: commerce + real HTTP EFT authorization and read-only listing; disposable cluster will stop.\n'
