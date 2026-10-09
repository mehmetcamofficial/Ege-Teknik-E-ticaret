#!/usr/bin/env bash
# Explicitly approved scope: Neon ACTIVE PREVIEW migration 0017-0018 only.
set -Eeuo pipefail
umask 077
for cmd in git python3 psql shasum node tar; do
  command -v "$cmd" >/dev/null || { echo "STOP: missing $cmd" >&2; exit 1; }
done
root="$(git rev-parse --show-toplevel)"
case "$(git -C "$root" remote get-url origin)" in
  https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret|https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret.git|git@github.com:mehmetcamofficial/Ege-Teknik-E-ticaret.git) ;;
  *) echo "STOP: unexpected repository origin" >&2; exit 1 ;;
esac
backup="$HOME/SecureBackups/ege-teknik/preview-pre-0017-0018-20261010-021510.dump.enc"
expected="945bd7b3bba0a323fcb8d0dc3c07f3f70cb01801826709a2338b74159a154725"
test -s "$backup" || { echo "STOP: backup missing" >&2; exit 1; }
test "$(shasum -a 256 "$backup" | awk '{print $1}')" = "$expected" || {
  echo "STOP: backup SHA-256 mismatch" >&2; exit 1;
}
echo "[gate] Verified encrypted Preview backup: PASS"
rootmodules="$root/node_modules"
test -d "$rootmodules" || { echo "STOP: node_modules missing in repo" >&2; exit 1; }
workdir="$(mktemp -d /tmp/ege-preview-migrate.XXXXXXXX)"
cleanup() {
  unset DATABASE_URL_UNPOOLED PREVIEW_OWNER_URL PGSERVICEFILE PGPASSFILE || true
  rm -rf "$workdir"
}
trap cleanup EXIT
mkdir "$workdir/release"
git -C "$root" archive --format=tar FETCH_HEAD | tar -xf - -C "$workdir/release"
cmp -s "$workdir/release/scripts/migrate-preview-0017-0018.sh" "$0" || {
  echo "STOP: fetched release does not match this script" >&2; exit 1;
}
ln -s "$rootmodules" "$workdir/release/node_modules"
(cd "$workdir/release" && node scripts/verify-migration-integrity.mjs)
echo "[gate] Reviewed migration files and journal: PASS"
echo "TARGET: active Preview br-nameless-mountain-awib28a9 / neondb ONLY"
IFS= read -r -s -p "Paste Preview owner PostgreSQL URL (hidden): " PREVIEW_OWNER_URL
printf '\n'
export PREVIEW_OWNER_URL
export GUARD_WORKDIR="$workdir"
python3 - <<'PY'
import os, pathlib, sys
from urllib.parse import urlsplit, unquote, parse_qs
url = urlsplit(os.environ["PREVIEW_OWNER_URL"])
pooler = "ep-old-bonus-aw2oqd0j-pooler.c-12.us-east-1.aws.neon.tech"
direct = pooler.replace("-pooler.", ".")
if (
    url.scheme not in ("postgres", "postgresql")
    or url.hostname not in (pooler, direct)
    or url.path != "/neondb"
    or url.port not in (None, 5432)
    or unquote(url.username or "") != "neondb_owner"
    or not url.password or url.fragment
    or any(k not in ("sslmode", "channel_binding", "application_name", "connect_timeout") for k in parse_qs(url.query))
):
    sys.exit("STOP: connection is not the exact active Preview owner endpoint.")
root = pathlib.Path(os.environ["GUARD_WORKDIR"])
password = unquote(url.password).replace("\\", "\\\\").replace(":", "\\:")
(root / "pgpass").write_text(f"{direct}:5432:neondb:neondb_owner:{password}\n")
(root / "pgpass").chmod(0o600)
(root / "pg_service.conf").write_text(
    "[preview_direct]\n"
    f"host={direct}\nport=5432\ndbname=neondb\nuser=neondb_owner\n"
    "sslmode=verify-full\nsslrootcert=system\nconnect_timeout=15\n"
)
(root / "pg_service.conf").chmod(0o600)
PY
# Convert only the validated Preview pooler host to its direct endpoint.
DATABASE_URL_UNPOOLED="$(printf '%s' "$PREVIEW_OWNER_URL" | sed 's/-pooler\././')"
export DATABASE_URL_UNPOOLED
unset PREVIEW_OWNER_URL
export PGSERVICEFILE="$workdir/pg_service.conf"
export PGPASSFILE="$workdir/pgpass"
export MIGRATION_TARGET_ENV=preview
export NEON_BRANCH_ID=br-nameless-mountain-awib28a9
export EXPECTED_NEON_PREVIEW_BRANCH_ID=br-nameless-mountain-awib28a9
unset ALLOW_PRODUCTION_MIGRATION || true

fingerprint_sql="SELECT concat_ws('|',(SELECT count(*) FROM drizzle.__drizzle_migrations),(SELECT count(*) FROM public.orders),(SELECT count(*) FROM public.order_legal_acceptances),(SELECT count(*) FROM public.products),(SELECT count(*) FROM public.legal_document_versions));"
before="$(psql -X -qAt -v ON_ERROR_STOP=1 'service=preview_direct' -c "$fingerprint_sql")"
test "$before" = "17|16|30|88|16" || {
  echo "STOP: Preview data differs from verified backup ($before). Re-backup before migrating." >&2; exit 1;
}
latest="$(psql -X -qAt -v ON_ERROR_STOP=1 'service=preview_direct' -c 'SELECT max(created_at) FROM drizzle.__drizzle_migrations')"
test "$latest" = "1791496077696" || { echo "STOP: migration ledger differs" >&2; exit 1; }
exists="$(psql -X -qAt -v ON_ERROR_STOP=1 'service=preview_direct' -c "SELECT to_regprocedure('public.lock_checkout_products(text[])') IS NOT NULL")"
test "$exists" = "f" || { echo "STOP: 0017 function already exists" >&2; exit 1; }
echo "[gate] Active Preview preflight: PASS (17|16|30|88|16)"
echo "[migrate] Running standard guarded Drizzle migrator on Preview direct endpoint..."
(cd "$workdir/release" && node scripts/migrate.mjs)
after="$(psql -X -qAt -v ON_ERROR_STOP=1 'service=preview_direct' -c "$fingerprint_sql")"
test "$after" = "19|16|30|88|16" || {
  echo "STOP: post-migration data mismatch ($after); do not retry automatically." >&2; exit 1;
}
security="$(psql -X -qAt -v ON_ERROR_STOP=1 'service=preview_direct' -c "
SELECT (
  (SELECT max(created_at) = 1791673200000 FROM drizzle.__drizzle_migrations)
  AND EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.lock_checkout_products(text[])'::regprocedure
    AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                    WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  )
  AND EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.order_legal_evidence_guard()'::regprocedure
    AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
    AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                    WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  )
);")"
test "$security" = "t" || {
  echo "STOP: function security postflight failed; do not enable scoped checkout." >&2; exit 1;
}
echo "SUCCESS: Preview 0017-0018 migrated; ledger 19; existing data unchanged; function security PASS."
echo "Production, roles, Vercel, deploy and PR merge were not modified."
