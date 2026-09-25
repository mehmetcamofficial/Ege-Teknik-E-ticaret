import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsEventSchema, analyticsQuerySchema, classifyDevice, extractReferrerHost, isBotUserAgent,
  isValidVisitorId, normalizeEventPath, readCookie, resolveDateRange, VISITOR_COOKIE_MAX_AGE_SECONDS, VISITOR_COOKIE_NAME,
} from "../lib/analytics.ts";

// ---- device classification -------------------------------------------------------------------
const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  androidPhone: "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-T500) AppleWebKit/537.36 Safari/537.36",
  macDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
  windowsDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
};
test("classifyDevice: phones are mobile", () => {
  assert.equal(classifyDevice(UA.iphone), "mobile");
  assert.equal(classifyDevice(UA.androidPhone), "mobile");
});
test("classifyDevice: tablets are tablet, not mobile", () => {
  assert.equal(classifyDevice(UA.ipad), "tablet");
  assert.equal(classifyDevice(UA.androidTablet), "tablet");
});
test("classifyDevice: desktop browsers and unknown/empty user agents fall back to desktop", () => {
  assert.equal(classifyDevice(UA.macDesktop), "desktop");
  assert.equal(classifyDevice(UA.windowsDesktop), "desktop");
  assert.equal(classifyDevice(null), "desktop");
  assert.equal(classifyDevice(undefined), "desktop");
  assert.equal(classifyDevice(""), "desktop");
});

// ---- bot classification -----------------------------------------------------------------------
test("isBotUserAgent: a missing/empty user agent is treated as a bot - a real browser always sends one", () => {
  assert.equal(isBotUserAgent(null), true);
  assert.equal(isBotUserAgent(undefined), true);
  assert.equal(isBotUserAgent(""), true);
  assert.equal(isBotUserAgent("   "), true);
});
test("isBotUserAgent: well-known crawlers, preview bots and automation tooling are classified as bots", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "facebookexternalhit/1.1",
    "Twitterbot/1.0",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "curl/8.4.0",
    "python-requests/2.31.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/128.0.0.0 Safari/537.36",
    "PostmanRuntime/7.36.0",
    "Scrapy/2.11 (+https://scrapy.org)",
  ]) assert.equal(isBotUserAgent(ua), true, ua);
});
test("isBotUserAgent: ordinary real browsers are never classified as bots", () => {
  for (const ua of Object.values(UA)) assert.equal(isBotUserAgent(ua), false, ua);
});

// ---- referrer ----------------------------------------------------------------------------------
const SITE = "https://ege-teknik.example";
test("extractReferrerHost: an external referrer is reduced to its bare hostname only", () => {
  assert.equal(extractReferrerHost("https://www.google.com/search?q=klima+fiyat", SITE), "www.google.com");
  assert.equal(extractReferrerHost("https://www.instagram.com/p/xyz/", SITE), "www.instagram.com");
});
test("extractReferrerHost: same-site navigation is not a traffic source", () => {
  assert.equal(extractReferrerHost("https://ege-teknik.example/catalog.html", SITE), null);
  assert.equal(extractReferrerHost(`${SITE}/checkout.html?x=1`, SITE), null);
});
test("extractReferrerHost: missing, malformed, or non-http(s) referrers are null, never thrown", () => {
  assert.equal(extractReferrerHost(null, SITE), null);
  assert.equal(extractReferrerHost(undefined, SITE), null);
  assert.equal(extractReferrerHost("", SITE), null);
  assert.equal(extractReferrerHost("not a url at all", SITE), null);
  assert.equal(extractReferrerHost("javascript:alert(1)", SITE), null);
  assert.equal(extractReferrerHost("ftp://files.example.com/x", SITE), null);
});
test("extractReferrerHost: never returns a full URL, query string, or path - hostname only", () => {
  const host = extractReferrerHost("https://shop.example.com/deals?promo=SECRET123&email=someone%40example.com", SITE);
  assert.equal(host, "shop.example.com");
  assert.doesNotMatch(host!, /promo|SECRET|email|someone/);
});

