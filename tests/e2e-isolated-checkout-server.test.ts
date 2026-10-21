import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const isolated = readFileSync("scripts/e2e-isolated-checkout-server.mjs", "utf8");
const original = readFileSync("scripts/qa-hosted-checkout-server.mjs", "utf8");

test("isolated E2E server is bound to the new Neon child branch, not the existing QA parent", () => {
  assert.match(isolated, /br-spring-scene-aw3gf2qf/);
  assert.match(isolated, /ep-lingering-moon-aw5fx0yt/);
  assert.doesNotMatch(isolated, /br-delicate-frost-awnf26nw|ep-square-dust-awrzxg05/);
  assert.match(original, /br-delicate-frost-awnf26nw/);
  assert.match(original, /ep-square-dust-awrzxg05/);
});

test("isolated E2E requires separate URLs for all three QA-only roles", () => {
  for (const name of ["E2E_OWNER_DATABASE_URL", "E2E_STOREFRONT_DATABASE_URL", "E2E_ADMIN_DATABASE_URL", "E2E_NEON_BRANCH_ID"]) {
    assert.ok(isolated.includes(name), name);
  }
  assert.match(isolated, /CHECKOUT_SCOPED_DB_ENABLED: "true"/);
  assert.match(isolated, /"-H", "127.0.0.1"/);
  assert.match(isolated, /"43732"/);
  assert.match(isolated, /process\.env\.VERCEL/);
  assert.match(isolated, /process\.env\.CI/);
});

test("isolated launcher has no fixture mutations, schema operations, or outbound checkout HTTP", () => {
  assert.doesNotMatch(isolated, /\b(?:DROP|TRUNCATE|INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+public\.)\b/i);
  assert.doesNotMatch(isolated, /bootstrapDisposableDatabase|\bmigrate\s*\(|\bfetch\s*\(/);
  assert.match(isolated, /stdio: \["ignore", "ignore", "ignore"\]/);
});
