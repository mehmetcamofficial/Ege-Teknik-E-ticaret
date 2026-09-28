# Rollback runbook

Principle: **application rollback is cheap and safe; database rollback is not.** Migrations are forward-only. Do not design or run
DROP-based reversals. Prefer forward fixes; restore a database only with explicit owner authorization.

## 1. Application rollback (first choice)

Restore the previously verified Production deployment:

1. Identify it from Vercel deployment metadata (id, SHA, `target=production`, `READY`). The id of the last known-good deployment is recorded in the release notes.
2. Promote/rollback to it (`vercel rollback <deployment-id>` or redeploy it with `--target=production`).
3. Verify: `/api/health` (production, correct branch), public smoke, admin login redirect boundary.

An older application is only safe on a newer schema when the migration was additive. Check the compatibility note of the release before rolling back after a migration.

## 2. Compatibility matrix (Production history)

| Application | Database | Status |
|---|---|---|
| older | older | consistent |
| older | newer (additive migration) | works; new columns have defaults, new tables are unused |
| newer | older | **forbidden** - the release order (migrate first, deploy second) exists to prevent this |
| newer | newer | target |

Known exception: migration 0011 converts the legacy `owner` role to `super_admin`. An application older than the RBAC release does not know
`super_admin`; its admin routes error for that account (the public storefront is unaffected). Keep that window short.

## 3. Migration failed

The migrator applies pending migrations in **one transaction**. On error the database stays at the previous ledger state. Do not retry;
verify read-only (ledger, schema, counts), report, and fix forward in a new reviewed change.

## 4. Migration succeeded but the result is wrong

STOP; do not deploy the new application, do not run compensating SQL. Preserve evidence (read-only queries). Options, each needing explicit authorization:

- **Forward fix:** a new migration (never edit 0000-0012; `pnpm verify:migrations` blocks that).
- **Restore from the recovery branch** created before the release (`pre-<release>-production-<date>`) or from Neon point-in-time restore inside the
  retention window. A restore or re-parenting replaces live data: it is a business decision, never an automatic step.

## 5. Bad data written by the new application

Take the affected feature out of use (application rollback or a feature switch such as `ANALYTICS_ENABLED`), then repair data with a reviewed,
transactional, audited script run under the release procedure - not ad hoc.

## 6. After any rollback

Re-run the release verification steps 6.1-6.5, write down what happened and open a technical-debt item for the root cause.
