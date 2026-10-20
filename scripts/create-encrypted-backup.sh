#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${DATABASE_URL:?Missing backup database configuration}"
: "${BACKUP_GCM_KEY_B64:?Missing GCM key configuration}"
: "${BACKUP_GCM_KEY_ID:?Missing non-secret key version}"
: "${RUNNER_TEMP:?Missing runner directory}"
: "${GITHUB_OUTPUT:?Missing output file}"
[[ "$BACKUP_GCM_KEY_ID" =~ ^[a-zA-Z0-9_-]{1,64}$ ]] || { echo "Invalid key version" >&2; exit 1; }
node -e 'const v=process.env.BACKUP_GCM_KEY_B64;const b=Buffer.from(v,"base64");if(b.length!==32||b.toString("base64")!==v)process.exit(1)'
pg_dump --version | grep -Eq ' 18([. ]|$)'
pg_restore --version | grep -Eq ' 18([. ]|$)'
BACKUP_DIR="$(mktemp -d "$RUNNER_TEMP/ege-backup.XXXXXXXX")"
printf 'backup_dir=%s\n' "$BACKUP_DIR" >> "$GITHUB_OUTPUT"
DUMP="$BACKUP_DIR/source.dump"
CHECK="$BACKUP_DIR/check.dump"
trap 'rm -f -- "$DUMP" "$CHECK"' EXIT
BACKUP_PREFIX="${BACKUP_PREFIX:-ege-teknik-production}"
[[ "$BACKUP_PREFIX" =~ ^ege-teknik-(production|synthetic)$ ]] || exit 1
STAMP="$(date -u +'%Y-%m-%dT%H-%M-%SZ')"
BASE="${BACKUP_PREFIX}-${STAMP}-${BACKUP_GCM_KEY_ID}-${BACKUP_DIR##*.}"
ENC="$BACKUP_DIR/$BASE.dump.enc"
# Retain ACL/default privileges and owners; URI/password never enter process arguments.
node scripts/backup-dump.mjs "$DUMP"
pg_restore --list "$DUMP" >/dev/null
node scripts/backup-crypto-gcm.mjs encrypt "$DUMP" "$ENC"
node scripts/backup-crypto-gcm.mjs decrypt "$ENC" "$CHECK"
cmp -s "$DUMP" "$CHECK"
pg_restore --list "$CHECK" >/dev/null
(cd "$BACKUP_DIR" && sha256sum "$BASE.dump.enc" > "$BASE.dump.enc.sha256")
# Public recovery metadata contains key ID, never key material or connection details.
printf '{"format":"ETGCM002","algorithm":"AES-256-GCM","key_id":"%s","postgres_major":18}\n' "$BACKUP_GCM_KEY_ID" > "$ENC.metadata.json"
{
  printf 'encrypted_file=%s\n' "$ENC"
  printf 'checksum_file=%s\n' "$ENC.sha256"
  printf 'metadata_file=%s\n' "$ENC.metadata.json"
  printf 'backup_name=%s\n' "$BASE"
} >> "$GITHUB_OUTPUT"
