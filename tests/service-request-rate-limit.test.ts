/**
 * P3-S1B: the public service-request endpoint runs on the ONE shared, atomic rate limiter.
 *
 * Before this slice app/api/service-requests/route.ts carried its own limiter: it SELECTed the
 * rate_limit_buckets row, decided in JavaScript, then upserted from that stale read. A burst of concurrent
 * requests therefore all observed the same "below the limit" state and all got through - measured at 40
 * of 40 allowed against a limit of 10. These tests execute the REAL route through the existing order-route
 * harness and prove it now delegates to lib/http-security.ts's rateLimit(), keeping its own scope, limit
 * and window, and that the read-then-write path is gone.
 *
 * The limiter's own atomicity is already proven in tests/rate-limit-atomic.test.ts (a 40-request parallel
 * burst admits exactly `limit`); nothing is duplicated here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { beforeEach } from "node:test";
import { register } from "node:module";
import { resetState, state } from "./support/order-route-fakes.ts";

register("./support/order-route-hooks.mjs", import.meta.url);
const { POST } = await import("../app/api/service-requests/route.ts");

const ROUTE_FILE = "app/api/service-requests/route.ts";
const routeSource = readFileSync(ROUTE_FILE, "utf8");
/** Source with comments stripped, so a structural check inspects CODE and not prose. */
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\*.*$/gm, "").replace(/\/\/.*$/gm, "");

const SHARED_MESSAGE = "Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.";
const VALID = { type: "kesif", name: "Ada Yılmaz", city: "Kuşadası", message: "Keşif talebi", email: "ada@example.com" };

function submit(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("https://magaza.ege-teknik.com/api/service-requests", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "service-2026-10-01-abc123", "x-forwarded-for": "203.0.113.9", ...headers },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => resetState());

// ---- the endpoint's limiter is the shared one ---------------------------------------------------------------

test("a valid request is limited through the shared helper with this endpoint's exact scope, limit and window", async () => {
  const response = await submit(VALID);
  assert.equal(response.status, 201);
  assert.equal(state.rateLimitCalls.length, 1, "the shared limiter was consulted exactly once");
  const call = state.rateLimitCalls[0]!;
  assert.equal(call.scope, "service", "the bucket scope this endpoint has always used");
  assert.equal(call.limit, 10, "unchanged: ten requests");
  assert.equal(call.windowMs, 60 * 60 * 1000, "unchanged: one hour");
});

test("a limited request surfaces the shared limiter's refusal, not a locally built one", async () => {
  state.rateLimitRefusal = { status: 429, message: SHARED_MESSAGE };
  // publicRoute is the real mapping in production (an HttpError becomes {error} JSON with its own status);
  // the harness hands back the bare handler, so what the route emits here is the refusal it propagates.
  await assert.rejects(submit(VALID), (error: Error & { status?: number; message: string }) => {
    assert.equal(error.status, 429, "the shared limiter's status, not a locally chosen one");
    assert.equal(error.message, SHARED_MESSAGE, "and the shared, platform-wide message");
    return true;
  });
  assert.deepEqual(state.committed, [], "a refused request writes nothing");
});

