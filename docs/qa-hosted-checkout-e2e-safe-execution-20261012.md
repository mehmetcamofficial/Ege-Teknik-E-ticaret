# ET-QA-CHECKOUT-E2E-01 — Existing Neon QA safe HTTP execution gate

Date: 2026-10-12. Status: **PREPARED / NOT EXECUTED**.

## Environments and hard stops
- Repository: `mehmetcamofficial/Ege-Teknik-E-ticaret`, draft PR #22, `integration/admin-pro-legal-security-20261012`.
- QA-only Neon branch `br-delicate-frost-awnf26nw`, DB `neondb`; baseline migrations=20, orders=16, products=88. Never connect Production `br-nameless-grass-aw9qpndy` or active Preview `br-nameless-mountain-awib28a9`.
- CI #161 4/4 PASS, including real HTTP checkout against **disposable loopback PostgreSQL**; it does NOT establish HTTP E2E against hosted Neon QA.
- **DO NOT RUN** `scripts/test-checkout-http-e2e.mjs` against any Neon database. This CI runner resets/drops `public` and `drizzle` schemas. It intentionally refuses non-loopback/non-`sprintb` URLs.
- No production deploy, live payment, email, SMS, WhatsApp, real customer data or live admin creation.
- Do not change CHECKOUT_SCOPED_DB_ENABLED in any active Preview/Production deployment.

## Gate 1 — preflight (read-only)
1. Confirm project, QA branch ID, database, role, migration count, version hash and production/Preview isolation.
2. Verify QA storefront `customers`, `addresses`, `orders`, `order_items`, `order_legal_acceptances` direct SELECT denied in real login. Confirm INSERT and `checkout_replay_by_key(text,text)` EXECUTE.
3. Inspect existing QA data and non-PII aggregate baselines, rate-limit buckets, inventory version/stock aggregates; no modification. Ensure synthetic data IDs and idempotency keys do not conflict.
4. Review every outbound integration and worker side effect in checkout path. Disable or stub external payment, email, SMS, WhatsApp, analytics and Sentry in the isolated test server; verify flag resolution.
5. Review full test harness before use: no schema DROP/TRUNCATE, no global DELETE, no UPDATE of customer/real inventory, no uncontrolled seed, and no secret logging. Require a dedicated synthetic product and stock and unique namespaced IDs.
6. Confirm a QA-only application process/deployment points every DATABASE_URL, STOREFRONT_DATABASE_URL, ADMIN_DATABASE_URL to the **same QA branch** and use distinct DB roles. Never print credentials or run against active Preview.

## Gate 2 — execution (requires isolated QA app + disposable/synthetic fixture and explicit review)
- Create a fixture namespace `qa-e2e-<random>` only after confirming schema, required FKs, metadata and product consistency. Prefer rollback or QA-only disposable child branch; never reuse real Gree stock. If using child branch, check branch quotas and authorization first.
- Checkout legal-preview HTTP 200, required legal document IDs and no DB write.
- Checkout HTTP 201: one order, customer, address, order item(s), two verified legal evidence records, exactly one stock reservation.
- Same idempotency key + same request: HTTP 200, identical response and one total order, no new reserve.
- Same key + different request fingerprint: HTTP 409 `IDEMPOTENCY_KEY_REUSED`, no PII in response, no new reserve.
- Invalid/expired/stale/missing signed legal preview: fail closed, zero partial rows, unchanged stock.
- Out-of-stock: HTTP 409, transaction rollback verified.
- Malformed product ID or missing published product: reject without mutation.
- Check SQL logs for unexpected 42501/23514, timeout/deadlock, secrets or raw legal body leaking.
- Direct restricted-role SELECT returns 42501 for orders, order_items, order_legal_acceptances, customers, addresses; unknown key returns NULL; wrong fingerprint returns only `{conflict:true}` and nothing else.
- Concurrent same-key and competing-stock checkout attempts require stable count and no double reservations.
- Verify response schema does not contain internal DB row IDs, customerId, addressId, idempotencyKey or rendered legal document bodies; legal acceptance summaries consistent.
- Compare before/after baselines and clean **only precisely enumerated synthetic fixtures** once safe to remove. No blanket DELETE or TRUNCATE. Record PASS/FAIL/BLOCKED with URLs (loopback-only where feasible), logs, timestamp, commits and snapshots.

## Gate 3 — release decision
- If any test fails, leave Production and active Preview unchanged. Restore synthetic fixture cleanly and open issue with evidence.
- This run does NOT greenlight payment provider, Admin Pro browser acceptance, performance or production deployment.
- Next UI/UX program begins with safe browser-only navigation audit once backend E2E and role security are covered.

## Current blockers
- No running QA-only HTTP application endpoint with its complete isolated scoped DB environment is established in this audit.
- Current Neon QA contains 16 orders, so it must not be reset or used by destructive CI bootstrap.
- No transactional synthetic fixture execution in hosted QA has been performed yet.
