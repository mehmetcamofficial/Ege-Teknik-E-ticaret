#!/usr/bin/env bash
# H5-C: dump -> authenticated encryption -> decrypt round trip -> checksum -> PUBLIC manifest. Same proven steps as
# scripts/create-encrypted-backup.sh (kept untouched for the open PRs), plus the manifest. No artifact upload, no network except pg_dump.
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
BACKUP_PREFIX="${BACKUP_PREFIX:-ege-teknik-production}"
[[ "$BACKUP_PREFIX" =~ ^ege-teknik-(production|synthetic)$ ]] || exit 1
SOURCE_LABEL="neon-production"; [[ "$BACKUP_PREFIX" == "ege-teknik-synthetic" ]] && SOURCE_LABEL="synthetic"
BACKUP_DIR="$(mktemp -d "$RUNNER_TEMP/ege-backup.XXXXXXXX")"
printf 'backup_dir=%s\n' "$BACKUP_DIR" >> "$GITHUB_OUTPUT"
DUMP="$BACKUP_DIR/source.dump"; CHECK="$BACKUP_DIR/check.dump"; TOC="$BACKUP_DIR/toc.txt"
trap 'rm -f -- "$DUMP" "$CHECK" "$TOC"' EXIT
STAMP="$(date -u +'%Y-%m-%dT%H-%M-%SZ')"
BASE="${BACKUP_PREFIX}-${STAMP}-${BACKUP_GCM_KEY_ID}-${BACKUP_DIR##*.}"
ENC="$BACKUP_DIR/$BASE.dump.enc"
node scripts/backup-dump.mjs "$DUMP"
pg_restore --list "$DUMP" | grep -v '^;' > "$TOC"
[[ -s "$TOC" ]] || { echo "Dump table of contents is empty" >&2; exit 1; }
node scripts/backup-crypto-gcm.mjs encrypt "$DUMP" "$ENC"
node scripts/backup-crypto-gcm.mjs decrypt "$ENC" "$CHECK"
cmp -s "$DUMP" "$CHECK"
pg_restore --list "$CHECK" | grep -v '^;' | cmp -s - "$TOC"
(cd "$BACKUP_DIR" && sha256sum "$BASE.dump.enc" > "$BASE.dump.enc.sha256")
BACKUP_SOURCE="$SOURCE_LABEL" PG_DUMP_VERSION="$(pg_dump --version)" node scripts/backup-create-manifest.mjs "$ENC" "$ENC.sha256" "$TOC" "$ENC.manifest.json"
{
  printf 'encrypted_file=%s\n' "$ENC"
  printf 'checksum_file=%s\n' "$ENC.sha256"
  printf 'manifest_file=%s\n' "$ENC.manifest.json"
  printf 'backup_name=%s\n' "$BASE"
} >> "$GITHUB_OUTPUT"
