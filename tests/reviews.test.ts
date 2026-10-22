import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canTransitionReview, decodeReviewCursor, encodeReviewCursor, moderationRequestSchema, normalizeContact, normalizeReviewText, PUBLIC_REVIEW_KEYS,
  REVIEW_RATE_LIMITS, reviewContentHash, reviewListQuerySchema, reviewSubmissionSchema, submissionErrors, summarizeRatings, toPublicReview, verifyPurchase,
} from "../lib/reviews.ts";

const valid = { rating: 5, displayName: "Ayşe K.", body: "Sessiz çalışıyor, soğutması çok iyi." };
const parse = (v: unknown) => reviewSubmissionSchema.safeParse(v);
const route = readFileSync("app/api/products/[id]/reviews/route.ts", "utf8");
const db = readFileSync("lib/reviews-db.ts", "utf8");
const adminList = readFileSync("app/api/admin/reviews/route.ts", "utf8");
const adminPatch = readFileSync("app/api/admin/reviews/[id]/route.ts", "utf8");
const migration = readFileSync("drizzle-pg/0008_product_reviews.sql", "utf8");
const schemaTs = readFileSync("db/schema.ts", "utf8");

// ---- submission validation ------------------------------------------------------------------------------
test("ratings 1 and 5 are accepted; 0, 6, decimals, strings and missing ratings are rejected", () => {
  assert.equal(parse({ ...valid, rating: 1 }).success, true);
  assert.equal(parse({ ...valid, rating: 5 }).success, true);
  for (const rating of [0, 6, 3.5, -1, "5", null, undefined, Number.NaN]) assert.equal(parse({ ...valid, rating }).success, false, String(rating));
});
test("empty, too-short and oversized review text is rejected; 2000 characters is the ceiling", () => {
  for (const body of ["", "   ", "kısa", "çok kısa"]) assert.equal(parse({ ...valid, body }).success, false, JSON.stringify(body));
  assert.equal(parse({ ...valid, body: "a".repeat(2000) }).success, true);
  assert.equal(parse({ ...valid, body: "a".repeat(2001) }).success, false);
  assert.equal(parse({ ...valid, body: "a".repeat(50_000) }).success, false);
});
test("display name: 2-40 characters, never an e-mail, phone number or link", () => {
  assert.equal(parse({ ...valid, displayName: "A" }).success, false);
  assert.equal(parse({ ...valid, displayName: "x".repeat(41) }).success, false);
  for (const name of ["ayse@example.com", "0542 795 75 60", "www.ornek.com", "https://x.tr"]) assert.equal(parse({ ...valid, displayName: name }).success, false, name);
});
test("the schema is strict: forged verification, order item, status and moderation fields are rejected", () => {
  for (const forged of [{ verified: true }, { verifiedPurchase: true }, { orderItemId: "item-1" }, { status: "approved" }, { moderatedBy: "admin" }, { productId: "other" }, { contentHash: "0".repeat(64) }]) {
    const r = parse({ ...valid, ...forged });
    assert.equal(r.success, false, JSON.stringify(forged));
    if (!r.success) assert.match(Object.values(submissionErrors(r.error)).join(" "), /geçersiz alanlar/);
  }
});
test("order number and contact must come together; the order-number format is validated", () => {
  assert.equal(parse({ ...valid, orderNumber: "ETS-20260101-ABC123" }).success, false);
  assert.equal(parse({ ...valid, contact: "05427957560" }).success, false);
  assert.equal(parse({ ...valid, orderNumber: "12345", contact: "05427957560" }).success, false);
  const ok = parse({ ...valid, orderNumber: "ets-20260101-abc123", contact: "0542 795 75 60" });
  assert.equal(ok.success, true);
  if (ok.success) assert.equal(ok.data.orderNumber, "ETS-20260101-ABC123");
});
test("HTML/script input is kept as inert plain text; invisible and control characters are stripped", () => {
  const r = parse({ ...valid, body: '<script>alert(1)</script> <img src=x onerror=alert(1)> güzel ürün\u202E\u200B' });
  assert.equal(r.success, true);
  if (r.success) { assert.equal(r.data.body, "<script>alert(1)</script> <img src=x onerror=alert(1)> güzel ürün"); assert.doesNotMatch(r.data.body, /[\u202E\u200B]/); }
  assert.equal(normalizeReviewText("a\u0000b\r\n\r\n\r\n\r\nc   d"), "ab\n\nc d");
  // rendering is escaped: see tests/reviews-storefront.test.ts
});
test("content hash ignores case and spacing so the same text cannot be posted twice for a product", () => {
  assert.equal(reviewContentHash("Harika  Klima"), reviewContentHash("harika klima"));
  // ASCII "I" (String#toUpperCase), Turkish "İ" and dotless "ı" must not open a duplicate-content bypass
  const text = "Değerlendirmesi iyi, İstanbul teslimatı hızlıydı";
  for (const variant of [text.toUpperCase(), text.toLocaleUpperCase("tr"), text.toLowerCase(), text.toLocaleLowerCase("tr")]) assert.equal(reviewContentHash(variant), reviewContentHash(text), variant);
  assert.notEqual(reviewContentHash("harika klima"), reviewContentHash("harika klima!"));
  assert.match(reviewContentHash("x"), /^[0-9a-f]{64}$/);
});

