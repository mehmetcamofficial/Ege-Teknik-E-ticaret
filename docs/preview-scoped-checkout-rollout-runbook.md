# Ege Teknik — Preview scoped-checkout rollout runbook (APPROVAL REQUIRED)

**Status: PLAN ONLY.** Prepared 2026-10-10. This document is not permission to run a migration, create a database user, change Vercel environment variables, merge a PR, or deploy. Production is explicitly out of scope.

## Verified gates

- Draft PR stack: [#17](https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/pull/17) → [#18](https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/pull/18) → [#19](https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/pull/19). All are unmerged.
- [CI 38000674472](https://github.com/mehmetcamofficial/Ege-Teknik-E-ticaret/actions/runs/38000674472), PR #19 HEAD `37f9bd40b7073b4fa72e77519a007d18e0c9eeb9`: **quality, build, migration-safety, postgres-integration SUCCESS**. Disposable PostgreSQL 18: **22/22 integration + 38/38 commerce**; actual local Next.js HTTP E2E passed valid preview/order, evidence, stock reservation, idempotent replay/conflict, missing/tampered/expired token, stale price, out of stock, marketing refusal, **stale legal version**, **legacy flag OFF**, and **invalid scoped credentials fail-closed**.
- Neon project: `silent-waterfall-20869858`; **active Preview only** branch `br-nameless-mountain-awib28a9`, DB `neondb`. Read-only 2026-10-10: 17 Drizzle ledger entries (0000–0016), 16 orders, `lock_checkout_products(text[])` absent. The 0015 `order_legal_evidence_guard()` is SECURITY INVOKER, owned by `neondb_owner`.
- **Production branch `br-nameless-grass-aw9qpndy` must never be targeted** by this runbook.
- Existing Preview role `ege_teknik_preview_runtime`: NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, NOINHERIT. It cannot be used as an application connection until an explicitly authorized LOGIN strategy is chosen.
- Existing `ege_teknik_preview_app` has LOGIN, CREATEDB, CREATEROLE, BYPASSRLS, INHERIT; **do not use it as a restricted checkout role**.
- Neon currently lists 10 branches. Do not assume another snapshot branch can be created without checking plan limits/capacity. The separate `br-square-pond-aw0g8gus` is an **old isolated test branch**, not a fresh rollback point for active Preview; 0017 was applied there manually without updating its Drizzle ledger.

## Phase 0 — approval and immutable scope

1. Obtain explicit approval for **active Preview only**, stating the exact Neon project/branch/database and exact operations (backup, migrations 0017–0018, roles/grants, Preview Vercel environment changes). Approval for one operation is not blanket approval for subsequent operations.
2. Freeze the target PR commit SHA and confirm all three PRs are reviewed, merge strategy/deployment artifact is defined, and CI for that exact SHA is green. A passing Draft PR does **not** mean its code is deployed.
3. Verify Preview Vercel `APP_ENV=preview`, `NEON_BRANCH_ID=br-nameless-mountain-awib28a9`, and `EXPECTED_NEON_PREVIEW_BRANCH_ID` match, **without reading or printing secret values**. Confirm `DATABASE_URL` points to this Preview branch and `CHECKOUT_SCOPED_DB_ENABLED` is unset or `false`.
4. Schedule a short maintenance/test window. Use synthetic orders only in a deliberately isolated QA environment, not active Preview containing real orders.

## Phase 1 — backup gate (NO MIGRATION BEFORE VERIFIED RESTORE)

1. Recheck branch ID, database name, migration ledger count/hash, table counts and relevant function definitions read-only. Stop if anything differs from the baseline unexpectedly.
2. Obtain a **new timestamped, encrypted PostgreSQL custom-format backup** of the exact active Preview DB to a private location. Do not put credentials or backup data in Git, CI logs or this document. A historical 0015–0016 backup is not sufficient for 0017–0018.
3. Compute SHA-256, verify file size, and **restore the backup to a disposable PostgreSQL 18 database**. Verify migration ledger, counts and legal-evidence constraints against the restore. Record the backup identifier, SHA-256, restore result and owner outside the repo.
4. If using a Neon branch as an additional snapshot, create it **only after explicit authorization**, confirm it forks the exact Preview branch at the intended point, and verify plan branch capacity. It supplements rather than replaces the independent dump/restore test.
5. STOP if the backup or restore verification fails.

## Phase 2 — migration gate (APPROVAL REQUIRED)

1. Ensure the release artifact includes the stacked code and journal entries 0017 and 0018. Use the repository's **standard Drizzle migrator** against the exact active Preview connection **once**; do not paste raw 0017/0018 SQL and then rerun the migrator. The manually modified isolated test branch is not a migration-ledger reference.
2. Expected ledger: 19 entries (0000–0018). Verify 0017 `public.lock_checkout_products(text[])` exists, is SECURITY DEFINER, has a fixed search path, and PUBLIC has no EXECUTE.
3. Verify 0018 `public.order_legal_evidence_guard()` is SECURITY DEFINER, owned by the expected trusted migration owner, search path `pg_catalog, public, pg_temp`, and PUBLIC has no EXECUTE. **Review its existing 0015 trigger body and schema CREATE privileges before applying a privileged definer.**
4. Verify existing orders, order items, legal acceptance counts and hashes are unchanged; no unintended data rewrite. If any postflight assertion fails, leave the scoped checkout feature OFF and escalate; do not run speculative repair SQL.

## Phase 3 — least-privilege LOGIN roles (SEPARATE APPROVAL)

1. Create **two distinct, dedicated, non-superuser LOGIN roles** for Preview storefront and admin, with unique random passwords in the approved secrets manager. Do not reuse `neondb_owner`, `ege_teknik_preview_app`, `DATABASE_URL` credentials, or turn an existing NOLOGIN role into LOGIN without an explicit access review.
2. Storefront grants must be based on the **verified disposable restricted LOGIN test** and reviewed against real Preview schemas: necessary SELECTs; INSERT on customers, addresses, orders, order_items, order_legal_acceptances and rate_limit_buckets; column-level UPDATE on inventory and rate_limit_buckets; necessary DELETE on rate_limit_buckets; narrow legal_documents row-lock permission (the 0016 immutability guard protects identity/created_at); EXECUTE on `lock_checkout_products(text[])`. **No UPDATE on orders (including columns), no UPDATE on products, no DDL, no elevated role membership.**
3. Confirm any required sequence, schema, FK, trigger, and legal-document privileges explicitly; fail closed if an operation requires a broad grant. For the admin role, inventory every admin route and derive a separate ACL policy before enabling any admin scoped path. `getAdminDb()` exists but **admin route migration is not part of this checkout canary**.
4. Using separate LOGIN connections, assert `current_user`, `rolsuper=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolbypassrls=false`, product/order UPDATE denied, and checkout function EXECUTE allowed. Never expose passwords in logs or PR comments.

## Phase 4 — staged Preview application activation (SEPARATE APPROVAL)

1. Deploy/release the exact reviewed stacked application code to a **controlled Preview deployment** only, with the flag **OFF**. Confirm environment and branch guards and perform read-only smoke tests. No Production deployment.
2. Set `STOREFRONT_DATABASE_URL` and `ADMIN_DATABASE_URL` as protected **Preview-only** secrets pointing to the same branch/database as the legacy `DATABASE_URL`, but different dedicated role usernames. Verify host/DB consistency and no secret exposure. Both are required by `resolveScopedDatabaseUrl`, even though only storefront checkout is activated.
3. With `CHECKOUT_SCOPED_DB_ENABLED=false`, verify existing checkout behavior. Then, in a separately approved controlled Preview release, set `CHECKOUT_SCOPED_DB_ENABLED=true` and run legal-preview + order-path smoke tests against **synthetic, non-sensitive** fixtures under an authorized QA process. Observe HTTP errors, rate limits, legal evidence, order totals and stock integrity.
4. If any scoped connection fails, **do not grant extra privileges reflexively** and do not silently fall back to owner credentials. Record the missing privilege, assess and test the smallest change in disposable CI before another approval.

## Immediate rollback and data recovery

- **Fast operational rollback:** set the **Preview-only** flag back to `false` and redeploy the last reviewed Preview build; keep migrations in place (0017–0018 are additive/trigger-metadata changes) while investigating. Confirm requests use the legacy path and validate order/stock integrity. This does **not** remove already-written orders.
- **Credential incident:** disable/rotate the affected dedicated LOGIN credentials with an approved coordinated change; leave flag OFF. Never rotate or alter Production credentials.
- **Database restore:** a full restore overwrites current data and can lose orders placed since the backup. **Never restore active Preview or reverse 0018's SECURITY DEFINER status automatically.** A database restore or down-migration requires a separate incident decision, write freeze, comparison of intervening orders/evidence, verified restore plan and explicit authorization.
- **Stop criteria:** unexpected branch ID, backup mismatch, migration checksum/ledger mismatch, privileged runtime connection, legal-evidence mismatch, unauthorized writes, secret leakage, HTTP 500/409 regression, inventory mismatch, or unexplained trigger behavior.

## Sign-off record (fill in only after authorized execution)

| Gate | Result | Evidence |
| --- | --- | --- |
| Exact PR HEAD and CI | PASS at `37f9bd4` | Actions 38000674472 |
| Fresh Preview backup and offline restore | NOT RUN | — |
| 0017–0018 on active Preview | NOT RUN | — |
| Preview LOGIN roles and ACLs | NOT RUN | — |
| Preview deployment and scoped OFF smoke | NOT RUN | — |
| Preview scoped ON canary | NOT RUN | — |
| Production | OUT OF SCOPE | Do not modify |