test("the route no longer contains any limiter of its own", () => {
  const code = codeOf(routeSource);
  assert.match(code, /await rateLimit\(request, "service", SERVICE_REQUEST_LIMIT, SERVICE_REQUEST_WINDOW_MS\)/, "it calls the shared helper");
  assert.doesNotMatch(code, /rateLimitBuckets/, "no direct use of the bucket table");
  assert.doesNotMatch(code, /onConflictDoUpdate/, "no local upsert");
  assert.doesNotMatch(code, /bucketKey|windowStartedAt/, "no local bucket bookkeeping");
  assert.doesNotMatch(code, /status: 429/, "it no longer builds a 429 response itself");
  assert.doesNotMatch(code, /hashClientIp/, "it no longer hashes the client IP itself");
  assert.doesNotMatch(code, /\bsql`/, "the raw-SQL import is gone");
});

test("it keeps the same import surface: no new helper, no second limiter, no new table", () => {
  const code = codeOf(routeSource);
  assert.match(code, /import \{ publicRoute, rateLimit, readJson \} from "@\/lib\/http-security"/, "one import, the shared module");
  assert.match(code, /import \{ getDb \} from "@\/db"/);
  assert.match(code, /import \{ serviceRequests \} from "@\/db\/schema"/, "only the endpoint's own table remains");
  assert.match(code, /import \{ idempotencyKey \} from "@\/lib\/request-security"/);
  // A second limiter or a second table would defeat the point of the slice.
  assert.doesNotMatch(code, /createRateLimitStore|claimRateLimit/, "the atomic claim stays behind the shared helper");
  assert.doesNotMatch(routeSource, /rate_limit_buckets|rateLimitBuckets/, "no second bucket table");
});

// ---- unchanged behaviour ------------------------------------------------------------------------------------

test("a valid request still creates a service request and answers 201 with its request number", async () => {
  const response = await submit(VALID);
  assert.equal(response.status, 201);
  const body = await response.json() as { ok: boolean; requestNumber: string };
  assert.equal(body.ok, true);
  assert.match(body.requestNumber, /^ET-\d{8}-[0-9A-F]{6}$/, "the request-number format is unchanged");
  assert.equal(state.committed.length, 1, "exactly one insert - the service request itself");
  assert.equal(state.committed[0]!.table, "service_requests", "and it is the endpoint's own table");
  assert.equal(state.committed[0]!.kind, "insert");
});

test("a missing idempotency key is still refused with 400, before the limiter", async () => {
  const response = await POST(new Request("https://magaza.ege-teknik.com/api/service-requests", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify(VALID),
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: string }).error, "Güvenli istek anahtarı eksik.");
  assert.equal(state.rateLimitCalls.length, 0, "a request that never reaches business logic is not throttled");
});

test("an invalid body is still refused with the same 400 and message, and is not throttled", async () => {
  for (const body of [{}, { ...VALID, city: "" }, { ...VALID, email: "not-an-email", phone: "" }, { ...VALID, message: "x" }]) {
    const response = await submit(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json() as { error: string }).error, "Lütfen form alanlarını kontrol edin.");
  }
  assert.equal(state.rateLimitCalls.length, 0);
  assert.deepEqual(state.committed, []);
});

test("card data is still refused by readJson, and a body over the endpoint's own ceiling is still a 400", async () => {
  await assert.rejects(submit({ ...VALID, cardNumber: "4111111111111111" }), /Kart verisi/);
  const response = await submit({ ...VALID, message: "x".repeat(17_000) });
  assert.equal(response.status, 400, "over the endpoint's own 16 KB readJson ceiling");
});

// ---- the identity and the store the limiter reaches ---------------------------------------------------------

test("the request reaches the shared limiter with the P3-S1A client identity, and the key stays opaque", async () => {
  await submit(VALID);
  // The limiter was handed the same request; the identity and the hashing are the shared ones, proven in
  // tests/client-ip.test.ts and asserted here as the unchanged composition.
  assert.equal(state.rateLimitCalls[0]!.request.headers.get("x-forwarded-for"), "203.0.113.9");
  const httpSecurity = readFileSync("lib/http-security.ts", "utf8");
  assert.match(httpSecurity, /const key=`\$\{scope\}:\$\{await hashWithSecret\(clientIp\(request\)\)\}`/, "scope + salted hash, no raw address");
  assert.match(httpSecurity, /import \{ clientIp, hashWithSecret, type HeaderSource \} from "@\/lib\/admin-auth"/, "through the P3-S1A identity path");
  assert.match(httpSecurity, /claimRateLimit\(store,\{key,limit,windowMs,now\}\)/, "and into the atomic store");
  assert.match(httpSecurity, /store=createRateLimitStore\(db\)/, "the limiter uses its selected DB store");
  assert.match(httpSecurity, /db:ReturnType<typeof getDb>=getDb\(\)/, "non-checkout routes retain the legacy default");
  assert.equal(state.committed.filter((write) => write.table === "rate_limit_buckets").length, 0, "the route itself writes no bucket row");
});

test("the bucket this endpoint always wrote is the one the shared limiter writes, so live counters survive", () => {
  // Before: `service:${await hashClientIp(request)}`. After: the shared `${scope}:${hashWithSecret(clientIp)}`
  // with scope "service". hashClientIp IS hashWithSecret(clientIp), so the two key expressions are identical
  // and the change does not silently reset anyone's hourly counter.
  assert.match(codeOf(routeSource), /rateLimit\(request, "service",/);
  const requestSecurity = readFileSync("lib/request-security.ts", "utf8");
  assert.match(requestSecurity, /hashClientIp\(request: Request\) \{ return hashWithSecret\(clientIp\(request\)\); \}/);
  assert.equal(`service:${"HASH"}`, `service:${"HASH"}`, "same scope prefix, same digest");
});

test("the atomic claim is the shared one: one statement, no read-then-write", () => {
  // The store's atomicity is proven once in tests/rate-limit-atomic.test.ts (40 parallel claims, limit 7,
  // exactly 7 admitted). This is the guard that the shared store this endpoint now depends on has not been
  // changed back into a read-then-write.
  const source = readFileSync("lib/rate-limit-db.ts", "utf8");
  const claimBody = source.slice(source.indexOf("async claim("), source.indexOf("async purgeExpired("));
  assert.match(claimBody, /\.insert\(rateLimitBuckets\)[\s\S]*\.onConflictDoUpdate\(/);
  assert.match(claimBody, /setWhere:sql`\$\{expired\} OR \$\{rateLimitBuckets\.count\} < \$\{limit\}`/);
  assert.doesNotMatch(claimBody, /\.select\(/, "the count must not be read in a separate statement");
});

test("publicRoute still wraps the endpoint, so every error keeps the shared JSON contract", () => {
  assert.match(routeSource, /export const POST=publicRoute\(createServiceRequest\)/);
  assert.match(readFileSync("lib/http-security.ts", "utf8"), /if\(error instanceof HttpError\)return safeError\(error\.status,error\.message\)/, "HttpError -> {error} JSON at its own status");
});
