# GDRIVE-03: Drive folder safety codes and administrator evidence

Production stays NO-GO. This only concerns the isolated GDRIVE-03 chain.

## Why this exists
The first real run failed at the upload step with `folder_is_shared_publicly`. Drive does not return `permissions` for items in a Shared Drive
("Not populated for items in shared drives") and not to a caller who cannot share the item (the test service account is a Contributor). The old check
treated a missing list the same as a public folder. The two situations now have different codes, and a missing list is never accepted on its own.

## Codes (uploader, `lib/backup/drive-folder-safety.mjs`)

| Situation | Code | Outcome |
|---|---|---|
| Drive lists `anyone` or `domain` (direct or inherited) | `folder_is_shared_publicly` | refused, always, evidence cannot override it |
| Drive lists only `user`/`group` permissions | none | accepted (`api_permissions`) |
| List missing or empty, no evidence or no trust anchor | `folder_permissions_unavailable` | refused, nothing uploaded |
| Evidence unsigned, wrong key, edited, wrong version/kind, malformed, role is not `writer`, a finding is not a boolean | `folder_evidence_invalid` | refused |
| Evidence older than 7 days | `folder_evidence_expired` | refused |
| Evidence for another folder or another Shared Drive | `folder_evidence_mismatch` | refused |
| Verified evidence reports `anyone`/`domain` on the folder or the Shared Drive | `folder_is_shared_publicly` | refused |
| Verified, fresh, all four findings `false` | none | accepted (`admin_evidence`) |

## Collecting the evidence (Shared Drive manager, on their own machine)
Nobody asks for, receives or stores the administrator's password, OAuth token, signing key or a service-account key.

1. One-time: create a signing key pair that stays with the administrator.
   `openssl genpkey -algorithm ed25519 -out gdrive03-evidence.key` and `openssl pkey -in gdrive03-evidence.key -pubout -out gdrive03-evidence.pub`
2. Obtain a short-lived access token for your own account with the narrowest read scope (`drive.metadata.readonly` is enough) using a tool you trust, and put it in your own shell only:
   `export GDRIVE_ADMIN_ACCESS_TOKEN=...` (do not paste it into chat, tickets or this repository).
3. Run (read-only, GET requests only):
   `node scripts/gdrive03-admin-folder-evidence.mjs collect --folder-id <folder id> --service-account gdrive03-test@ege-teknik-backup.iam.gserviceaccount.com --sign-key gdrive03-evidence.key > evidence.b64`
   Exit code 0 = all four findings false. Exit code 2 = sharing was found: stop and fix the sharing; do not use that file.
4. Self-check: `node scripts/gdrive03-admin-folder-evidence.mjs verify --folder-id <folder id> --public-key gdrive03-evidence.pub < evidence.b64`
5. Hand the repository owner two PUBLIC values: the contents of `evidence.b64` and of `gdrive03-evidence.pub`.

The evidence holds counts, the Shared Drive id, a timestamp and four booleans (`folder_anyone`, `folder_domain`, `drive_anyone`, `drive_domain`).
It contains no e-mail address, token or secret.

## Environment variables (repository owner sets them on `production-backup-test`; not set by this change)
- `GDRIVE_TEST_FOLDER_EVIDENCE` = contents of `evidence.b64`
- `GDRIVE_TEST_EVIDENCE_PUBKEY` = contents of `gdrive03-evidence.pub`

The public key is the trust anchor and lives outside the code, so changing it needs repository admin rights, not just a reviewed pull request.

## Limits of this proof
- It is a snapshot at `observed_at`. Sharing changed afterwards is not detected until the evidence expires (7 days) or the public key variable is replaced; collect fresh evidence before each run.
- It proves no `anyone`/`domain` permission on the folder and on the Shared Drive at that moment, and that the test service account is a plain `writer` (Contributor).
- It does not replace the uploader's other checks (identity, folder type, writable, no overwrite).
