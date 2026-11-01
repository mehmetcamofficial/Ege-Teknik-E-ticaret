#!/usr/bin/env node
/**
 * H4-C: invalid-input refusals and genuinely concurrent orders against the REAL HTTP route and a disposable PostgreSQL.
 * Harness (lines up to startServer) is generated from scripts/test-checkout-http-e2e.mjs; same safety guards: CI=true,
 * loopback, database name starting with "sprintb". Drops the public and drizzle schemas of that database.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startNextDev } from "./http-test-server.mjs";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { bootstrapDisposableDatabase, defaultStageDeps } from "./disposable-postgres-bootstrap.mjs";
import { hashLegalDocument } from "../lib/legal.ts";

const raw = process.env.CHECKOUT_HTTP_PG_URL;
const target = (() => { try { return new URL(raw); } catch { return null; } })();
if (process.env.CI !== "true" || !target || !["127.0.0.1", "localhost", "::1"].includes(target.hostname)
  || !target.pathname.slice(1).startsWith("sprintb") || !["postgres:", "postgresql:"].includes(target.protocol)) {
  console.error("[h4-checkout] REFUSED: requires CI and a disposable sprintb loopback PostgreSQL URL");
  process.exit(1);
}
const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
const secret = () => randomBytes(24).toString("hex");
const storePassword = secret(), adminPassword = secret(), signingSecret = secret();
const owner = new pg.Pool({ connectionString: raw, max: 3 });
const dbUrl = (role, password) => { const u = new URL(raw); u.username = role; u.password = password; return u.toString(); };
const storefrontUrl = dbUrl("sprintb_http_storefront", storePassword);
const adminUrl = dbUrl("sprintb_http_admin", adminPassword);
let base = "";   // set from the server the OS gave a port to (scripts/http-test-server.mjs)
let server;
let serverOutput = "";
const log = (line) => { serverOutput = (serverOutput + line).slice(-6000); };
const request = async (path, body, key) => {
  const res = await fetch(base + path, { method: "POST", redirect: "manual",
    headers: { "content-type": "application/json", origin: base,
      ...(key ? { "idempotency-key": key } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw Error(`non-JSON HTTP ${res.status} from ${path}`); }
  return { status: res.status, data };
};
const count = async (table) => Number((await owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
const stock = async () => (await owner.query("SELECT on_hand, reserved FROM inventory WHERE product_id='http-product'")).rows[0];
const assertStatus = (result, status, label) => {
  assert.equal(result.status, status, `${label}: HTTP ${result.status} / code ${result.data?.code ?? "none"}`);
};
const stopServer = async () => {
  if (!server) return;
  const running = server;
  server = undefined;
  await running.stop();
};
const startServer = async (overrides) => {
  serverOutput = "";
  server = await startNextDev({ onOutput: log, env: { ...process.env, APP_ENV: "development", NEON_BRANCH_ID: "disposable-http-ci",
      EXPECTED_NEON_DEVELOPMENT_BRANCH_ID: "disposable-http-ci",
      DATABASE_URL: raw, STOREFRONT_DATABASE_URL: storefrontUrl, ADMIN_DATABASE_URL: adminUrl,
      CHECKOUT_SCOPED_DB_ENABLED: "true", LEGAL_PREVIEW_SIGNING_SECRET: signingSecret,
      IP_HASH_SALT: secret(), LOCAL_BUILD_NO_UPLOAD: "1", NEXT_TELEMETRY_DISABLED: "1",
      ...overrides } });
  base = server.base;
};
try {
  await bootstrapDisposableDatabase({ Pool: pg.Pool, drizzle, migrate, url: raw, journal,
    migrationsFolder: "drizzle-pg", ...defaultStageDeps, log: () => {} });
  await owner.query("INSERT INTO products (id, slug, name, sku, price, sale_mode, delivery_class, status) VALUES ('http-product', 'http-product', 'HTTP Test Product', 'HTTP-TEST', 10000, 'online', 'shippable', 'published')");
  await owner.query("INSERT INTO inventory (id, product_id, on_hand, reserved) VALUES ('http-inventory', 'http-product', 3, 0)");
  for (const slug of ["distance-sales", "pre-information", "kvkk"]) {
    const title = `Disposable ${slug}`, body = `Local HTTP checkout test ${slug} legal body.`;
    await owner.query("INSERT INTO legal_documents (id, slug) VALUES ($1, $2)", [`http-doc-${slug}`, slug]);
    await owner.query(`INSERT INTO legal_document_versions
      (id, document_id, version, title, body, content_hash, effective_at, published_at, published_by)
      VALUES ($1, $2, 1, $3, $4, $5, '2020-01-01', '2020-01-01', 'owner-1')`,
      [`http-version-${slug}`, `http-doc-${slug}`, title, body, hashLegalDocument({ title, body })]);
  }
  await owner.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sprintb_http_storefront') THEN
      CREATE ROLE sprintb_http_storefront LOGIN PASSWORD '${storePassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    ELSE
      ALTER ROLE sprintb_http_storefront WITH PASSWORD '${storePassword}';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sprintb_http_admin') THEN
      CREATE ROLE sprintb_http_admin LOGIN PASSWORD '${adminPassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    ELSE
      ALTER ROLE sprintb_http_admin WITH PASSWORD '${adminPassword}';
    END IF;
  END $$`);
  await owner.query("GRANT USAGE ON SCHEMA public TO sprintb_http_storefront, sprintb_http_admin");
  await owner.query(`GRANT SELECT ON products, inventory, legal_documents, legal_document_versions,
    rate_limit_buckets TO sprintb_http_storefront`);
  await owner.query(`GRANT INSERT ON customers, addresses, orders, order_items,
    order_legal_acceptances, rate_limit_buckets TO sprintb_http_storefront`);
  await owner.query("GRANT UPDATE (on_hand, reserved, version, updated_at) ON inventory TO sprintb_http_storefront");
  await owner.query("GRANT UPDATE (count, window_started_at, expires_at) ON rate_limit_buckets TO sprintb_http_storefront");
  await owner.query("GRANT DELETE ON rate_limit_buckets TO sprintb_http_storefront");
  await owner.query("GRANT UPDATE (created_at) ON legal_documents TO sprintb_http_storefront");
  await owner.query("GRANT EXECUTE ON FUNCTION public.lock_checkout_products(text[]) TO sprintb_http_storefront");
  await owner.query("GRANT EXECUTE ON FUNCTION public.checkout_replay_by_key(text,text) TO sprintb_http_storefront");
  const probe = new pg.Pool({ connectionString: storefrontUrl, max: 1 });
  try {
    const p = (await probe.query(`SELECT current_user AS role,
      has_table_privilege(current_user, 'orders', 'UPDATE') AS orders_update,
      has_column_privilege(current_user, 'orders', 'updated_at', 'UPDATE') AS order_column_update,
      has_table_privilege(current_user, 'products', 'UPDATE') AS products_update,
      has_function_privilege(current_user, 'public.lock_checkout_products(text[])', 'EXECUTE') AS can_lock,
      has_function_privilege(current_user, 'public.checkout_replay_by_key(text,text)', 'EXECUTE') AS can_replay,
      has_table_privilege(current_user, 'orders', 'SELECT') AS orders_read,
      has_table_privilege(current_user, 'order_items', 'SELECT') AS items_read,
      has_table_privilege(current_user, 'order_legal_acceptances', 'SELECT') AS evidence_read`)).rows[0];
    assert.deepEqual(p, { role: "sprintb_http_storefront", orders_update: false,
      order_column_update: false, products_update: false, can_lock: true, can_replay: true,
      orders_read: false, items_read: false, evidence_read: false });
  } finally { await probe.end(); }

  await startServer({});
  const cart = { customerName: "Test Customer", phone: "05000000000", email: "customer@example.test",
    city: "İzmir", district: "Bornova", address: "Disposable address test street 10",
    paymentProvider: "discovery", items: [{ productId: "http-product", quantity: 1 }],
    delivery: "pickup", expectedTotal: 10000, legalAcceptances: [] };
  const fresh = () => owner.query("DELETE FROM rate_limit_buckets");
  const rows = async () => ({ orders: await count("orders"), items: await count("order_items"), acceptances: await count("order_legal_acceptances"), stock: await stock() });
  const base0 = await rows();
  assert.deepEqual(base0, { orders: 0, items: 0, acceptances: 0, stock: { on_hand: 3, reserved: 0 } });
  const results = {};

  // ---- 1. Bad products and quantities are refused before any write (preview and order) ----
  await owner.query("INSERT INTO products (id, slug, name, sku, price, sale_mode, delivery_class, status) VALUES ('http-quote', 'http-quote', 'Quote only', 'HTTP-Q', 10000, 'quote', 'shippable', 'published')");
  await owner.query("INSERT INTO inventory (id, product_id, on_hand, reserved) VALUES ('http-q-inv', 'http-quote', 5, 0)");
  await owner.query("INSERT INTO products (id, slug, name, sku, price, sale_mode, delivery_class, status) VALUES ('http-draft', 'http-draft', 'Draft', 'HTTP-D', 10000, 'online', 'shippable', 'draft')");
  await owner.query("INSERT INTO inventory (id, product_id, on_hand, reserved) VALUES ('http-d-inv', 'http-draft', 5, 0)");
  const bad = [
    ["quantity 0", [{ productId: "http-product", quantity: 0 }], [400]],
    ["negative quantity", [{ productId: "http-product", quantity: -1 }], [400]],
    ["fractional quantity", [{ productId: "http-product", quantity: 1.5 }], [400]],
    ["quantity above the cart limit", [{ productId: "http-product", quantity: 11 }], [400]],
    ["string quantity", [{ productId: "http-product", quantity: "2" }], [400]],
    ["duplicate lines", [{ productId: "http-product", quantity: 1 }, { productId: "http-product", quantity: 1 }], [400]],
    ["empty cart", [], [400]],
    ["too many lines", Array.from({ length: 21 }, (_, i) => ({ productId: "p" + i, quantity: 1 })), [400]],
    ["unknown product", [{ productId: "does-not-exist", quantity: 1 }], [409]],
    ["quote-only product", [{ productId: "http-quote", quantity: 1 }], [409]],
    ["unpublished product", [{ productId: "http-draft", quantity: 1 }], [409]],
    ["quantity above stock (3)", [{ productId: "http-product", quantity: 4 }], [200, 409]],
  ];
  for (const [label, items, allowed] of bad) {
    await fresh();
    const attempt = { ...cart, items, expectedTotal: 10000 * (Number(items[0]?.quantity) > 0 ? Math.min(Number(items[0].quantity), 1000) : 1) };
    const preview = await request("/api/checkout/legal-preview", attempt);
    assert.ok(allowed.includes(preview.status), `${label}: preview HTTP ${preview.status} ${preview.data?.code ?? ""}`);
    if (preview.status === 200) {
      // A preview is read-only; the ORDER must still be refused and must not write anything.
      const order = await request("/api/orders", { ...attempt, legalPreviewToken: preview.data.legalPreviewToken, legalAcceptances: preview.data.documents.map((d) => d.documentVersionId) }, "h4-bad-" + label.replace(/\W+/g, "-"));
      assert.equal(order.status, 409, `${label}: order HTTP ${order.status} ${order.data?.code ?? ""}`);
    } else {
      const order = await request("/api/orders", { ...attempt, legalPreviewToken: "x".repeat(40), legalAcceptances: [] }, "h4-bad-" + label.replace(/\W+/g, "-"));
      assert.ok(order.status >= 400 && order.status < 500, `${label}: direct order HTTP ${order.status}`);
    }
    assert.deepEqual(await rows(), base0, `${label}: refused requests wrote nothing and reserved no stock`);
  }
  results.invalidInputs = `${bad.length} refused, zero rows written, stock unchanged`;

  // ---- 2. Concurrent orders for limited stock: exactly stock-many succeed, nothing oversells ----
  await fresh();
  const previews = [];
  for (let i = 0; i < 8; i++) {
    const p = await request("/api/checkout/legal-preview", { ...cart, customerName: "Concurrent " + i });
    assertStatus(p, 200, "concurrent preview " + i);
    previews.push(p.data);
  }
  await fresh();
  const outcomes = await Promise.all(previews.map((p, i) => request("/api/orders",
    { ...cart, customerName: "Concurrent " + i, legalPreviewToken: p.legalPreviewToken, legalAcceptances: p.documents.map((d) => d.documentVersionId) }, "h4-concurrent-" + i)));
  const statuses = outcomes.map((o) => o.status).sort();
  const created = outcomes.filter((o) => o.status === 201), refused = outcomes.filter((o) => o.status === 409);
  assert.equal(created.length, 3, "exactly on-hand (3) orders succeed: " + statuses.join());
  assert.equal(refused.length, 5, "the rest are refused as out of stock: " + statuses.join());
  assert.equal(new Set(created.map((o) => o.data.orderNumber)).size, 3, "distinct order numbers");
  assert.deepEqual(await rows(), { orders: 3, items: 3, acceptances: 6, stock: { on_hand: 0, reserved: 3 } }, "no oversell, no partial rows");
  const sums = (await owner.query("SELECT sum(quantity)::int AS q FROM order_items")).rows[0].q;
  assert.equal(sums, 3, "reserved stock equals ordered quantity");
  results.concurrentOrders = { attempts: 8, created: 3, refused: 5, finalStock: { on_hand: 0, reserved: 3 } };

  // ---- 3. Concurrent identical requests (same idempotency key) create one order ----
  // Evidence rows are immutable (the database refuses DELETE), so this section works on deltas, not a cleaned table.
  await assert.rejects(owner.query("DELETE FROM order_legal_acceptances"), /immutable|evidence/i, "legal evidence cannot be deleted even by the owner role");
  await owner.query("UPDATE inventory SET on_hand = 5, reserved = 3 WHERE product_id = 'http-product'");
  await fresh();
  const one = await request("/api/checkout/legal-preview", cart);
  assertStatus(one, 200, "idempotency preview");
  const same = { ...cart, legalPreviewToken: one.data.legalPreviewToken, legalAcceptances: one.data.documents.map((d) => d.documentVersionId) };
  await fresh();
  const dup = await Promise.all(Array.from({ length: 6 }, () => request("/api/orders", same, "h4-same-key")));
  const dupOk = dup.filter((o) => o.status === 201 || o.status === 200);
  assert.equal(dupOk.length, 6, "every duplicate gets the committed order: " + dup.map((o) => o.status).join());
  assert.equal(new Set(dupOk.map((o) => o.data.orderNumber)).size, 1, "one order number for all duplicates");
  assert.deepEqual(await rows(), { orders: 4, items: 4, acceptances: 8, stock: { on_hand: 4, reserved: 4 } }, "six identical requests added exactly one order and one reservation");
  results.concurrentIdempotency = { duplicates: 6, orders: 1 };

  // ---- 4. Money and stock records agree (prices are VAT-inclusive: net = lines - VAT; total = net + VAT + charges) ----
  const money = (await owner.query(`SELECT count(*)::int AS orders,
      bool_and(o.total = o.subtotal + o.vat_total + o.shipping_total + o.installation_total) AS total_formula,
      bool_and(o.subtotal = s.gross - s.vat) AS net_formula, bool_and(o.vat_total = s.vat) AS vat_formula,
      bool_and(o.payment_status = 'pending' AND o.status = 'pending_payment') AS unpaid_orders_stay_unpaid
    FROM orders o JOIN (SELECT order_id, sum(line_total) gross, sum(vat_amount) vat FROM order_items GROUP BY order_id) s ON s.order_id = o.id`)).rows[0];
  assert.deepEqual(money, { orders: 4, total_formula: true, net_formula: true, vat_formula: true, unpaid_orders_stay_unpaid: true }, "order totals, VAT and payment status are consistent");
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM payments")).rows[0].n, 0, "creating orders records no payment");
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM order_items i WHERE i.unit_price * i.quantity <> i.line_total")).rows[0].n, 0, "line math");
  results.moneyConsistency = "totals, VAT, payment status and ledger agree for all orders; no payment rows";
  console.log("[h4-checkout] PASS " + JSON.stringify(results));

} catch (error) {
  console.error("[h4-checkout] FAIL:", error instanceof Error ? error.message : String(error));
  console.error("[h4-checkout] Local server diagnostics (last 1200 chars):", serverOutput.slice(-1200).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]"));
  process.exitCode = 1;
} finally {
  await stopServer();
  await owner.end();
}
