import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bootstrap = readFileSync("public/store.js", "utf8");
const ingestRoute = readFileSync("app/api/analytics/event/route.ts", "utf8");

test("analytics ingestion is gated by both the global switch and the visitor consent cookie before rate limiting or any database write", () => {
  const gate = ingestRoute.indexOf("if (!analyticsEnabled() || !analyticsConsentGranted(request))");
  const rateLimit = ingestRoute.indexOf('rateLimit(request, "analytics-event"');
  const record = ingestRoute.indexOf("recordEvent(");
  assert.ok(gate >= 0, "two-gate analytics check must exist");
  assert.ok(gate < rateLimit && rateLimit < record, "consent/global gate must run before rate-limit work and database recording");
  assert.match(ingestRoute, /return new Response\(null, \{ status: 204, headers: noStore \}\)/);
});

test("the consent cookie is explicit opt-in/opt-out, first-party, bounded and Secure on HTTPS", () => {
  assert.match(bootstrap, /const CONSENT_COOKIE='ege_analytics_consent'/);
  assert.match(bootstrap, /value\?'1':'0'/);
  assert.match(bootstrap, /Max-Age=\$\{CONSENT_MAX_AGE\}; Path=\/; SameSite=Lax/);
  assert.match(bootstrap, /location\.protocol==='https:'\?'[;] Secure':''/);
});

test("rejecting or revoking analytics asks the server to clear the HttpOnly visitor id", () => {
  assert.match(bootstrap, /fetch\('\/api\/analytics\/event',\{method:'DELETE',keepalive:true\}\)/);
  assert.match(bootstrap, /if\(!allow\)void revokeAnalyticsId\(\)/);
  assert.match(ingestRoute, /visitorCookieHeader\("", new URL\(request\.url\)\.protocol === "https:", 0\)/);
  assert.match(ingestRoute, /export const DELETE = publicRoute\(revokeAnalytics\)/);
});

test("accepting analytics after an undecided/rejected state records the current page when the core event function is available", () => {
  assert.match(bootstrap, /typeof window\.sendAnalyticsEvent==='function'/);
  assert.match(bootstrap, /else if\(!previouslyAllowed\)recordCurrentPageAfterOptIn\(\)/);
});

test("the first-visit banner offers reject, preferences and accept controls without preselecting analytics", () => {
  assert.match(bootstrap, />Yalnızca gerekli</);
  assert.match(bootstrap, />Tercihler</);
  assert.match(bootstrap, />Tümünü kabul et</);
  assert.match(bootstrap, /data-cookie-analytics \$\{analyticsAllowed\(\)\?'checked':''\}/);
});

test("the consent bootstrap loads the storefront core synchronously so its DOMContentLoaded listeners still register", () => {
  assert.match(bootstrap, /document\.write\('<script src="\/store-core\.js">/);
});
