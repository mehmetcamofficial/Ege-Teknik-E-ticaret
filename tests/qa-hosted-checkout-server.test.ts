import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const code = readFileSync("scripts/qa-hosted-checkout-server.mjs", "utf8");
const destructiveSql = /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+public\.|INSERT\s+INTO)\b/i;

test("hosted QA runner targets only the pinned isolated Neon endpoint and roles", () => {
  assert.match(code, /br-delicate-frost-awnf26nw/);
  assert.match(code, /ep-square-dust-awrzxg05/);
  for (const role of ["neondb_owner", "ege_qa_storefront_login", "ege_qa_admin_login"]) {
    assert.ok(code.includes(role), `expected QA role ${role}`);
  }
  assert.match(code, /CHECKOUT_SCOPED_DB_ENABLED: "true"/);
  assert.match(code, /EXPECTED_NEON_DEVELOPMENT_BRANCH_ID: expected.branch/);
});

test("hosted QA runner never seeds, resets or migrates the hosted database", () => {
  assert.doesNotMatch(code, destructiveSql);
  assert.doesNotMatch(code, /\bmigrate\s*\(/);
  assert.doesNotMatch(code, /bootstrapDisposableDatabase/);
  assert.doesNotMatch(code, /\bfetch\s*\(/);
});

test("QA runner is loopback-only and rejects environment file overlays", () => {
  assert.match(code, /"-H", "127.0.0.1"/);
  assert.match(code, /\.env\.development\.local/);
  assert.match(code, /process\.env\.VERCEL/);
  assert.match(code, /process\.env\.CI/);
  assert.match(code, /stdio: \["ignore", "ignore", "ignore"\]/);
  assert.doesNotMatch(code, /console\.log\([^\n]*(?:DATABASE_URL|STOREFRONT_DATABASE_URL|ADMIN_DATABASE_URL)/);
});
