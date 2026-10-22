# Ege Teknik — World-Class Storefront & Admin Quality Program (2026-10-12)

Status: **AUDIT/PLAN ONLY**. Not approval to change Production, active Preview, payment processing, secrets, existing orders or customer data. Execute against isolated QA and an authorized Preview after explicit approvals.

## Current state and security gate
- Repository: `mehmetcamofficial/Ege-Teknik-E-ticaret`, integration draft PR #22, head `integration/admin-pro-legal-security-20261012`.
- QA-only Neon branch `br-delicate-frost-awnf26nw`; active Preview `br-nameless-mountain-awib28a9` and Production `br-nameless-grass-aw9qpndy` untouched.
- Real PostgreSQL login storefront/admin: PASS, Storefront admin_users read denied. Products 88 and legal_documents 7 readable by storefront. Column grants confirmed. Legal documents immutable guard attempted UPDATE(created_at) triggered SQLSTATE 23514 and ROLLBACK: PASS. `lock_checkout_products(['__qa_nonexistent_product_20261012__'])` raised 23514: PASS (user console output).
- **Open release blocker**: Storefront DB credential has full SELECT on `orders`, `customers`, `addresses`, `order_legal_acceptances` and RLS disabled. Need reduce data exposure via narrower read functions, RLS, separated DB role/queries. Existing order replay/lookup queries may require precise changes.
- **Not verified yet**: real QA synthetic checkout transaction, inventory rollback, legal evidence complete, accepted hash fidelity, idempotent replay/conflict, HTTP E2E with scoped role, full mobile flows. No production release.
- Reminder: `CHECKOUT_SCOPED_DB_ENABLED` OFF, AI financial adviser OFF, payments unapproved.

## Core product vision
Ege Teknik: premium yet trustworthy, local HVAC service retailer for Aegean region. Customers should discover, compare, choose, request site survey/installation, and buy where payment availability makes it valid. Product/stock and legal authority always from server. No dark patterns; no fake reviews, invented energy savings, unsupported warranty claims or fake stock.

## Benchmark sources (external; patterns, not copied designs)
1. Daikin product-fit wizard: https://www.daikin.eu/en_us/product-fit-wizard/heating-and-cooling.html — question-driven selection by climate, installation style and room count.
2. Daikin Türkiye catalog: https://www.daikin.com.tr/klimalar — BTU, noise, energy class, features, model comparisons; adopt relevant facets only when backed by Gree data.
3. Samsung SmartThings: https://www.samsung.com/tr/smartthings/ — device-centric comfort/energy storytelling; do NOT imply Ege Teknik or Gree integration without proof.
4. Baymard product filters: https://baymard.com/research-articles/current-state-product-list-and-filtering — active filters, multi-select facets, essential sort, thumbnails.
5. Baymard checkout: https://baymard.com/research-articles/current-state-of-checkout-ux — prominent guest checkout, specific field errors, clear phone purpose, transparent fulfillment.
6. Stripe checkout UX: https://stripe.com/resources/more/checkout-screen-best-practices — clear totals, trust, adaptive error and uncomplicated mobile form.
These are researched ideas, not a live UX score of the current site.

## Stage 0 — Security / transaction gates (P0, do first)
- QA-only role verified and data access measured. Decide PII minimization path, test negative access against real login.
- Execute isolated synthetic checkout with a dedicated fixture product/stock, only after QA test data safety review; validate transactional inventory decrement, rollback, idempotent replay and conflict, serialized product row lock, concurrent stock depletion guard, legal preview token valid/stale/missing, proof body digest and immutable stored evidence; zero payment calls and no real communications.
- Audit scope of GET /api/products, GET /api/blog, GET /api/second-hand and writes, server logs, Sentry masking, authentication, admin RBAC, rate limit.
- Security gate = no high/critical open vulnerabilities, no PII leak from storefront DB role, no data mutation left in QA by negative tests, legal and checkout integration PASS.