// ---- path normalisation -------------------------------------------------------------------------
test("normalizeEventPath strips query string and fragment, keeps a bare path", () => {
  assert.equal(normalizeEventPath("/product.html?id=airy-12000"), "/product.html");
  assert.equal(normalizeEventPath("/catalog.html#filters"), "/catalog.html");
  assert.equal(normalizeEventPath("/"), "/");
});

// ---- cookie parsing ------------------------------------------------------------------------------
test("readCookie finds the named cookie among several, ignores others, decodes percent-encoding", () => {
  assert.equal(readCookie("a=1; ege_vid=abc-123; other=xyz", VISITOR_COOKIE_NAME), "abc-123");
  assert.equal(readCookie("ege_vid=hello%20world", VISITOR_COOKIE_NAME), "hello world");
  assert.equal(readCookie(null, VISITOR_COOKIE_NAME), null);
  assert.equal(readCookie("a=1; b=2", VISITOR_COOKIE_NAME), null);
  assert.equal(readCookie("", VISITOR_COOKIE_NAME), null);
});
test("the visitor cookie has a bounded, documented lifetime (180 days), not an unbounded/permanent one", () => {
  assert.equal(VISITOR_COOKIE_MAX_AGE_SECONDS, 180 * 24 * 60 * 60);
});

// ---- visitor id validity -------------------------------------------------------------------------
test("isValidVisitorId accepts only a well-formed UUID, rejecting anything else including injection attempts", () => {
  assert.equal(isValidVisitorId("550e8400-e29b-41d4-a716-446655440000"), true);
  for (const bad of [null, undefined, "", "not-a-uuid", "550e8400-e29b-41d4-a716", "'; DROP TABLE analytics_events;--", "550e8400e29b41d4a716446655440000", 12345, {}]) {
    assert.equal(isValidVisitorId(bad), false, JSON.stringify(bad));
  }
});

// ---- ingestion request schema --------------------------------------------------------------------
test("analyticsEventSchema accepts a minimal valid page view and a full product view", () => {
  assert.equal(analyticsEventSchema.safeParse({ path: "/" }).success, true);
  assert.equal(analyticsEventSchema.safeParse({ path: "/product.html", productId: "airy-12000-btu-h", referrer: "https://www.google.com" }).success, true);
});
test("analyticsEventSchema rejects a path that is not a bare site-relative path", () => {
  for (const path of ["", "not-a-path", "http://evil.example/x", "//evil.example", "/has spaces", "/has?query=1", "/has#fragment", "x".repeat(300)]) {
    assert.equal(analyticsEventSchema.safeParse({ path }).success, false, path);
  }
});
test("analyticsEventSchema is strict: no client-controlled visitorId, isNewVisitor, device, isBot, ip, or any other privileged/internal field is accepted", () => {
  for (const extra of [{ visitorId: "forged" }, { isNewVisitor: true }, { device: "desktop" }, { isBot: false }, { ip: "1.2.3.4" }, { ipHash: "x" }, { id: "forged-id" }]) {
    const r = analyticsEventSchema.safeParse({ path: "/", ...extra });
    assert.equal(r.success, false, JSON.stringify(extra));
  }
});
test("analyticsEventSchema bounds productId and referrer length", () => {
  assert.equal(analyticsEventSchema.safeParse({ path: "/", productId: "x".repeat(161) }).success, false);
  assert.equal(analyticsEventSchema.safeParse({ path: "/", referrer: "https://example.com/" + "x".repeat(500) }).success, false);
});

// ---- admin query schema -------------------------------------------------------------------------
test("analyticsQuerySchema defaults to 7d and rejects an unknown range value", () => {
  assert.equal(analyticsQuerySchema.parse({}).range, "7d");
  assert.equal(analyticsQuerySchema.safeParse({ range: "last_decade" }).success, false);
});

