# GDRIVE-03 GCP identity plan

Status: **NOT APPLIED. Provider and binding creation is BLOCKED** until the `job_workflow_ref` claim is confirmed in a real GitHub OIDC token (see "Verification status"). Production stays NO-GO.

## Verification status (read-only, 2026-10-22, account with roles/owner)

| Item | Result |
|---|---|
| Project `ege-teknik-backup`, number 186271281412, ACTIVE | Verified |
| Pools | One: `ege-teknik-github-backup` (ACTIVE). No `ege-teknik-gdrive03-test` yet |
| Service accounts | One: `ege-teknik-backup-uploader`. No `gdrive03-test` yet |
| Production provider `github-actions` | ACTIVE; condition pins repository, repository_id, repository_owner_id, `refs/heads/main`, environment `production-backup` and an exact `sub` string |
| Production SA binding | `workloadIdentityUser` for principalSet `attribute.repository_id/1378579933` (repo-wide: not narrowed to environment or ref; the provider condition does the narrowing) |
| APIs enabled | drive, iam, iamcredentials, sts |
| `job_workflow_ref` format in a real token | **Unverified.** GitHub docs only show the example `OWNER/REPO/.github/workflows/FILE@REF` and describe the claim for reusable workflows. No OIDC run has ever happened in this repository |

Findings to review (nothing was changed):
1. `ege-teknik-backup-uploader` holds `roles/owner` on the project. A production backup identity should not be an owner. The new test account must not be given any project role.
2. The repository's OIDC subject template has `use_immutable_subject: true`. With it, `sub` carries owner/repo IDs (`repo:OWNER@ID/REPO@ID:...`). The production provider condition compares `sub` to the ID-less string, so the production chain may fail closed. This is only provable with a real token. The new provider deliberately does not compare `sub`.

## New resources (names fixed)
- Pool:      ege-teknik-gdrive03-test            (global)
- Provider:  github-actions-gdrive03            (OIDC, issuer https://token.actions.githubusercontent.com, default allowed audience)
- Service account: gdrive03-test@ege-teknik-backup.iam.gserviceaccount.com   (production one is ege-teknik-backup-uploader; untouched)

## Commands (to run only after approval, by an account with the admin roles below)
gcloud iam service-accounts create gdrive03-test --project=ege-teknik-backup --display-name="GDRIVE-03 synthetic test (no project roles)"
gcloud iam workload-identity-pools create ege-teknik-gdrive03-test --project=ege-teknik-backup --location=global --display-name="GDRIVE-03 test"
gcloud iam workload-identity-pools providers create-oidc github-actions-gdrive03 --project=ege-teknik-backup --location=global \
  --workload-identity-pool=ege-teknik-gdrive03-test --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.gd03=assertion.repository_id+':'+assertion.environment+':'+assertion.ref" \
  --attribute-condition="assertion.repository_id=='1378579933' && assertion.repository_owner_id=='73923157' && assertion.environment=='production-backup-test' && assertion.ref=='refs/heads/main' && assertion.event_name=='workflow_dispatch' && assertion.job_workflow_ref=='mehmetcamofficial/Ege-Teknik-E-ticaret/.github/workflows/gdrive03-isolated-chain.yml@refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding gdrive03-test@ege-teknik-backup.iam.gserviceaccount.com --project=ege-teknik-backup \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/186271281412/locations/global/workloadIdentityPools/ege-teknik-gdrive03-test/attribute.gd03/1378579933:production-backup-test:refs/heads/main"
gcloud services list --enabled --project=ege-teknik-backup | grep drive.googleapis.com   # enable only if absent

## Why the binding enforces the same limits as the condition
Two layers: the provider condition rejects any token that is not repo 1378579933 + environment production-backup-test + main + dispatch + this workflow file.
The binding's principalSet matches only the composite attribute gd03 = "<repo_id>:<environment>:<ref>", so even a token that somehow passed another provider cannot
impersonate the test account. The binding exists on the test service account only; nothing is bound on the production account, no project-level role is granted.
workloadIdentityUser includes getAccessToken, which `token_format: access_token` needs; no serviceAccountTokenCreator is required.
A new pool (not a new provider in the existing pool) keeps the production pool untouched.

## Not granted to the test service account
No project roles. No Cloud SQL, Neon, Secret Manager, Storage or IAM permission. Drive access comes only from the folder share.

## Variables on GitHub environment production-backup-test (exact format; values are not secrets)
GDRIVE_TEST_WIF_PROVIDER    = projects/186271281412/locations/global/workloadIdentityPools/ege-teknik-gdrive03-test/providers/github-actions-gdrive03
GDRIVE_TEST_SERVICE_ACCOUNT = gdrive03-test@ege-teknik-backup.iam.gserviceaccount.com
GDRIVE_TEST_FOLDER_ID       = Drive folder id, matches ^[A-Za-z0-9_-]{10,200}$ (usually 33 chars), folder NOT the production one

## Drive folder access plan
Preferred: folder inside a Shared Drive, test service account as Contributor (add files, no delete); owner/admins unchanged. Fallback: My Drive folder shared with the
service account e-mail as Editor (can delete; the client never does). No "anyone" or domain link (the uploader refuses such a folder). Inherited permissions disabled on creation.

## Roles needed
To VERIFY (read-only, narrowest single role covering project get, pool/provider get, SA getIamPolicy): roles/iam.securityReviewer on ege-teknik-backup.
To APPLY: roles/iam.workloadIdentityPoolAdmin + roles/iam.serviceAccountAdmin (create SA and set its policy), on the project.

## Rollback
gcloud iam service-accounts remove-iam-policy-binding ... (same member/role); gcloud iam workload-identity-pools providers delete github-actions-gdrive03 ...;
gcloud iam workload-identity-pools delete ege-teknik-gdrive03-test ...; gcloud iam service-accounts delete gdrive03-test@... . Production pool, provider, account and folder are never touched.
