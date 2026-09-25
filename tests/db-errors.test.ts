import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pgErrorCode } from "../lib/db-errors.ts";

const db = readFileSync("lib/reviews-db.ts", "utf8");

test("a direct driver error (own .code, no .cause) returns that code", () => {
  assert.equal(pgErrorCode({ code: "23505" }), "23505");
  assert.equal(pgErrorCode(Object.assign(new Error("duplicate key"), { code: "23505" })), "23505");
});
test("a Drizzle-wrapped error (own .code undefined, real code nested at .cause.code) returns the nested code", () => {
  // Real shape confirmed against PostgreSQL 18 via drizzle-orm 0.45.2 (DrizzleQueryError): the
  // wrapper never sets its own .code, only .cause carries the driver's code.
  assert.equal(pgErrorCode({ code: undefined, cause: { code: "23514" } }), "23514");
  const wrapped = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("check_violation"), { code: "23514" }) });
  assert.equal(pgErrorCode(wrapped), "23514");
});
test("an own .code takes precedence over .cause.code when both are present", () => {
  assert.equal(pgErrorCode({ code: "23503", cause: { code: "23505" } }), "23503");
});
test("unknown/non-database errors never throw and resolve to undefined", () => {
  for (const value of [new Error("boom"), {}, { cause: {} }, { cause: "not an object" }, { cause: null }, { code: 42 }, { code: null }, null, undefined, "a string", 7, true, []]) {
    assert.equal(pgErrorCode(value), undefined, JSON.stringify(value));
  }
});

// ---- the two review paths this helper was extracted to fix (Phase 5A hotfix) -------------------
test("submitReview's verified-purchase race check uses the safe extractor, not a raw .code read", () => {
  assert.match(db, /import \{ pgErrorCode \} from "@\/lib\/db-errors";/);
  assert.match(db, /if \(orderItemId && pgErrorCode\(error\) === "23514"\) \{/);
  assert.doesNotMatch(db, /\(error as \{ code\?: string \}\)\?\.code === "23514"/, "the raw, always-undefined-under-Drizzle check must be gone");
});
test("moderateReview's conflict check uses the safe extractor, not a raw .code read", () => {
  assert.match(db, /if \(pgErrorCode\(error\) === "23505"\) return \{ ok: false, code: "CONFLICT" \};/);
  assert.doesNotMatch(db, /\(error as \{ code\?: string \}\)\?\.code === "23505"/, "the raw, always-undefined-under-Drizzle check must be gone");
});