## Stage 1 — Complete existing UI and route inventory (P0)
- Enumerate Next.js routes and dynamic routes from code; overlay sitemap, navigation and real browser clicks; include home, product catalog, product detail, filters, search, categories, compare, favorites, used products, blog posts, service, about, contact, policy/legal, 404/500/loading, cart, checkout, order confirmation/lookup, Admin Pro (dashboard, users, orders, stock, products, second-hand, legal, finance, analytics, search Cmd+K).
- Every navigational link and CTA has destination/permission; back/forward and deep-links work; tab order / keyboard, modal behavior, loading/empty/error states, recovery messaging; no silent no-op controls.
- Record issue with URL, viewport, steps, expected/actual, screenshot, severity, owner and PR. Mark PASS/FAIL/BLOCKED only with evidence.

## Stage 2 — Visual language / UX redesign (P1)
- Art direction: restrained premium appliance retailer meets warm trustworthy Aegean service. Design tokens, responsive typography, grid, spacing, color, icon, photography; consistent brand imagery.
- Distinctive editorial home hero with real product/lifestyle visuals; benefits and genuine service promise; restrained motion, reduced-motion, low-spec fallback, no blocking animations.
- Nav: sticky compact header, usable 390px menu, breadcrumbs, sticky filters on mobile if appropriate; keep filter/sort state across navigation, browser back restore, focus management.
- Product cards and details: truthful live price/status/delivery class, gallery with alt text, comparison, spec completeness and uncertainty, accessible CTA with explained disabled states.
- Mobile first at 320, 360, 390, 430, 768, 1024, 1440px; desktop trackpad and keyboard; contrast, 44px tap targets, no horizontal overflow. WCAG 2.2 AA target.

## Stage 3 — Product advantages (P1/P2, only after data quality)
- 2–4 question klima finder: m², heat/cool usage, region/installation conditions; capacity result is **preliminary** and promotes expert survey for final choice. Never promise precise BTU from area alone.
- Explain BTU, inverter, energy efficiency, installation included/excluded, maintenance; compare 2–4 Gree models with user-visible deltas and missing data explicitly unknown.
- Survey/installation scheduler or request form with explicit confirmation, admin follow-up; service region coverage check for Ege.
- 2nd hand: inspection condition, real photos, defects, warranty/legal status, publication gates; never auto-certify old listings.
- Post-purchase order lookup, clear fulfillment state, maintenance content and optional reminders, only with privacy-safe user verification.
- AI shopping assistant optional, bounded to verified catalog & docs and with cost cap; no hallucinated specs, promotions or availability.

## Stage 4 — Performance, SEO, growth and ops (P1)
- Core Web Vitals from real devices (LCP <=2.5s, INP <=200ms, CLS <=0.1 at p75 where measurable); budget JS and images, lazy-load heavy motion.
- Titles/meta/canonicals/hreflang if applicable, sitemap and robots, valid product/breadcrumb/organization schema, category copy, factual blog with no fabricated credentials.
- Source-controlled design/content changes, privacy-conscious analytics/consent configuration, search zero-results telemetry, product selection-to-enquiry and cart-to-order funnel.
- Accessibility audits with keyboard/screen reader and axe; web vitals, console and network errors, Lighthouse and trace. No unattainable '100 everywhere' promises.

## Stage 5 — Admin Pro reliability
- Dashboard, Cmd+K, filters, reset, mobile order cards, finance graphs, order drilldown, legal management, second-hand approval gate, user and role flows.
- Verify non-superadmin profitability denied, Agrotech viewer remains active and restricted; test using authorized test roles, no new live accounts.
- No cross-role data leakage, role separation in API (not only UI), negative routes HTTP 403, proper empty/loading/error and audit.
- No real payment, accounting, email or SMS side effects.

## Acceptance and delivery
- Per stage: issue register, risk and severity P0–P3, screenshots/URLs, automated Playwright E2E & unit/integration coverage, visual diff across target viewports, build/lint/typecheck, axe audits, reproducible evidence, before/after UX scorecard.
- Priority: (1) correctness/security (2) user task completion (3) mobile experience and accessibility (4) performance (5) creative enhancement.
- Release **NO-GO** while P0/P1 blockers, PII exposure, missing payment/checkout authorization, or untested legal acceptance remain.
- Proposed safe sequence: QA static/code audit and test fixture -> QA E2E -> Preview browser audit on approved deployment -> design branches and PRs -> independent review -> separate production release approval.
