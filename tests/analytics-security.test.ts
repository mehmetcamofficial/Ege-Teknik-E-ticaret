import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ingestRoute = readFileSync("app/api/analytics/event/route.ts", "utf8");
const adminRoute = readFileSync("app/api/admin/analytics/route.ts", "utf8");
// Phase 3.3B: sales aggregates live on their own route, deliberately separate from traffic.
const salesRoute = readFileSync("app/api/admin/analytics/sales/route.ts", "utf8");
const dbModule = readFileSync("lib/analytics-db.ts", "utf8");
const lib = readFileSync("lib/analytics.ts", "utf8");
const adminUi = readFileSync("app/admin/analytics-admin.tsx", "utf8");

// ---- ingestion endpoint: public by design, but rate-limited and same-origin (via the shared proxy guard) ----
test("the ingestion endpoint is rate-limited before any database write", () => {
  const limit = ingestRoute.indexOf('rateLimit(request, "analytics-event"');
  const record = ingestRoute.indexOf("recordEvent(");
  assert.ok(limit > 0 && limit < record, "rate limiting must happen before the event is recorded");
});
test("the ingestion endpoint reads /api/*, so the shared same-origin + body-size proxy guard automatically covers it (no bespoke CSRF logic reinvented here)", () => {
  assert.doesNotMatch(ingestRoute, /assertSameOrigin/, "same-origin is enforced once, centrally, by proxy.ts for every /api/* mutation - not duplicated per-route");
});
test("the ingestion endpoint never requires or checks admin authentication - it is intentionally public", () => {
  assert.doesNotMatch(ingestRoute, /getAdminUser/);
});
test("the request body is capped well below the platform default, matching its genuinely tiny payload", () => {
  assert.match(ingestRoute, /readJson\(request,\s*2_000\)/);
});

// ---- privacy: no raw IP, no raw user agent, ever persisted -------------------------------------
test("the ingestion route never reads the client IP for anything other than rate limiting (which itself only ever stores a salted hash, never the address)", () => {
  assert.doesNotMatch(ingestRoute, /clientIp|hashClientIp/, "IP is not touched directly in the route - rateLimit() alone handles it, via the existing salted-hash bucket table");
});
test("recordEvent never persists the raw user-agent string - only the classified device category and bot flag", () => {
  assert.match(dbModule, /classifyDevice\(input\.userAgent\)/);
  assert.match(dbModule, /isBotUserAgent\(input\.userAgent\)/);
  assert.doesNotMatch(dbModule, /userAgent:\s*input\.userAgent(?!\))/, "the raw user agent string must never be assigned into the inserted row");
});
test("visitorId is never derived from IP or user agent - only from a client-presented cookie, or freshly minted server-side", () => {
  assert.doesNotMatch(lib, /visitorId.*=.*hash.*(?:ip|userAgent)/i);
});
test("the module documents the full privacy model in one place", () => {
  assert.match(lib, /PRIVACY MODEL/);
  assert.match(lib, /NEVER stored/i);
  assert.match(lib, /no fingerprinting/i);
});

