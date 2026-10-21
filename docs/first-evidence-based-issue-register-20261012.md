# Ege Teknik — First evidence-based issue register (2026-10-12)

Scope: PR #22 code review, verified Neon QA catalog. No browser audit or production deploy was performed. These findings are not presented as live-site repros.

| ID | Severity | Status | Evidence | Remediation & acceptance |
| --- | --- | --- | --- | --- |
| SEC-PII-001 | P0 release blocker | CONFIRMED IN QA | QA role `ege_qa_storefront_login` granted full SELECT on orders, customers, addresses and order_legal_acceptances, with `relrowsecurity=false`. Client credential can query raw PII. | Design narrower SQL functions/RLS/separate credentials; negative tests prove public DB role cannot enumerate customer rows while replay and guest lookup remain functional. |
| SEO-META-001 | P2 / needs live URL confirmation | CODE FINDING | `app/layout.tsx` has global `metadata.title='Ege Teknik Yönetim'` and generic admin-only description. This is the default metadata; individual nested layouts may override it. | Inventory routes and rendered HTML for home/catalog/legal/admin; set route-specific metadata and correct canonical/sitemap where applicable. PASS only after generated title/meta verified per route. |
| QA-BROWSER-001 | P1 quality gate | COVERAGE GAP | package.json includes unit, PG integration and custom HTTP checkout E2E; `playwright.config.ts` and expected `tests/e2e/storefront.spec.ts` were not found at those exact paths. No full browser test evidence in this check. | Search all alternate test runners and actual route paths before concluding absence. Add Playwright desktop+390px flows, console/network errors, screenshots, accessibility checks, 404/500, broken link and navigation tests. |
| SEC-TXN-002 | P0 release blocker | NOT VERIFIED HERE | Real QA user passed ACL and nonexistent-product lock negatives; full synthetic checkout with stock, legal acceptance and idempotent replay not run in this session. | Isolated fixture, no payments/notifications, real scoped login, assert rollback and unchanged baseline records. |
| ADMIN-RBAC-003 | P1 release gate | REQUIRES FRESH BROWSER VALIDATION | Admin Pro PR integration present; prior tests user-supplied but no new authenticated browser evidence in this check. | Real desktop + mobile role checks, profitability denied for viewer via 403, Agrotech account remains active and restricted. |
| UX-SITE-004 | P1 audit | UNTESTED | No actual page screenshots or real interactive browser run yet. | Build full route matrix and prioritize reproducible visual/usability issues; WCAG 2.2 AA and web-vitals budget. |

Prioritized actions: SEC-PII-001, SEC-TXN-002, QA-BROWSER-001, ADMIN-RBAC-003, SEO-META-001, UX-SITE-004.

QA script: `scripts/qa-checkout-acl-readonly.sql` (must run with isolated QA endpoint and storefront user). Current verified negative lock check SQLSTATE 23514 PASS. Do not merge or deploy PR #22 from this report alone.