// ---- verified purchase ------------------------------------------------------------------------------------
const line = { orderItemId: "item-1", orderStatus: "delivered", phone: "0542 795 75 60", email: "Musteri@Example.com" };
test("a legitimate purchase verifies by phone or e-mail for delivered, installation and completed orders", () => {
  for (const status of ["delivered", "installation", "completed"]) assert.equal(verifyPurchase({ ...line, orderStatus: status }, "+90 542 795 7560"), "item-1", status);
  assert.equal(verifyPurchase(line, " musteri@example.COM "), "item-1");
});
test("wrong contact, missing order line (wrong product/order) and ineligible statuses never verify", () => {
  assert.equal(verifyPurchase(line, "0542 000 00 00"), null);
  assert.equal(verifyPurchase(line, "baska@example.com"), null);
  assert.equal(verifyPurchase(null, "0542 795 75 60"), null, "no order line for this product");
  for (const status of ["pending_payment", "paid", "preparing", "shipped", "delivery", "cancelled", "returned", "service"]) assert.equal(verifyPurchase({ ...line, orderStatus: status }, "05427957560"), null, status);
  assert.equal(verifyPurchase({ ...line, email: "" }, "@"), null, "empty e-mail never matches");
  assert.equal(verifyPurchase({ ...line, phone: "" }, "123"), null, "short numbers never match");
});
test("contact normalisation: last 10 phone digits, lower-case e-mail, unusable input is null", () => {
  assert.deepEqual(normalizeContact("+90 (542) 795-75-60"), { kind: "phone", value: "5427957560" });
  assert.deepEqual(normalizeContact("A@B.CO"), { kind: "email", value: "a@b.co" });
  assert.equal(normalizeContact("abc"), null);
});
test("verification is server-derived and its outcome is not observable in the response", () => {
  assert.match(db, /const orderItemId = submission\.orderNumber && submission\.contact \? verifyPurchase\(await findOrderLine\(submission\.orderNumber, input\.productId\), submission\.contact\) : null;/);
  assert.match(db, /verifiedPurchase: orderItemId !== null, orderItemId,/);
  assert.match(route, /\n  await submitReview\(\{[\s\S]*?\}\);\n  return Response\.json\(PENDING, \{ status: 202/);
  assert.doesNotMatch(route, /=\s*await submitReview|submitReview\([^\n]*\)\s*\.then|orderItemId|"stored"|"replayed"|"dropped"/, "the route never reads or branches on the verification/storage outcome");
  assert.doesNotMatch(db, /contact[^,]*:\s*submission\.contact|phone:\s*submission|email:\s*submission/, "the verification contact is never persisted");
});
test("signed-in users get no extra trust: the review route never reads Clerk, cookies or sessions", () => {
  assert.doesNotMatch(route + db, /clerk|auth\(\)|cookies\(|getAuthenticatedCustomer|session/i);
});

// ---- public API -------------------------------------------------------------------------------------------
test("public projection is an exact allow-list", () => {
  const row = { id: "r1", rating: 4, displayName: "Ali", body: "Güzel ürün.", verifiedPurchase: true, createdAt: new Date("2026-09-01T10:00:00Z"), status: "approved", orderItemId: "item-1", ipHash: "h", contentHash: "c", idempotencyKey: "k", moderationNote: "n", moderatedBy: "a", email: "e@x.tr", phone: "0" } as never;
  const pub = toPublicReview(row);
  assert.deepEqual(Object.keys(pub).sort(), [...PUBLIC_REVIEW_KEYS].sort());
  assert.deepEqual(pub, { id: "r1", rating: 4, displayName: "Ali", body: "Güzel ürün.", date: "2026-09-01", verifiedPurchase: true });
  assert.match(db, /const publicColumns = \{ id: productReviews\.id, rating: productReviews\.rating, displayName: productReviews\.displayName, body: productReviews\.body, verifiedPurchase: productReviews\.verifiedPurchase, createdAt: productReviews\.createdAt \};/);
  assert.match(db, /reviews: page\.map\(toPublicReview\)/);
});
test("only approved reviews are listed or aggregated; pending and rejected stay hidden", () => {
  assert.equal((db.match(/eq\(productReviews\.status, "approved"\)/g) ?? []).length, 2);
  assert.match(route, /findPublishedProduct\(id\)/);
});
test("zero reviews: count 0, average null, every bucket 0", () => {
  assert.deepEqual(summarizeRatings([]), { count: 0, average: null, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
});
test("aggregates are exact and ignore impossible groups", () => {
  const s = summarizeRatings([{ rating: 5, count: 3 }, { rating: 4, count: 1 }, { rating: 1, count: 1 }, { rating: 0, count: 9 }, { rating: 6, count: 9 }, { rating: 3, count: -2 }]);
  assert.deepEqual(s, { count: 5, average: 4, distribution: { 5: 3, 4: 1, 3: 0, 2: 0, 1: 1 } });
  assert.equal(summarizeRatings([{ rating: 5, count: 2 }, { rating: 4, count: 1 }]).average, 4.7);
  assert.equal(summarizeRatings([{ rating: 1, count: 1 }]).average, 1);
});
test("keyset cursor round-trips and rejects tampering; list query bounds are enforced", () => {
  const c = encodeReviewCursor({ rating: 4, createdAt: "2026-09-01T10:00:00.000Z", id: "2f0c7c2e-1b1f-4c1e-9b8a-0e6f7a1b2c3d" });
  assert.deepEqual(decodeReviewCursor(c), { rating: 4, createdAt: "2026-09-01T10:00:00.000Z", id: "2f0c7c2e-1b1f-4c1e-9b8a-0e6f7a1b2c3d" });
  for (const bad of ["x", Buffer.from('{"r":9,"c":"2026-01-01","i":"a"}').toString("base64url"), Buffer.from('{"r":1,"c":"nope","i":"a"}').toString("base64url"), Buffer.from('{"r":1,"c":"2026-01-01","i":"a\' OR 1=1"}').toString("base64url")]) assert.equal(decodeReviewCursor(bad), null);
  assert.equal(reviewListQuerySchema.safeParse({ limit: "50" }).success, false);
  assert.equal(reviewListQuerySchema.safeParse({ sort: "random" }).success, false);
  assert.deepEqual(reviewListQuerySchema.parse({}), { sort: "newest", limit: 10 });
});
test("sorting and pagination: newest, highest, lowest with a stable (created_at, id) tie-break and limit+1 look-ahead", () => {
  assert.match(db, /sort === "newest" \? \[desc\(productReviews\.createdAt\), desc\(productReviews\.id\)\]/);
  assert.match(db, /sort === "highest" \? \[desc\(productReviews\.rating\), desc\(productReviews\.createdAt\), desc\(productReviews\.id\)\]/);
  assert.match(db, /: \[asc\(productReviews\.rating\), desc\(productReviews\.createdAt\), desc\(productReviews\.id\)\]/);
  assert.match(db, /\.limit\(limit \+ 1\)/);
  assert.match(db, /nextCursor: rows\.length > limit \? encodeReviewCursor/);
});
test("unknown and unpublished products are 404 for GET and POST; responses are no-store", () => {
  assert.match(db, /where\(and\(eq\(products\.id, productId\), eq\(products\.status, "published"\)\)\)/);
  assert.equal((route.match(/if \(!product\) return notFound\(\);/g) ?? []).length, 2);
  assert.match(route, /"cache-control": "no-store"/);
});

// ---- abuse controls ---------------------------------------------------------------------------------------
test("POST requires an idempotency key, caps the body, validates strictly and rate-limits by hashed IP", () => {
  assert.match(route, /const key = idempotencyKey\(request\);\n  if \(!key\) return Response\.json\(\{ error: "Güvenli istek anahtarı eksik\." \}, \{ status: 400/);
  assert.match(route, /readJson\(request, REVIEW_LIMITS\.maxRequestBytes\)/);
  assert.match(route, /await rateLimit\(request, REVIEW_RATE_LIMITS\.hourly\.scope[\s\S]*await rateLimit\(request, REVIEW_RATE_LIMITS\.daily\.scope/);
  assert.deepEqual([REVIEW_RATE_LIMITS.hourly.limit, REVIEW_RATE_LIMITS.daily.limit], [5, 20]);
  assert.match(route, /ipHash: await hashClientIp\(request\)/);
  assert.doesNotMatch(route + db, /clientIp\(request\)(?!\))/, "no raw IP is stored");
  assert.match(route, /export async function POST[\s\S]*publicRoute/);
});
test("repeat and concurrent submissions: idempotent replay plus DB unique conflicts become a silent no-op", () => {
  assert.match(db, /where\(eq\(productReviews\.idempotencyKey, input\.idempotencyKey\)\)[\s\S]*return "replayed"/);
  assert.match(db, /\.onConflictDoNothing\(\)\.returning/);
  assert.match(migration, /CREATE UNIQUE INDEX "product_reviews_idempotency_uq" ON "product_reviews" USING btree \("idempotency_key"\);/);
});
test("duplicate verified review and duplicate content are blocked by live partial unique indexes", () => {
  assert.match(migration, /CREATE UNIQUE INDEX "product_reviews_order_item_live_uq" ON "product_reviews" USING btree \("order_item_id"\) WHERE "product_reviews"\."order_item_id" IS NOT NULL AND "product_reviews"\."status" IN \('pending','approved'\);/);
  assert.match(migration, /CREATE UNIQUE INDEX "product_reviews_content_live_uq" ON "product_reviews" USING btree \("product_id","content_hash"\) WHERE "product_reviews"\."status" IN \('pending','approved'\);/);
});
test("the honeypot field is accepted and silently dropped", () => {
  assert.equal(parse({ ...valid, website: "http://spam" }).success, true);
  assert.match(db, /if \(submission\.website\) return "dropped";/);
});

// ---- moderation -------------------------------------------------------------------------------------------
test("moderation transitions: pending->approved|rejected, approved->rejected, rejected->approved; never back to pending", () => {
  const ok = [["pending", "approved"], ["pending", "rejected"], ["approved", "rejected"], ["rejected", "approved"]];
  for (const [f, t] of ok) assert.equal(canTransitionReview(f, t), true, `${f}->${t}`);
  for (const [f, t] of [["approved", "pending"], ["rejected", "pending"], ["approved", "approved"], ["rejected", "rejected"], ["pending", "pending"], ["bogus", "approved"], ["pending", "deleted"]]) assert.equal(canTransitionReview(f, t), false, `${f}->${t}`);
  assert.equal(moderationRequestSchema.safeParse({ status: "pending" }).success, false);
  assert.equal(moderationRequestSchema.safeParse({ status: "approved", body: "edited" }).success, false, "no content editing through moderation");
  assert.equal(moderationRequestSchema.safeParse({ status: "approved", rating: 5 }).success, false);
});
test("moderation is a conditional update (stale decisions lose) and the audit log is written in the same transaction", () => {
  assert.match(db, /return await db\.transaction\(async \(tx\) => \{[\s\S]*tx\.update\(productReviews\)[\s\S]*\.where\(and\(eq\(productReviews\.id, input\.reviewId\), eq\(productReviews\.status, current\.status\)\)\)[\s\S]*if \(!updated\.length\) return \{ ok: false, code: "STALE" \}[\s\S]*await tx\.insert\(auditLogs\)\.values\(\{[\s\S]*?entityType: "product_review"/);
  assert.match(adminPatch, /STALE: \[409,/);
  assert.match(adminPatch, /CONFLICT: \[409,/);
});
test("admin permissions: content:write for both endpoints, no DELETE, no content-edit endpoint", () => {
  assert.match(adminList, /getAdminUser\("content:write"\)/);
  assert.match(adminPatch, /getAdminUser\("content:write"\)/);
  assert.doesNotMatch(adminList + adminPatch, /export async function (DELETE|PUT|POST)/);
  assert.match(adminList, /roleHasPermission\(admin\.role, "orders:write"\)/, "order numbers only for roles that manage orders");
});

// ---- database guarantees ----------------------------------------------------------------------------------
test("the DB makes forged verification impossible and forces every new review to start pending", () => {
  assert.match(migration, /CONSTRAINT "product_reviews_verified_ck" CHECK \("product_reviews"\."verified_purchase" = \("product_reviews"\."order_item_id" IS NOT NULL\)\)/);
  assert.match(migration, /IF NEW\."status" <> 'pending' OR NEW\."moderated_at" IS NOT NULL OR NEW\."moderated_by" IS NOT NULL OR NEW\."moderation_note" IS NOT NULL THEN/);
  assert.match(migration, /WHERE oi\."id" = NEW\."order_item_id" AND oi\."product_id" = NEW\."product_id" AND o\."status" IN \('delivered','installation','completed'\)/);
  assert.match(migration, /CONSTRAINT "product_reviews_rating_ck" CHECK \("product_reviews"\."rating" BETWEEN 1 AND 5\)/);
  assert.match(migration, /CONSTRAINT "product_reviews_status_ck" CHECK \("product_reviews"\."status" IN \('pending','approved','rejected'\)\)/);
  assert.match(migration, /CONSTRAINT "product_reviews_moderation_ck" CHECK/);
});
test("review content is immutable after insert: rating/text can never be edited into a different review", () => {
  for (const col of ["id", "product_id", "rating", "display_name", "body", "verified_purchase", "order_item_id", "content_hash", "created_at", "idempotency_key"]) assert.match(migration, new RegExp(`NEW\\."${col}" IS DISTINCT FROM OLD\\."${col}"`), col);
  assert.match(migration, /RAISE EXCEPTION 'product review content is immutable; only moderation fields may change' USING ERRCODE = 'restrict_violation'/);
  assert.match(migration, /IF NEW\."status" = 'pending' AND OLD\."status" <> 'pending' THEN/);
  assert.match(migration, /CREATE TRIGGER "product_reviews_guard_trg" BEFORE INSERT OR UPDATE ON "product_reviews" FOR EACH ROW EXECUTE FUNCTION "product_reviews_guard"\(\);/);
  for (const col of ["status", "moderated_at", "moderated_by", "moderation_note", "ip_hash"]) assert.doesNotMatch(migration, new RegExp(`NEW\\."${col}" IS DISTINCT FROM`), `${col} stays changeable`);
});
test("schema.ts and the migration describe the same single new table", () => {
  assert.match(schemaTs, /export const productReviews=pgTable\("product_reviews"/);
  assert.equal((migration.match(/CREATE TABLE/g) ?? []).length, 1);
});