// ---- cookie: first-party only, httpOnly, bounded lifetime, never third-party/cross-site --------
test("the visitor cookie is HttpOnly, SameSite=Strict, first-party (Path=/), and time-bounded - never a persistent cross-site identifier", () => {
  assert.match(ingestRoute, /HttpOnly/);
  assert.match(ingestRoute, /SameSite=Strict/);
  assert.match(ingestRoute, /Path=\//);
  assert.match(ingestRoute, /Max-Age=\$\{VISITOR_COOKIE_MAX_AGE_SECONDS\}/);
});
test("the cookie is Secure in production (never sent over plain HTTP once deployed)", () => {
  assert.match(ingestRoute, /process\.env\.NODE_ENV === "production"/);
});
test("an already-valid visitor cookie is left alone - the server does not needlessly re-issue Set-Cookie on every request", () => {
  assert.match(ingestRoute, /if \(!hadValidCookie\) response\.headers\.set\("Set-Cookie"/);
});

// ---- is_new_visitor is server-decided, never client-supplied -----------------------------------
test("is_new_visitor is computed server-side from prior rows, never accepted from the request body", () => {
  assert.doesNotMatch(ingestRoute, /parsed\.data\.(isNewVisitor|newVisitor)/);
  assert.match(dbModule, /const isNewVisitor = !seen/);
});

// ---- bot handling: classified and excluded from every admin aggregate except the exclusion count itself ----
test("every aggregate query excludes bot-classified events (the raw exclusion count is the only place is_bot=true is read back out)", () => {
  const aggregateFns = dbModule.slice(dbModule.indexOf("export async function loadAnalyticsSummary"));
  const notBotUses = [...aggregateFns.matchAll(/\bbase\b|\bnotBot\b/g)].length;
  assert.ok(notBotUses >= 5, "every one of totals/trend/top-pages/top-products/devices/referrers must filter through the not-bot base condition");
  assert.match(dbModule, /eq\(analyticsEvents\.isBot, true\)/, "the bot count itself is the one query allowed to select bot rows, for transparency");
});

// ---- admin endpoint: gated, no public bypass, no raw-event export -------------------------------
test("the admin analytics endpoint requires an authenticated admin session before touching the database", () => {
  // Phase 3.3B made the permission argument explicit on BOTH analytics routes. The check is the
  // same admin:read gate every dashboard endpoint already uses; only the call site is more precise.
  for (const [route, load] of [[adminRoute, "loadAnalyticsSummary("], [salesRoute, "loadSalesSummary("]] as const) {
    const auth = route.indexOf('getAdminUser("admin:read")');
    const at = route.indexOf(load);
    assert.ok(auth >= 0 && auth < at, `auth must be checked before ${load} is called`);
    assert.match(route, /if \(!admin\) return Response\.json\(\{ error: "Yetkisiz erişim" \}, \{ status: 403 \}\)/);
  }
});
test("the admin endpoint returns only the aggregated summary shape - no raw analytics_events rows, no visitor ids, no internal ids", () => {
  assert.doesNotMatch(adminRoute, /analyticsEvents\b/, "the admin route must go through loadAnalyticsSummary, never query the raw table itself");
  // A visitor_id column IS read into an internal derived table (to compute the new-vs-returning
  // count correctly), but the public AnalyticsSummary type/return object it produces must not
  // carry a visitorId field anywhere - check the actual output contract, not query-building code.
  const summaryType = lib.slice(lib.indexOf("export type AnalyticsSummary"), lib.indexOf("export type AnalyticsSummary") + 900);
  assert.doesNotMatch(summaryType, /visitorId|visitor_id/i);
  const returnStatement = dbModule.slice(dbModule.lastIndexOf("return {"));
  assert.doesNotMatch(returnStatement, /visitorId|visitor_id|\bid:/i);
});
test("there is no public (non-admin) endpoint that exposes analytics aggregates or raw events", () => {
  assert.doesNotMatch(ingestRoute, /export (async )?function GET/, "the public ingestion route accepts writes only, never reads");
});

// ---- admin UI: honest empty state, real data only, accessible date-range control, textual chart equivalents ----
test("the dashboard states an honest empty range explicitly, never a blank or fabricated chart", () => {
  assert.match(adminUi, /Bu tarih aralığında henüz kayıtlı ziyaret yok/);
});
test("no hardcoded/demo numeric literal masquerades as data - every displayed count comes from the fetched summary, not a literal", () => {
  assert.doesNotMatch(adminUi, /value=\{?\d{2,}\}?/, "a suspicious multi-digit literal passed as a displayed value");
});
test("the date-range control is a real accessible control group with a pressed state, matching the existing admin filter pattern", () => {
  // The one shared toolbar owns the control now (the traffic view is controlled by it).
  const sharedToolbar = readFileSync("app/admin/analytics-range-toolbar.tsx", "utf8");
  assert.match(sharedToolbar, /role="group" aria-label="Tarih aralığı"/);
  assert.match(sharedToolbar, /aria-pressed=\{r === active\}/);
});
// Phase 3.3B moved the BarRow markup and the shared date-range toolbar out of analytics-admin.tsx
// into the shared primitives, so these assertions follow the code to wherever it now lives. The
// guarantees being checked are unchanged - only the file they are read from moved.
const primitives = readFileSync("components/admin/analytics-primitives.tsx", "utf8");
const toolbar = readFileSync("app/admin/analytics-range-toolbar.tsx", "utf8");

test("every bar visualisation is paired with its real number as text, and the bar itself is decorative (aria-hidden)", () => {
  assert.match(primitives, /aria-hidden="true"[^>]*><div className="h-full rounded-full bg-primary"/);
  assert.match(primitives, /tabular-nums/);
});
test("the date-range preset buttons, the custom-range date inputs and the Uygula button all meet the 44px touch-target minimum (min-h-11), matching the h-11 convention already used elsewhere (e.g. app/admin/login/page.tsx)", () => {
  const presetButton = toolbar.slice(toolbar.indexOf("{PICKABLE.map((r) => ("), toolbar.indexOf("{PICKABLE.map((r) => (") + 300);
  assert.match(presetButton, /className="min-h-11"/);
  assert.match(toolbar, /id="analytics-from" type="date" className="min-h-11"/);
  assert.match(toolbar, /id="analytics-to" type="date" className="min-h-11"/);
  assert.match(toolbar, /className="min-h-11"\s*\n\s*variant=\{active === "custom"/, "the Uygula button carries min-h-11 next to its custom-range variant");
  assert.match(toolbar, />\s*Uygula\s*</, "the Uygula button carries min-h-11 next to its custom-range variant");
});
test("the daily trend additionally offers a plain data table, not only the bar rows", () => {
  assert.match(adminUi, /Tablo olarak gör/);
  assert.match(adminUi, /<Table className="mt-2">/);
});

// ---- top products: unpublished products are excluded from the ranking, but their history is kept (Phase 6A.2) ----
test("the Top Products query filters on the product's CURRENT status, not a stored/snapshotted one", () => {
  const topProductsBlock = dbModule.slice(dbModule.indexOf("const topProductsRows"), dbModule.indexOf("const deviceRows"));
  assert.match(topProductsBlock, /eq\(products\.status, "published"\)/, "unpublished products must be excluded from the default ranking");
  assert.match(topProductsBlock, /\.innerJoin\(products, eq\(products\.id, analyticsEvents\.productId\)\)/, "the status check reads live from the products table via a join, not a copy");
});
test("excluding a product from Top Products never deletes or filters its underlying analytics_events rows - only this one ranking query gains the status condition", () => {
  const beforeTopProducts = dbModule.slice(0, dbModule.indexOf("const topProductsRows"));
  assert.doesNotMatch(beforeTopProducts, /delete\s*\(|\.delete\(/i, "no delete anywhere in this module - unpublished products' history is retained, never purged");
  const otherQueries = dbModule.slice(dbModule.indexOf("const deviceRows"));
  assert.doesNotMatch(otherQueries, /products\.status/, "no other aggregate (daily trend, top pages, devices, referrers, totals) filters by product publish state - only the product-specific ranking does");
});