// ---- date range resolution (Europe/Istanbul, fixed UTC+3) -----------------------------------------
const NOON_UTC = new Date("2026-06-15T12:00:00.000Z"); // 15:00 Istanbul time
test("today: starts at Istanbul local midnight, ends at 'now'", () => {
  const r = resolveDateRange("today", NOON_UTC);
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.range.start.toISOString(), "2026-06-14T21:00:00.000Z"); assert.equal(r.range.end.toISOString(), NOON_UTC.toISOString()); }
});
test("today just after Istanbul local midnight is still 'today', not yesterday (UTC-day boundary trap)", () => {
  const justAfterMidnightIstanbul = new Date("2026-06-14T21:05:00.000Z"); // 00:05 on the 15th in Istanbul
  const r = resolveDateRange("today", justAfterMidnightIstanbul);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.range.start.toISOString(), "2026-06-14T21:00:00.000Z");
});
test("7d and 30d both include today and are inclusive of exactly 7 / 30 calendar days", () => {
  const r7 = resolveDateRange("7d", NOON_UTC), r30 = resolveDateRange("30d", NOON_UTC);
  assert.equal(r7.ok, true); assert.equal(r30.ok, true);
  if (r7.ok && r30.ok) {
    assert.equal((r7.range.end.getTime() - r7.range.start.getTime()) > 6 * 24 * 60 * 60 * 1000, true);
    assert.equal((r7.range.end.getTime() - r7.range.start.getTime()) < 8 * 24 * 60 * 60 * 1000, true);
    assert.equal((r30.range.end.getTime() - r30.range.start.getTime()) > 29 * 24 * 60 * 60 * 1000, true);
  }
});
test("month starts on the 1st of the current Istanbul month; year starts on Jan 1 Istanbul", () => {
  const rm = resolveDateRange("month", NOON_UTC), ry = resolveDateRange("year", NOON_UTC);
  assert.equal(rm.ok, true); assert.equal(ry.ok, true);
  if (rm.ok) assert.equal(rm.range.start.toISOString(), "2026-05-31T21:00:00.000Z"); // 2026-06-01 00:00 Istanbul
  if (ry.ok) assert.equal(ry.range.start.toISOString(), "2025-12-31T21:00:00.000Z"); // 2026-01-01 00:00 Istanbul
});
test("custom range: requires both from and to, rejects invalid dates and from-after-to", () => {
  assert.equal(resolveDateRange("custom", NOON_UTC).ok, false);
  assert.equal(resolveDateRange("custom", NOON_UTC, "2026-01-01").ok, false);
  assert.equal(resolveDateRange("custom", NOON_UTC, "not-a-date", "2026-01-02").ok, false);
  assert.equal(resolveDateRange("custom", NOON_UTC, "2026-02-01", "2026-01-01").ok, false);
});
test("custom range: an absurdly large span is rejected rather than silently allowed", () => {
  assert.equal(resolveDateRange("custom", NOON_UTC, "2000-01-01", "2026-01-01").ok, false);
});
test("custom range: end is capped at 'now', so a future end date can never promise data that has not happened yet", () => {
  const r = resolveDateRange("custom", NOON_UTC, "2026-06-01", "2026-07-01"); // end is ~2 weeks after `now`, span well within the size cap
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.range.end.getTime(), NOON_UTC.getTime());
});
test("custom range: a valid, reasonable range is accepted exactly as given", () => {
  const r = resolveDateRange("custom", NOON_UTC, "2026-06-01T00:00:00.000Z", "2026-06-10T00:00:00.000Z");
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.range.start.toISOString(), "2026-06-01T00:00:00.000Z"); assert.equal(r.range.end.toISOString(), "2026-06-10T00:00:00.000Z"); }
});
test("custom range: a bare YYYY-MM-DD (what a native date picker sends) covers the WHOLE Istanbul calendar day at each end, not just its first instant", () => {
  const sameDay = resolveDateRange("custom", NOON_UTC, "2026-06-05", "2026-06-05");
  assert.equal(sameDay.ok, true);
  if (sameDay.ok) {
    assert.equal(sameDay.range.start.toISOString(), "2026-06-04T21:00:00.000Z"); // 2026-06-05 00:00 Istanbul
    assert.equal(sameDay.range.end.toISOString(), "2026-06-05T20:59:59.999Z"); // 2026-06-05 23:59:59.999 Istanbul
  }
  const twoDay = resolveDateRange("custom", NOON_UTC, "2026-06-01", "2026-06-02");
  assert.equal(twoDay.ok, true);
  if (twoDay.ok) assert.equal(twoDay.range.end.getTime() - twoDay.range.start.getTime(), 2 * 24 * 60 * 60 * 1000 - 1, "two full calendar days, inclusive of both ends");
});
