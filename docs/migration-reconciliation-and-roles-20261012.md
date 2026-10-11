# Ege Teknik — migration reconciliation and scoped-role gate (2026-10-12)

Status: **READ-ONLY INVENTORY COMPLETE; DB ROLE ROLLOUT BLOCKED.** No production or Preview SQL mutations performed.

## Source graph
- `release/ege-teknik-canonical`: migrations 0000–0015; the legal PRs #6–#16 were merged into this release lineage.
- `security/legal-documents-immutability-0016`: 0000–0016, PR #17 open.
- `security/db-scoped-pools-foundation`: 0000–0016, PR #18 open; opt-in role connection logic, not an activation.
- `security/checkout-product-lock-0017`: 0000–0018, PR #19 open.
- `integration/et-sec-03-superadmin-lock-order`: 0000–0016, PR #20 open.
- `feature/profitability-ai-gateway-20261012`: 0000–0013, PR #21 draft; based on `quality/storefront-v2-next`, NOT canonical.
- `main` is behind the canonical release branch. NEVER merge PR #21 straight to main or Production.

## Live Neon journal (read only)
- Production `br-nameless-grass-aw9qpndy`: `drizzle.__drizzle_migrations` has **14 rows / IDs 1–14** (0000–0013).
- Preview `br-nameless-mountain-awib28a9`: **19 rows / IDs 1–19** (0000–0018). Journal timestamps match the ordered version tags in the GitHub migration journal, but migration hash / schema parity has not yet been independently validated.
- No `product_cost_profiles` table found in Preview. No new cost schema can be safely rolled out as part of this reconciliation.

## Preview PostgreSQL role exposure
Live `pg_roles` / `pg_auth_members` / `has_table_privilege` checks showed:
- `ege_preview_storefront_lp`: LOGIN, NOINHERIT, SELECT products=yes, SELECT admin_users=no, SELECT legal_documents=yes.
- `ege_preview_admin_lp`: LOGIN, NOINHERIT; currently SELECT products=no, admin_users=no, legal_documents=no. This connection is not yet a ready-to-use admin runtime.
- `ege_preview_storefront`: LOGIN, INHERIT, member of `neon_superuser`; SELECT admin_users=yes. **Do not use as a restricted storefront role.**
- `ege_teknik_preview_app`: LOGIN, INHERIT, member of `neon_superuser`; SELECT admin_users=yes.
- `ege_teknik_preview_runtime`: NOLOGIN, NOINHERIT, SELECT products=yes, admin_users=no.
- `neondb_owner`: owner connection, not acceptable as a restricted runtime.

No privilege was revoked or granted, and no connection strings or passwords were fetched. `has_table_privilege` is an entitlement check, not a live login credential test. Do not treat these roles as proven least-privilege in production.

## Safe integration sequence (must all pass)
1. Build a **new integration branch from the authoritative canonical/security release tip**, retaining *all* merged legal features. Determine exact merge order for security PRs #17–#20 (0016 then 0017/0018 plus superadmin lock-order). Resolve conflicts explicitly and run full diff review.
2. Reapply/cherry-pick PR #21's Admin Pro UI + AI-disabled feature onto that branch, with GitHub compare + full tests. Preserve migrations 0000–0018 and avoid duplicate numbers or deleting legal evidence paths.
3. Use a **disposable, isolated Neon child branch** to validate schema and role ACLs. Check WITH LOGIN privileges as the real runtime users (not owner), inherited memberships, public-schema privileges, legal and checkout lock behavior, grant matrix, database function privileges and negative queries against admin user / cost records.
4. Replace the old broad Preview roles with verified narrowly granted, separately credentialed storefront and admin roles only under an explicitly approved staged cutover. Verify endpoints and rollback credentials/connection strategy first. Never revoke roles live as a speculative fix.
5. Run full typecheck, lint, unit/PG/checkout/legal tests and migrations, including 0016–0018. Compare Preview and Production schema/drizzle journals; confirm no unintended schema drift or data-loss operations.
6. Confirm AI remains OFF. Provider-side currency-denominated budget limit and live negative tests are separate activation gates. Never promote Production automatically.
7. After evidence is collected, request Production rollout approval with immutable deployment SHA and recovery plan. Existing Preview test account `infoagrotechinsights@gmail.com` remains active by user request.

**Decision:** legal and other merged work must be included in the canonical-based release; role separation and Production promotion currently **NO-GO** until ACL/runtime negative tests and integration build are performed.
