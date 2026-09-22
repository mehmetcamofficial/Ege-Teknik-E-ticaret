import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MAX_BODY_BYTES,
  IMAGE_UPLOAD_MAX_BODY_BYTES,
  containsCardData,
  isBucketWindowActive,
  isSameOrigin,
  isValidIdempotencyKey,
  maxBodyBytesForApiPath,
  rateLimitExceeded,
} from "../lib/security-policy.ts";

test("same-origin check accepts a matching origin and host", () => {
  assert.equal(isSameOrigin("https://ege-teknik.example", "ege-teknik.example"), true);
  assert.equal(isSameOrigin("http://localhost:3000", "localhost:3000"), true);
});

// URL parsing drops the default port, so a Host header that spells :443 out does not match
// the normalized origin. Comparison stays strict: rejecting is the safe side of that mismatch.
test("same-origin check is strict about an explicitly spelled default port", () => {
  assert.equal(isSameOrigin("https://ege-teknik.example:443", "ege-teknik.example:443"), false);
});

test("same-origin check rejects a cross-origin request", () => {
  assert.equal(isSameOrigin("https://attacker.example", "ege-teknik.example"), false);
  assert.equal(isSameOrigin("https://ege-teknik.example.attacker.example", "ege-teknik.example"), false);
  assert.equal(isSameOrigin("https://ege-teknik.example:8443", "ege-teknik.example"), false);
});

test("same-origin check rejects a missing or unparseable origin", () => {
  assert.equal(isSameOrigin(null, "ege-teknik.example"), false);
  assert.equal(isSameOrigin("https://ege-teknik.example", null), false);
  assert.equal(isSameOrigin("not-a-url", "ege-teknik.example"), false);
  assert.equal(isSameOrigin("null", "ege-teknik.example"), false);
});

test("card-like payloads are rejected at the top level", () => {
  assert.equal(containsCardData({ pan: "4111111111111111" }), true);
  assert.equal(containsCardData({ cvv: "123" }), true);
  assert.equal(containsCardData({ card_number: "4111111111111111" }), true);
  assert.equal(containsCardData({ expiration_date: "12/30" }), true);
});

test("card-like payloads are rejected when nested or inside arrays", () => {
  assert.equal(containsCardData({ order: { payment: { CVC: "999" } } }), true);
  assert.equal(containsCardData({ items: [{ ok: 1 }, { creditCard: "x" }] }), true);
});

test("ordinary order payloads are accepted", () => {
  assert.equal(containsCardData({ customerName: "Ada", items: [{ productId: "p1", quantity: 2 }] }), false);
  assert.equal(containsCardData({ paymentProvider: "PayTR", installmentCount: 3 }), false);
  assert.equal(containsCardData(null), false);
  assert.equal(containsCardData("pan"), false);
});

test("idempotency keys must be present and well-formed", () => {
  assert.equal(isValidIdempotencyKey("order-2026-09-22-abc123"), true);
  assert.equal(isValidIdempotencyKey("A.b:c-d_1234"), true);
  assert.equal(isValidIdempotencyKey(null), false);
  assert.equal(isValidIdempotencyKey(""), false);
  assert.equal(isValidIdempotencyKey("short"), false);
  assert.equal(isValidIdempotencyKey("has spaces in it"), false);
  assert.equal(isValidIdempotencyKey("x".repeat(201)), false);
});

const now = new Date("2026-09-22T12:00:00Z");
const future = new Date(now.getTime() + 60_000);
const past = new Date(now.getTime() - 1);

test("requests below the threshold are not rate limited", () => {
  assert.equal(rateLimitExceeded(undefined, now, 5), false);
  assert.equal(rateLimitExceeded({ count: 0, expiresAt: future }, now, 5), false);
  assert.equal(rateLimitExceeded({ count: 4, expiresAt: future }, now, 5), false);
});

test("the threshold blocks once the limit is reached", () => {
  assert.equal(rateLimitExceeded({ count: 5, expiresAt: future }, now, 5), true);
  assert.equal(rateLimitExceeded({ count: 99, expiresAt: future }, now, 5), true);
});

test("an expired window resets instead of blocking", () => {
  assert.equal(rateLimitExceeded({ count: 500, expiresAt: past }, now, 5), false);
  assert.equal(isBucketWindowActive({ expiresAt: past }, now), false);
  assert.equal(isBucketWindowActive({ expiresAt: future }, now), true);
  assert.equal(isBucketWindowActive(undefined, now), false);
});

test("the login threshold matches the configured five attempts per window", () => {
  const attempts = [1, 2, 3, 4, 5, 6];
  const blocked = attempts.filter((count) => rateLimitExceeded({ count: count - 1, expiresAt: future }, now, 5));
  assert.deepEqual(blocked, [6]);
});

// A. Exact image route gets the larger, image-specific ceiling.
test("the exact product-image upload route gets the 4.5 MB body limit", () => {
  assert.equal(maxBodyBytesForApiPath("/api/admin/products/123/image"), IMAGE_UPLOAD_MAX_BODY_BYTES);
  assert.equal(IMAGE_UPLOAD_MAX_BODY_BYTES, 4_500_000);
});

// B. Ordinary mutation routes keep the default JSON-body ceiling.
test("ordinary mutation routes keep the 64 KB default body limit", () => {
  for (const pathname of ["/api/orders", "/api/admin/products/123", "/api/auth/login"]) {
    assert.equal(maxBodyBytesForApiPath(pathname), DEFAULT_MAX_BODY_BYTES, `${pathname} must stay at the default limit`);
  }
  assert.equal(DEFAULT_MAX_BODY_BYTES, 64_000);
});

// C. Lookalike paths must not receive the exception - only the exact single-segment-id route does.
test("lookalike paths do not receive the image-upload exception", () => {
  const lookalikes = [
    "/api/admin/products/123/image/extra",
    "/api/admin/products/123/imageX",
    "/api/admin/products/123/image/",
    "/api/admin/products/image",
    "/api/admin/products/a/b/image",
    "/api/admin/products//image",
    "/API/admin/products/123/image",
    "/api/admin/products/123/image ",
  ];
  for (const pathname of lookalikes) {
    assert.equal(maxBodyBytesForApiPath(pathname), DEFAULT_MAX_BODY_BYTES, `${pathname} must not get the image exception`);
  }
});

// D. The proxy's own comparison still rejects a request whose declared Content-Length
// exceeds the limit selected for its route - for both the default route and the image route.
test("the selected limit still rejects a Content-Length over that route's own ceiling", () => {
  const exceedsLimit = (pathname: string, contentLength: number) => contentLength > maxBodyBytesForApiPath(pathname);
  assert.equal(exceedsLimit("/api/orders", 64_001), true);
  assert.equal(exceedsLimit("/api/orders", 64_000), false);
  assert.equal(exceedsLimit("/api/admin/products/123/image", 4_500_001), true);
  assert.equal(exceedsLimit("/api/admin/products/123/image", 4_500_000), false);
  // A lookalike is held to the default ceiling, not the image one, even with a mid-sized body.
  assert.equal(exceedsLimit("/api/admin/products/123/imageX", 100_000), true);
});
