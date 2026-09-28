# Branch protection and commit-signing policy (recommendation)

These are GitHub repository settings; they cannot be enforced from the repository itself. Apply them on the release branch (`main`) and on any long-lived release branch.

## Required status checks (from `.github/workflows/ci.yml`)

Require these four checks to pass, on an up-to-date branch, before merging:

| Check | Proves |
|---|---|
| `quality` | lint, typecheck, full hermetic test suite |
| `postgres-integration` | the concurrency-sensitive SQL on a real PostgreSQL 18 (fails if any test is skipped) |
| `build` | production build succeeds and leaves the tree untouched |
| `migration-safety` | 0011/0012 hashes and frozen migrations 0000-0012 unchanged; migration/bootstrap safety tests |

## Rules

- Require a pull request before merging; at least one approving review; dismiss stale approvals on new commits; require conversation resolution.
- Require branches to be up to date; no bypass for administrators; block force pushes and branch deletion.
- Restrict who can push to `main`; prefer squash or rebase merges (linear history).
- Add `CODEOWNERS` entries for `drizzle-pg/`, `.github/`, `scripts/migrate*`, `lib/security-policy.ts`, `lib/admin-auth.ts` and `docs/operations/`.
- Workflow hygiene: keep `permissions: contents: read`; review any change to `.github/workflows/` as security-sensitive (a policy test fails on `pull_request_target`, secrets, deploys or `continue-on-error`).
  Consider pinning `actions/*` to commit SHAs and enabling Dependabot for Actions.
- A deployment is never triggered by CI. Production release follows [release-runbook.md](release-runbook.md).

## Commit signing

- **Do not rewrite history to sign old commits.** Existing unsigned commits (including the recovery/import commits that were pushed) stay exactly as they are:
  rewriting would change SHAs that Production deployments, runbooks and recovery records reference.
- **Going forward:** maintainers sign new commits (SSH or GPG signing). Enable GitHub's "Require signed commits" on `main` only after every
  maintainer and every automation identity that pushes has a working signing setup; until then, signature status is informational.
- Commits made by automation or agents on feature branches may be unsigned; the merge into `main` (squash/merge commit created by GitHub or a signing maintainer) is the signed record.
- Never rebase or amend published commits to attach a signature.
