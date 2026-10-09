import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orders = readFileSync("app/api/orders/route.ts", "utf8");
const preview = readFileSync("app/api/checkout/legal-preview/route.ts", "utf8");
const db = readFileSync("db/index.ts", "utf8");
const scope = readFileSync("lib/db-access-scope.ts", "utf8");

test("HTTP checkout handlers use the same gated scoped DB for rate limit and data operations", () => {
  assert.match(orders, /const db = getCheckoutDb\(\)/);
  assert.match(preview, /const db = getCheckoutDb\(\)/);
  assert.match(orders, /await rateLimit\(request,\s*"order-create",\s*8,\s*15\s*\*\s*60_000,\s*db\)/);
  assert.match(preview, /await rateLimit\(request,\s*"legal-preview",\s*8,\s*15\s*\*\s*60_000,\s*db\)/);
  assert.match(orders, /export const POST\s*=\s*publicRoute\(createOrder\)/);
  assert.match(preview, /export const POST\s*=\s*publicRoute\(/);
});

test("HTTP checkout requires signed legal preview and preserves the legacy off-switch", () => {
  assert.match(preview, /signLegalPreviewToken\(/);
  assert.match(orders, /verifyLegalPreviewToken\(/);
  assert.match(orders, /if \(!verified\.ok \|\| verified\.payload\.renderContextVersion !== 2\)/);
  assert.match(orders, /resolveLegalPreviewBinding\(/);
  assert.match(orders, /await tx\.insert\(orderLegalAcceptances\)/);
  assert.match(orders, /if \(process\.env\.CHECKOUT_SCOPED_DB_ENABLED === "true"\)/);
  assert.match(orders, /public\.lock_checkout_products\(/);
  // A JS array interpolated directly into Drizzle SQL becomes a scalar parameter,
  // not a PostgreSQL text[] (the first real HTTP E2E caught SQLSTATE 22P02).
  assert.match(orders, /lock_checkout_products\(ARRAY\[\$\{sql\.join\(/);
  assert.match(orders, /\.for\("share"\)/);
});

test("scoped HTTP DB activation fails closed instead of falling back to the owner", () => {
  assert.match(db, /scopedCheckoutEnabled\(process\.env\.CHECKOUT_SCOPED_DB_ENABLED\)/);
  assert.match(scope, /Both scoped database connections must be configured before activation/);
  assert.match(scope, /Scoped database connections cannot reuse the legacy database role/);
  assert.match(scope, /Scoped database endpoints must match the configured legacy database branch and name/);
});
