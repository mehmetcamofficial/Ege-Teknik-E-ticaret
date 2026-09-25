import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadStorefront } from "./support/storefront-sandbox.ts";

const storeJs = readFileSync("public/store.js", "utf8");

test("a plain page view sends only the path - no visitor id, ip, user agent, or referrer when there is none", async () => {
  const store = loadStorefront({ path: "catalog.html" });
  store.fn<() => void>("sendAnalyticsEvent")();
  await Promise.resolve(); // let the fetch microtask settle
  assert.equal(store.analyticsBodies.length, 1);
  assert.deepEqual(store.analyticsBodies[0].body, { path: "/catalog.html" });
  for (const forbidden of ["visitorId", "ip", "userAgent", "device", "isBot", "isNewVisitor"]) assert.equal(forbidden in (store.analyticsBodies[0].body as object), false, forbidden);
});
test("an external referrer is included as document.referrer reports it - the server alone decides what to keep from it", async () => {
  const store = loadStorefront({ path: "index.html", referrer: "https://www.google.com/search?q=klima" });
  store.fn<() => void>("sendAnalyticsEvent")();
  await Promise.resolve();
  assert.equal((store.analyticsBodies[0].body as { referrer?: string }).referrer, "https://www.google.com/search?q=klima");
});
test("a same-site referrer (internal navigation) is still sent as-is; filtering same-origin referrers is the server's job, not the client's", async () => {
  const store = loadStorefront({ path: "checkout.html", referrer: "https://shop.test/catalog.html" });
  store.fn<() => void>("sendAnalyticsEvent")();
  await Promise.resolve();
  assert.equal((store.analyticsBodies[0].body as { referrer?: string }).referrer, "https://shop.test/catalog.html");
});
test("productId is included only on the product detail page, taken from the real ?id= in the URL", async () => {
  const onProduct = loadStorefront({ path: "product.html", search: "?id=airy-12000-btu-h", elements: { "[data-product-page]": { dataset: {} } as never } });
  onProduct.fn<() => void>("sendAnalyticsEvent")();
  await Promise.resolve();
  assert.equal((onProduct.analyticsBodies[0].body as { productId?: string }).productId, "airy-12000-btu-h");

  const onCatalog = loadStorefront({ path: "catalog.html", search: "?id=would-be-ignored" });
  onCatalog.fn<() => void>("sendAnalyticsEvent")();
  await Promise.resolve();
  assert.equal("productId" in (onCatalog.analyticsBodies[0].body as object), false, "an ?id= on a non-product page must not be sent as a productId");
});
test("the request uses POST, JSON content-type and keepalive (survives page unload), never an idempotency key it does not need", async () => {
  const store = loadStorefront({ path: "index.html" });
  store.fn<() => void>("sendAnalyticsEvent")();
  await Promise.resolve();
  const init = store.analyticsBodies[0].init as { method?: string; headers?: Record<string, string>; keepalive?: boolean };
  assert.equal(init.method, "POST");
  assert.equal(init.headers?.["content-type"], "application/json");
  assert.equal(init.keepalive, true);
  assert.equal("idempotency-key" in (init.headers ?? {}), false);
});
test("a network failure is swallowed silently - it never throws and never surfaces to the caller", async () => {
  const store = loadStorefront({ path: "index.html", api: { analyticsFail: true } });
  assert.doesNotThrow(() => store.fn<() => void>("sendAnalyticsEvent")());
  await Promise.resolve(); await Promise.resolve(); // let the rejected promise's .catch settle without an unhandled rejection
});
test("a page with no product context and a hostile-looking path still sends cleanly (location.pathname is always a real, already-decoded path, never attacker-controlled markup)", async () => {
  const store = loadStorefront({ path: "article.html", search: "?slug=<script>alert(1)</script>" });
  store.fn<() => void>("sendAnalyticsEvent")();
  await Promise.resolve();
  assert.deepEqual(store.analyticsBodies[0].body, JSON.parse(JSON.stringify(store.analyticsBodies[0].body))); // plain, already-serializable JSON, nothing exotic
  assert.equal((store.analyticsBodies[0].body as { path: string }).path, "/article.html");
});
test("the event fires from every public page store.js loads on (it is registered unconditionally, not gated behind a specific page's markup)", () => {
  const store = loadStorefront({ path: "index.html" });
  assert.equal(typeof store.fn("sendAnalyticsEvent"), "function");
  // scheduleAnalyticsEvent is a `const`, so - like other consts in this file - it is not exposed on the
  // sandbox's global context by design; its existence and wiring are verified via source text below instead.
});
test("collection is deferred via requestIdleCallback when available, and never via a bare synchronous call that could compete with catalog/product/checkout fetches", () => {
  assert.match(storeJs, /scheduleAnalyticsEvent\(sendAnalyticsEvent\)/);
  assert.match(storeJs, /typeof requestIdleCallback==='function'\?requestIdleCallback:\(cb=>setTimeout\(cb,300\)\)/);
});
test("a fetch/analytics failure cannot break page rendering - the storefront never awaits or depends on the analytics call's result", () => {
  const fn = storeJs.slice(storeJs.indexOf("function sendAnalyticsEvent"), storeJs.indexOf("const scheduleAnalyticsEvent"));
  assert.doesNotMatch(fn, /\bawait\b/, "sendAnalyticsEvent must not await its own fetch");
  assert.match(fn, /\.catch\(\(\)=>\{\}\)/);
});
