# H5-C — Secure automatic backup (Google Drive) — runbook and status

**Status: PREPARED, NOT CONNECTED, NOT ENABLED.** No real Production backup was taken, no Drive connection exists, no secret/variable/environment was created, no workflow was enabled. Production remains **NO-GO**.

## Pipeline (workflow `production-db-backup.yml`, `backup` job)
1. `scripts/create-verified-backup.sh`: `pg_dump` (PG 18) → AES-256-GCM (`ETGCM002`) → decrypt round trip (`cmp`) → TOC (`pg_restore --list`) identical → SHA-256 file → public manifest (`lib/backup/manifest.mjs`).
2. Google auth via **Workload Identity Federation** (no JSON key) → short-lived access token.
3. `scripts/backup-drive-upload.mjs`: checks service-account identity, folder is not shared with `anyone`/`domain`, folder writable, **refuses to overwrite**; uploads archive → checksum → **manifest last (commit marker)**; each file verified (name, size, Drive md5, downloaded round-trip SHA-256). Anything less ⇒ job FAILS, never "success".
4. Retention report (**report-only**; `AUTOMATIC_DELETION_ENABLED=false` is a code constant, the Drive client has no delete/trash/share method).
5. Local files removed; failure ⇒ issue `Production DB backup FAILED` (no secrets).
No GitHub artifact of production data is published (repo is public).

## Safe gates (all required for the backup job)
manual dispatch (schedule is commented out) · `github.ref == refs/heads/main` · repo variable `BACKUP_ENABLED == 'true'` · Environment `production-backup`. PRs run only the secret-free `tests` job. Top-level `permissions: {}`; `id-token: write` only in `backup`; actions pinned to commit SHAs.

## Setup still required (all BLOCKED until the owner does them)
| Item | Needed |
|---|---|
| Google Workspace **Shared Drive** + private folder | service account added as **Contributor** (add-only, cannot delete); no link sharing |
| GCP project: Drive API on, service account, WIF pool/provider restricted to this repo + `main` + environment | vars `GDRIVE_WIF_PROVIDER`, `GDRIVE_SERVICE_ACCOUNT`, `GDRIVE_BACKUP_FOLDER_ID` |
| GitHub Environment `production-backup` | branch policy `main` only, required reviewers; secrets `NEON_PRODUCTION_DATABASE_URL_BACKUP` (read-only backup role), `BACKUP_GCM_KEY_B64` ; var `BACKUP_GCM_KEY_ID` |
| `BACKUP_ENABLED=true` | only after the above and a reviewed decision |
| Key escrow | store `BACKUP_GCM_KEY_B64` in 2 independent offline places (never Drive/Git). **Lost key = unrecoverable backups.** |
Merge only ONE workflow with PR #3 / #23's `neon-production-backup.yml` (that one publishes artifacts and uses OAuth/rclone); they are separate files and do not conflict, but both must not run.

## Retention
Defaults daily 30 / weekly 12 / monthly 12 / min-keep 7 (`BACKUP_RETENTION_*`). The report lists candidates only; deletion is manual in Drive until a later, reviewed change.

## Restore drill (disposable PostgreSQL only)
`BACKUP_GCM_KEY_B64=… node scripts/restore-encrypted-backup.mjs ARCHIVE TRUSTED_SHA256 postgres://…@127.0.0.1:PORT/DB` — refuses non-loopback/Neon hosts; `pg_restore --exit-on-error --single-transaction` (missing roles ⇒ atomic rollback). Use a separate restore identity; the backup identity is read-only and never restores. Orphans from a failed upload (files without a manifest) must be removed by hand.

## Measured (synthetic, local, 2026-10-22)
Synthetic DB 500 customers/5000 orders: backup→encrypt→verify OK; restore 0.12 s; row counts, sum, OWNER, ACL, SECURITY DEFINER identical; missing-role restore fails atomically (0 tables); wrong key and corrupted archive fail with no output file. H4 `test-h4-restore-roles` PASS on the 46-table H4 schema. **These are not RPO/RTO claims**: RPO is bounded by the schedule (not yet enabled), RTO for the real DB is unmeasured.
