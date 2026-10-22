# GDRIVE-03 isolated chain: runbook and minimum-privilege plan

Status: **prepared, not executed.** Production stays NO-GO. No real OIDC run, Drive write or IAM change has happened for this workflow.

Workflow: `.github/workflows/gdrive03-isolated-chain.yml` (manual, `main` only, environment `production-backup-test`).
Proof half: `scripts/gdrive03-verify-restore.mjs`. Synthetic data: `tests/fixtures/gdrive03-synthetic-seed.sql`. Tests: `tests/gdrive03-isolated-chain.test.mjs`.

## Separation from production

| Aspect | Production backup | GDRIVE-03 isolated chain |
|---|---|---|
| Environment | `production-backup` | `production-backup-test` (created, no secrets, `main` only) |
| Database | Neon production URL (repo secret) | Disposable `postgres:18` service container, invented rows |
| Encryption key | Repo secret | Generated per run, masked, never stored |
| Drive folder | `GDRIVE_BACKUP_FOLDER_ID` | `GDRIVE_TEST_FOLDER_ID` (new, separate folder) |
| WIF provider / service account | `GDRIVE_WIF_PROVIDER` / `GDRIVE_SERVICE_ACCOUNT` | `GDRIVE_TEST_WIF_PROVIDER` / `GDRIVE_TEST_SERVICE_ACCOUNT` (new) |
| Kill switch | `BACKUP_ENABLED` | not used and not readable by this workflow |

A static test fails the build if the workflow references any production secret, variable, folder, `BACKUP_ENABLED`, a pull-request/schedule trigger, or a non-loopback database.

## Environment variables still to be set (names only; all on `production-backup-test`)

`GDRIVE_TEST_FOLDER_ID`, `GDRIVE_TEST_WIF_PROVIDER`, `GDRIVE_TEST_SERVICE_ACCOUNT`. They are not set yet.

## Proposed Google Cloud changes (NOT applied; each needs separate approval)

| # | Change | Scope | Why |
|---|---|---|---|
| 1 | Create service account `gdrive03-test@<project>.iam.gserviceaccount.com` | new identity, no roles on any project | Separate identity from the production backup account |
| 2 | Add a **new** WIF provider (or pool) for GitHub with `attribute.repository == "mehmetcamofficial/Ege-Teknik-E-ticaret"`, `assertion.environment == "production-backup-test"` and `assertion.ref == "refs/heads/main"` | new provider; existing `github-actions` provider untouched | OIDC subject limited to the test environment on `main` |
| 3 | Grant `roles/iam.workloadIdentityUser` on the **test** service account only, to the principalSet for that environment | one binding on the new account | Lets the run impersonate only the test account |
| 4 | Enable the Drive API for the project if not already on | API enablement | Drive calls |

No role is granted to the test service account on the project. The existing provider, existing service account, its bindings and the production folder are not modified.

## Drive folder (not created yet)

Create a folder in a location unrelated to the production backup folder, named `ege-teknik-gdrive03-TEST (synthetic only - not production)`, with inherited permissions disabled. Share it with the test service account only, as the lowest role that can add files and read them back (Shared Drive Contributor, or Editor on a My Drive folder; Editor on My Drive can also delete, which the client never does). Never share it publicly or by domain: the uploader refuses such a folder.

## Execution plan (needs explicit approval at each external step)

1. Apply the Google Cloud changes above. 2. Create and share the Drive test folder. 3. Set the three environment variables. 4. Get the workflow onto `main` through a reviewed merge (GitHub only lists dispatchable workflows from the default branch). 5. Dispatch it. 6. Read the step results. 7. Clean up.

## Expected result lines

`drive_download`, `sha256_integrity`, `wrong_key_refused`, `tamper_refused`, `unauthorized_refused`, `decrypt_and_restore`, `data_integrity`, then `GDRIVE-03 CHAIN: PASS`. The upload step prints `GOOGLE DRIVE BACKUP: PASS`. Any failure prints a step name and a short code only.

## Cleanup

The workflow never deletes remote files. After the run the folder owner deletes the three `ege-teknik-synthetic-*` files in the test folder; the test service account, provider and folder can be removed or kept for repeat runs. The database and key exist only inside the runner.

## Local proof so far

`tests/gdrive03-isolated-chain.test.mjs` ran the whole chain locally against a scratch PostgreSQL 18 and an in-memory fake Drive: real `pg_dump`, GCM encryption, checksum, manifest, upload logic, download, decrypt, `pg_restore`, fingerprint comparison, plus wrong-key, tamper and corrupted-remote refusals. This does **not** prove OIDC, WIF, service-account permissions or real Drive behaviour.
