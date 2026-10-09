#!/usr/bin/env bash
# Ege Teknik — ACTIVE PREVIEW ONLY, independent encrypted backup + offline PG18 restore.
# Run on your own trusted Mac: bash scripts/backup-preview-verify.sh
# Does not execute migrations or write to Neon.
set -Eeuo pipefail
umask 077

for cmd in pg_dump pg_restore psql docker python3 openssl shasum; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "STOP: missing required command: $cmd" >&2
    exit 1
  fi
done
if ! pg_dump --version | grep -Eq ' 18([. ]|$)' ||
   ! pg_restore --version | grep -Eq ' 18([. ]|$)'; then
  echo "STOP: pg_dump and pg_restore must be PostgreSQL 18." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "STOP: Docker must be running for the offline restore test." >&2
  exit 1
fi

workdir="$(mktemp -d /tmp/ege-preview-backup.XXXXXXXX)"
container_name="ege-preview-restore-$$"
encrypted=""
verified=0
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  if [ "$verified" -ne 1 ] && [ -n "$encrypted" ]; then rm -f "$encrypted"; fi
  rm -rf "$workdir"
}
trap cleanup EXIT

echo "Target: ACTIVE PREVIEW ONLY — br-nameless-mountain-awib28a9 / neondb"
echo "Never enter a Production DATABASE_URL."
IFS= read -r -s -p "Paste Neon Preview owner PostgreSQL URL (hidden input): " PREVIEW_DATABASE_URL
printf '\n'
if [ -z "$PREVIEW_DATABASE_URL" ]; then echo "STOP: empty URL" >&2; exit 1; fi

export PREVIEW_DATABASE_URL
export BACKUP_WORKDIR="$workdir"
python3 - <<'PY'
import os, pathlib, sys
from urllib.parse import urlsplit, unquote, parse_qs

url = urlsplit(os.environ["PREVIEW_DATABASE_URL"])
expected_host = "ep-old-bonus-aw2oqd0j-pooler.c-12.us-east-1.aws.neon.tech"
direct_host = expected_host.replace("-pooler.", ".")
query = parse_qs(url.query, keep_blank_values=True)
if (
    url.scheme not in ("postgresql", "postgres")
    or url.hostname not in (expected_host, direct_host)
    or url.port not in (None, 5432)
    or url.path != "/neondb"
    or unquote(url.username or "") != "neondb_owner"
    or not url.password
    or any(key not in ("sslmode", "channel_binding", "application_name", "connect_timeout") for key in query)
    or url.fragment
):
    sys.exit("STOP: URL does not match the explicitly verified ACTIVE PREVIEW endpoint, database and owner role.")
root = pathlib.Path(os.environ["BACKUP_WORKDIR"])
(root / "pg_service.conf").write_text(
    "[ege_preview_backup]\n"
    f"host={url.hostname}\nport={url.port or 5432}\n"
    "dbname=neondb\nuser=neondb_owner\n"
    "sslmode=verify-full\nsslrootcert=system\n"
)
# libpq .pgpass escapes colons and backslashes; password never appears in argv.
password = unquote(url.password).replace("\\", "\\\\").replace(":", "\\:")
(root / "pgpass").write_text(f"{url.hostname}:{url.port or 5432}:neondb:neondb_owner:{password}\n")
(root / "pg_service.conf").chmod(0o600)
(root / "pgpass").chmod(0o600)
print("Preview host/role/database guard: PASS")
PY
unset PREVIEW_DATABASE_URL BACKUP_WORKDIR
export PGSERVICEFILE="$workdir/pg_service.conf"
export PGPASSFILE="$workdir/pgpass"

fingerprint_sql="SELECT concat_ws('|', (SELECT count(*) FROM drizzle.__drizzle_migrations), (SELECT count(*) FROM public.orders), (SELECT count(*) FROM public.order_legal_acceptances), (SELECT count(*) FROM public.products), (SELECT count(*) FROM public.legal_document_versions));"
before="$(psql -X -qAt -v ON_ERROR_STOP=1 'service=ege_preview_backup' -c "$fingerprint_sql")"
case "$before" in
  17\|16\|*) echo "Preview migration/order baseline: PASS ($before)" ;;
  *) echo "STOP: Preview migration/order baseline differs; no backup taken. ($before)" >&2; exit 1 ;;
esac

dump="$workdir/preview.dump"
echo "Creating a consistent pg_dump custom-format archive..."
pg_dump --format=custom --file="$dump" --dbname='service=ege_preview_backup'
test -s "$dump"
pg_restore --list "$dump" >/dev/null
after="$(psql -X -qAt -v ON_ERROR_STOP=1 'service=ege_preview_backup' -c "$fingerprint_sql")"
if [ "$before" != "$after" ]; then
  echo "STOP: source counts changed during backup. Freeze writes and retry." >&2
  exit 1
fi

echo "Starting isolated PostgreSQL 18 restore container (no published port)..."
docker run --detach --rm --name "$container_name" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18-alpine >/dev/null
ready=0
for attempt in $(seq 1 45); do
  if docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then echo "STOP: local PostgreSQL 18 did not start." >&2; exit 1; fi
docker cp "$dump" "$container_name:/tmp/preview.dump" >/dev/null
# Only the disposable Docker container is modified. A separate empty database
# and --clean/--if-exists handle source archives that include the public schema.
docker exec "$container_name" createdb -U postgres ege_restore
if ! docker exec "$container_name" pg_restore -U postgres -d ege_restore \
  --clean --if-exists --no-owner --no-acl --exit-on-error /tmp/preview.dump \
  >"$workdir/restore.log" 2>&1; then
  echo "STOP: offline PostgreSQL 18 restore failed; encrypted backup not produced." >&2
  exit 1
fi
restored="$(docker exec "$container_name" psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d ege_restore -c "$fingerprint_sql")"
if [ "$before" != "$restored" ]; then
  echo "STOP: restored counts differ from Preview baseline." >&2
  exit 1
fi
echo "Offline restore: PASS ($restored)"

backup_dir="$HOME/SecureBackups/ege-teknik"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
stamp="$(date +%Y%m%d-%H%M%S)"
encrypted="$backup_dir/preview-pre-0017-0018-$stamp.dump.enc"
echo "Encrypting verified archive with AES-256-CBC / PBKDF2 (choose a strong passphrase)."
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in "$dump" -out "$encrypted"
echo "Re-enter the passphrase to verify decryption."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$encrypted" -out "$workdir/decrypted.dump"
cmp "$dump" "$workdir/decrypted.dump"
chmod 600 "$encrypted"
verified=1
echo "SUCCESS: encrypted Preview backup and independent PostgreSQL 18 restore verified."
printf 'Backup file: %s\n' "$encrypted"
shasum -a 256 "$encrypted"
echo "Retain the passphrase separately. No migration, Preview write, or Production operation was performed."
