# GDRIVE-03 GCP identity (isolated test)

Status: **GCP identity resources CREATED and read back (2026-10-22). Real OIDC, Drive write and restore are still NOT run (BLOCKED). Production stays NO-GO.**

Project `ege-teknik-backup` (number 186271281412). GitHub: repository `mehmetcamofficial/Ege-Teknik-E-ticaret`, repository_id 1378579933, owner_id 73923157.

## Created resources (existing production resources untouched)

| Resource | Name |
|---|---|
| Service account | `gdrive03-test@ege-teknik-backup.iam.gserviceaccount.com` (no project roles, no user-managed keys) |
| Workload Identity Pool | `ege-teknik-gdrive03-test` (ACTIVE) |
| Provider | `github-actions-gdrive03` (ACTIVE, issuer `https://token.actions.githubusercontent.com`, default audience) |
| Binding | `roles/iam.workloadIdentityUser` on the test service account only |

Provider attribute condition (all must hold):
`repository == 'mehmetcamofficial/Ege-Teknik-E-ticaret' && repository_id == '1378579933' && repository_owner_id == '73923157' && ref == 'refs/heads/main' && environment == 'production-backup-test' && event_name == 'workflow_dispatch'`

Attribute mapping: `google.subject=assertion.sub` (never compared to a fixed string, so GitHub's immutable-subject format works), `attribute.repository_id`, `attribute.repository_owner_id`, `attribute.environment`, `attribute.ref`, `attribute.event_name`, and the composite
`attribute.gd03 = repository_id:repository_owner_id:environment:ref:event_name`.

Binding member (accepted by Google Cloud):
`principalSet://iam.googleapis.com/projects/186271281412/locations/global/workloadIdentityPools/ege-teknik-gdrive03-test/attribute.gd03/1378579933:73923157:production-backup-test:refs/heads/main:workflow_dispatch`

The binding repeats owner ID, repository ID, environment, ref and event, so it does not rely on the provider condition alone.

## Deliberate deviation
`job_workflow_ref` is **not** part of the condition: its format could not be confirmed in a real OIDC token (none exists yet). Consequence: any workflow in this repository that runs on `main`, via `workflow_dispatch`, in environment `production-backup-test` could obtain the test identity. The environment only allows `main` and holds no secrets. Re-add `job_workflow_ref` after a real token has shown its value.

## Not granted
No project role, no Cloud SQL, Neon, Secret Manager or Storage access, no service-account key. Drive access comes only from sharing the Drive test folder with the service account.

## GitHub environment variables (NOT set yet; environment `production-backup-test`)
- `GDRIVE_TEST_WIF_PROVIDER` = `projects/186271281412/locations/global/workloadIdentityPools/ege-teknik-gdrive03-test/providers/github-actions-gdrive03`
- `GDRIVE_TEST_SERVICE_ACCOUNT` = `gdrive03-test@ege-teknik-backup.iam.gserviceaccount.com`
- `GDRIVE_TEST_FOLDER_ID` = Drive folder id, `^[A-Za-z0-9_-]{10,200}$`, not the production folder

## Drive folder access plan
Preferred: a folder inside a Shared Drive, the test service account as Contributor (add files, no delete). Fallback: My Drive folder shared with the service account as Editor (can delete; the client never does). No "anyone" or domain sharing (the uploader refuses such a folder). Inherited permissions disabled on creation.

## Rollback (test resources only)
`gcloud iam service-accounts remove-iam-policy-binding` (same member and role), then delete provider `github-actions-gdrive03`, pool `ege-teknik-gdrive03-test` and service account `gdrive03-test`.

## Open security findings (recorded, not changed)
1. **Production backup identity is project owner.** `ege-teknik-backup-uploader` holds `roles/owner`. Its `workloadIdentityUser` binding is repository-wide (`attribute.repository_id`); the provider condition does the narrowing.
2. **Possible production immutable-subject mismatch (BLOCKED, unproven).** The repository's OIDC template has `use_immutable_subject: true`, so `sub` carries owner/repository IDs, while the production provider compares `sub` to an ID-less string. May fail closed; provable only with a real token.

## Still BLOCKED
Drive test folder and `GDRIVE_TEST_*` variables, workflow on `main`, real OIDC run, Drive write, download/decrypt/restore proof, `job_workflow_ref` confirmation.
