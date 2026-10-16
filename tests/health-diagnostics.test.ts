import assert from "node:assert/strict";
import test from "node:test";
import { logHealthFailure, safeHealthErrorCode } from "../lib/health-diagnostics.ts";

test("allowlisted PostgreSQL and network codes survive redaction", () => {
  assert.equal(safeHealthErrorCode({ code: "28P01", message: "password=secret" }), "28P01");
  assert.equal(safeHealthErrorCode({ code: "ETIMEDOUT" }), "ETIMEDOUT");
  assert.equal(safeHealthErrorCode({ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }), "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
});

test("arbitrary messages and driver codes are never echoed", () => {
  assert.equal(safeHealthErrorCode({ code: "password=secret", message: "postgres://private" }), "OTHER");
  assert.equal(safeHealthErrorCode(new Error("postgres://private")), "OTHER");
  assert.equal(safeHealthErrorCode(null), "OTHER");
});

test("health logger emits only static event, phase, and allowlisted code", () => {
  const original = console.error;
  const captured: unknown[][] = [];
  console.error = (...args: unknown[]) => { captured.push(args); };
  try {
    logHealthFailure("db_query", { code: "28P01", message: "password=private", detail: "host=private" });
    logHealthFailure("pool_init", { code: "sensitive-private-code", stack: "secret" });
  } finally {
    console.error = original;
  }
  assert.deepEqual(captured, [
    ["health_check_failed", { phase: "db_query", code: "28P01" }],
    ["health_check_failed", { phase: "pool_init", code: "OTHER" }],
  ]);
  assert.doesNotMatch(JSON.stringify(captured), /private|password=|host=|secret/);
});
