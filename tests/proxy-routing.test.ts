import assert from "node:assert/strict";
import test from "node:test";
import { PROXY_MATCHER, classifyProxyRoute } from "../lib/proxy-routing.ts";

// 2. Public storefront remains public: proxy.ts (and therefore Clerk, the admin CSP
// nonce, and the API guards) never runs for it in the first place, because none of
// the static storefront paths are in its Next.js matcher.
test("the proxy matcher covers only api, admin and account - never the static storefront", () => {
  assert.deepEqual([...PROXY_MATCHER], ["/api/:path*", "/admin/:path*", "/account/:path*"]);
});

// 1 & 3. /account requires Clerk; /api/orders (and every other /api/* route) stays
// guest-capable because it is routed to the untouched guardApiRequest path, never to
// the Clerk-wrapped handler.
test("account paths classify as the Clerk-protected route", () => {
  for (const pathname of ["/account", "/account/", "/account/orders", "/account/addresses/123"]) {
    assert.equal(classifyProxyRoute(pathname), "account", pathname);
  }
});

test("/api/orders and other public API routes never classify as account", () => {
  for (const pathname of ["/api/orders", "/api/products", "/api/service-requests", "/api/second-hand"]) {
    assert.equal(classifyProxyRoute(pathname), "api", pathname);
  }
});

// 4 & 5. Admin routes classify separately from both api and account, so they keep
// running the untouched CSP-nonce branch and never pass through the Clerk handler -
// a Clerk customer session has no path to ever reach admin request handling here.
test("admin routes classify separately from account and never reach the Clerk handler", () => {
  for (const pathname of ["/admin", "/admin/login", "/admin/products"]) {
    assert.equal(classifyProxyRoute(pathname), "admin-app", pathname);
  }
});

// 6 & 7. Existing admin/api API routes classify as "api", not "account" - they keep
// running guardApiRequest exactly as before, proving the same-origin/body-size checks
// (already covered by tests/request-security.test.ts, which this change does not
// touch) still apply to them and were never rerouted through Clerk.
test("/api/admin/** stays on the api branch, not the account branch", () => {
  assert.equal(classifyProxyRoute("/api/admin/products/123"), "api");
  assert.equal(classifyProxyRoute("/api/admin/products/123/image"), "api");
});

// A path that merely starts with the string "/accountant" or similar must not be
// misclassified as the protected zone by a loose prefix match.
test("classification does not falsely widen on a look-alike prefix", () => {
  assert.equal(classifyProxyRoute("/accounting"), "admin-app");
  assert.equal(classifyProxyRoute("/api/accounts"), "api");
});
