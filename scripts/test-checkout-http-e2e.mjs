#!/usr/bin/env node
/**
 * Real HTTP checkout E2E on a disposable loopback PostgreSQL only.
 * This runner DROPS the public and drizzle schemas. It refuses remote DBs,
 * non-sprintb names and non-CI execution before opening any socket.
 * No external secrets or hosted environments are used.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { bootstrapDisposableDatabase, defaultStageDeps } from "./disposable-postgres-bootstrap.mjs";
import { hashLegalDocument } from "../lib/legal.ts";
import { signLegalPreviewToken } from "../lib/legal-preview-token.ts";

const raw = process.env.CHECKOUT_HTTP_PG_URL;
const target = (() => { try { return new URL(raw); } catch { return null; } })();
if (process.env.CI !== "true" || !target || !["127.0.0.1", "localhost", "::1"].includes(target.hostname)
  || !target.pathname.slice(1).startsWith("sprintb") || !["postgres:", "postgresql:"].includes(target.protocol)) {
  console.error("[http-checkout] REFUSED: requires CI and a disposable sprintb loopback PostgreSQL URL");
  process.exit(1);
}
const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
const secret = () => randomBytes(24).toString("hex");
const storePassword = secret(), adminPassword = secret(), signingSecret = secret();
const owner = new pg.Pool({ connectionString: raw, max: 3 });
const dbUrl = (role, password) => { const u = new URL(raw); u.username = role; u.password = password; return u.toString(); };
const storefrontUrl = dbUrl("sprintb_http_storefront", storePassword);
const adminUrl = dbUrl("sprintb_http_admin", adminPassword);
let port = 43000 + Math.floor(Math.random() * 1000);
let base = `http://127.0.0.1:${port}`;
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
  const child = server;
  server = undefined;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
};
const startServer = async (overrides) => {
  port += 1;
  base = `http://127.0.0.1:${port}`;
  serverOutput = "";
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
    { env: { ...process.env, APP_ENV: "development", NEON_BRANCH_ID: "disposable-http-ci",
      EXPECTED_NEON_DEVELOPMENT_BRANCH_ID: "disposable-http-ci",
      DATABASE_URL: raw, STOREFRONT_DATABASE_URL: storefrontUrl, ADMIN_DATABASE_URL: adminUrl,
      CHECKOUT_SCOPED_DB_ENABLED: "true", LEGAL_PREVIEW_SIGNING_SECRET: signingSecret,
      IP_HASH_SALT: secret(), LOCAL_BUILD_NO_UPLOAD: "1", NEXT_TELEMETRY_DISABLED: "1",
      ...overrides }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => log(chunk.toString()));
  server.stderr.on("data", (chunk) => log(chunk.toString()));
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw Error("local Next server exited before readiness");
    try {
      const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) { ready = true; break; }
    } catch { /* compile/startup */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(ready, "local Next server did not become ready");
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
  await owner.query(`CREATE ROLE sprintb_http_storefront LOGIN PASSWORD '${storePassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await owner.query(`CREATE ROLE sprintb_http_admin LOGIN PASSWORD '${adminPassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await owner.query("GRANT USAGE ON SCHEMA public TO sprintb_http_storefront, sprintb_http_admin");
  await owner.query(`GRANT SELECT ON products, inventory, legal_documents, legal_document_versions,
    orders, order_items, order_legal_acceptances, rate_limit_buckets TO sprintb_http_storefront`);
  await owner.query(`GRANT INSERT ON customers, addresses, orders, order_items,
    order_legal_acceptances, rate_limit_buckets TO sprintb_http_storefront`);
  await owner.query("GRANT UPDATE (on_hand, reserved, version, updated_at) ON inventory TO sprintb_http_storefront");
  await owner.query("GRANT UPDATE (count, window_started_at, expires_at) ON rate_limit_buckets TO sprintb_http_storefront");
  await owner.query("GRANT DELETE ON rate_limit_buckets TO sprintb_http_storefront");
  await owner.query("GRANT UPDATE (created_at) ON legal_documents TO sprintb_http_storefront");
  await owner.query("GRANT EXECUTE ON FUNCTION public.lock_checkout_products(text[]) TO sprintb_http_storefront");
  const probe = new pg.Pool({ connectionString: storefrontUrl, max: 1 });
  try {
    const p = (await probe.query(`SELECT current_user AS role,
      has_table_privilege(current_user, 'orders', 'UPDATE') AS orders_update,
      has_column_privilege(current_user, 'orders', 'updated_at', 'UPDATE') AS order_column_update,
      has_table_privilege(current_user, 'products', 'UPDATE') AS products_update,
      has_function_privilege(current_user, 'public.lock_checkout_products(text[])', 'EXECUTE') AS can_lock`)).rows[0];
    assert.deepEqual(p, { role: "sprintb_http_storefront", orders_update: false,
      order_column_update: false, products_update: false, can_lock: true });
  } finally { await probe.end(); }

  await startServer({});
  const cart = { customerName: "Test Customer", phone: "05000000000", email: "customer@example.test",
    city: "İzmir", district: "Bornova", address: "Disposable address test street 10",
    paymentProvider: "discovery", items: [{ productId: "http-product", quantity: 1 }],
    delivery: "pickup", expectedTotal: 10000, legalAcceptances: [] };
  const before = await stock();
  const preview = await request("/api/checkout/legal-preview", cart);
  assertStatus(preview, 200, "legal preview");
  assert.equal(preview.data.documents?.length, 2);
  assert.ok(preview.data.legalPreviewToken);
  assert.equal(await count("orders"), 0);
  assert.deepEqual(await stock(), before);
  const accepted = { ...cart, legalPreviewToken: preview.data.legalPreviewToken,
    legalAcceptances: preview.data.documents.map((d) => d.documentVersionId) };
  const badToken = await request("/api/orders", { ...accepted, legalPreviewToken: preview.data.legalPreviewToken + "tamper" }, "http-bad-token");
  assertStatus(badToken, 409, "tampered token");
  assert.equal(await count("orders"), 0);
  const missingToken = await request("/api/orders", { ...accepted, legalPreviewToken: undefined }, "http-no-token");
  assertStatus(missingToken, 409, "missing preview token");
  assert.equal(missingToken.data.code, "LEGAL_PREVIEW_INVALID");
  const payload = JSON.parse(Buffer.from(preview.data.legalPreviewToken.split(".")[0], "base64url").toString("utf8"));
  const expiredToken = signLegalPreviewToken({ ...payload, issuedAt: Date.now() - 20 * 60_000,
    expiresAt: Date.now() - 5 * 60_000, orderIssuedAt: Date.now() - 20 * 60_000 }, signingSecret);
  const expired = await request("/api/orders", { ...accepted, legalPreviewToken: expiredToken }, "http-expired-token");
  assertStatus(expired, 409, "expired signed legal preview token");
  assert.equal(expired.data.code, "LEGAL_PREVIEW_INVALID");
  const marketing = await request("/api/orders", { ...accepted, marketing: { sms: true, email: false, whatsapp: false } }, "http-marketing");
  assertStatus(marketing, 422, "marketing opt-in disabled");
  assert.equal(marketing.data.code, "MARKETING_CONSENT_DISABLED");
  const wrongTotal = await request("/api/orders", { ...accepted, expectedTotal: 10001 }, "http-wrong-total");
  assertStatus(wrongTotal, 409, "stale displayed price");
  assert.equal(wrongTotal.data.code, "PRICE_CHANGED");
  assert.equal(await count("orders"), 0, "refused requests must not create an order");
  assert.deepEqual(await stock(), before, "refused requests must not reserve stock");
  const created = await request("/api/orders", accepted, "http-idempotent-1");
  assertStatus(created, 201, "create order");
  assert.equal(created.data.ok, true);
  assert.equal(await count("orders"), 1);
  assert.equal(await count("order_items"), 1);
  assert.equal(await count("order_legal_acceptances"), 2);
  assert.deepEqual(await stock(), { on_hand: 2, reserved: 1 });
  const replay = await request("/api/orders", accepted, "http-idempotent-1");
  assertStatus(replay, 200, "idempotent replay");
  assert.equal(replay.data.orderNumber, created.data.orderNumber);
  assert.equal(await count("orders"), 1);
  assert.deepEqual(await stock(), { on_hand: 2, reserved: 1 });
  const conflict = await request("/api/orders", { ...accepted, note: "different request" }, "http-idempotent-1");
  assertStatus(conflict, 409, "idempotency conflict");
  assert.equal(conflict.data.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(await count("orders"), 1);
  // The remaining stock is two. Preview is read-only; the order transaction
  // must refuse quantity three and roll back every inserted row.
  // Isolate the stock-rollback case from the 8-per-15-minute anti-abuse quota:
  // all prior requests intentionally share one loopback client in this disposable DB.
  await owner.query("DELETE FROM rate_limit_buckets");
  const oversized = { ...cart, items: [{ productId: "http-product", quantity: 3 }], expectedTotal: 30000 };
  const overPreview = await request("/api/checkout/legal-preview", oversized);
  assertStatus(overPreview, 200, "oversized cart preview");
  const outOfStock = await request("/api/orders", {
    ...oversized, legalPreviewToken: overPreview.data.legalPreviewToken,
    legalAcceptances: overPreview.data.documents.map((doc) => doc.documentVersionId),
  }, "http-out-of-stock");
  assertStatus(outOfStock, 409, "out-of-stock order");
  assert.equal(await count("orders"), 1, "stock failure must roll back the order");
  assert.equal(await count("order_items"), 1);
  assert.equal(await count("order_legal_acceptances"), 2);
  assert.deepEqual(await stock(), { on_hand: 2, reserved: 1 });
  // A newly published and effective legal version must invalidate the
  // earlier signed preview, even though the HMAC is authentic and unexpired.
  // All writes are confined to this disposable CI database.
  await owner.query("DELETE FROM rate_limit_buckets");
  const revisedTitle = "Disposable distance-sales revision 2";
  const revisedBody = "Local HTTP checkout revised distance sales terms.";
  await owner.query(`INSERT INTO legal_document_versions
    (id, document_id, version, title, body, content_hash, effective_at, published_at, published_by)
    VALUES ($1, 'http-doc-distance-sales', 2, $2, $3, $4, '2020-01-01', '2020-01-01', 'owner-1')`,
    ["http-version-distance-sales-v2", revisedTitle, revisedBody,
      hashLegalDocument({ title: revisedTitle, body: revisedBody })]);
  const staleLegal = await request("/api/orders", accepted, "http-stale-legal");
  assertStatus(staleLegal, 409, "stale legal document version");
  assert.equal(staleLegal.data.code, "LEGAL_VERSION_MISMATCH");
  assert.equal(await count("orders"), 1, "stale legal version must not create an order");
  assert.equal(await count("order_legal_acceptances"), 2, "stale legal version must not record acceptance");
  assert.deepEqual(await stock(), { on_hand: 2, reserved: 1 });
  const updatedPreview = await request("/api/checkout/legal-preview", cart);
  assertStatus(updatedPreview, 200, "new legal version preview");
  assert.ok(updatedPreview.data.documents.some((d) => d.documentVersionId === "http-version-distance-sales-v2"));
  assert.equal(await count("marketing_consents"), 0, "no marketing consent is collected at checkout");

  // OFF switch: the legacy owner-backed HTTP checkout must still work on the
  // same disposable database even when scoped credentials are deliberately invalid.
  await stopServer();
  await owner.query("DELETE FROM rate_limit_buckets");
  await startServer({ CHECKOUT_SCOPED_DB_ENABLED: "false",
    STOREFRONT_DATABASE_URL: "intentionally-invalid", ADMIN_DATABASE_URL: "intentionally-invalid" });
  const legacyPreview = await request("/api/checkout/legal-preview", cart);
  assertStatus(legacyPreview, 200, "legacy-off legal preview");
  assert.ok(legacyPreview.data.documents.some((d) => d.documentVersionId === "http-version-distance-sales-v2"));
  const legacyOrder = await request("/api/orders", { ...cart,
    legalPreviewToken: legacyPreview.data.legalPreviewToken,
    legalAcceptances: legacyPreview.data.documents.map((d) => d.documentVersionId),
  }, "http-legacy-off-order");
  assertStatus(legacyOrder, 201, "legacy-off order");
  assert.equal(await count("orders"), 2);
  assert.equal(await count("order_legal_acceptances"), 4);
  assert.deepEqual(await stock(), { on_hand: 1, reserved: 2 });

  // ON switch must fail closed: no fallback to the privileged DATABASE_URL.
  // Check both a missing scoped configuration and a valid-shaped URL whose
  // password is wrong. Neither may create orders or touch inventory.
  await stopServer();
  await owner.query("DELETE FROM rate_limit_buckets");
  await startServer({ CHECKOUT_SCOPED_DB_ENABLED: "true",
    STOREFRONT_DATABASE_URL: "", ADMIN_DATABASE_URL: adminUrl });
  const missingScope = await request("/api/checkout/legal-preview", cart);
  assert.ok(missingScope.status >= 500, "missing scoped URL must fail closed");
  await stopServer();
  const badScopedUrl = dbUrl("sprintb_http_storefront", "incorrect-disposable-password");
  await startServer({ CHECKOUT_SCOPED_DB_ENABLED: "true",
    STOREFRONT_DATABASE_URL: badScopedUrl, ADMIN_DATABASE_URL: adminUrl });
  const badCredentials = await request("/api/checkout/legal-preview", cart);
  assert.ok(badCredentials.status >= 500, "bad scoped LOGIN password must fail closed");
  const badOrder = await request("/api/orders", { ...cart,
    legalPreviewToken: legacyPreview.data.legalPreviewToken,
    legalAcceptances: legacyPreview.data.documents.map((d) => d.documentVersionId),
  }, "http-bad-credentials");
  assert.ok(badOrder.status >= 500, "bad scoped LOGIN password must not fall back to legacy");
  assert.equal(await count("orders"), 2);
  assert.equal(await count("order_legal_acceptances"), 4);
  assert.deepEqual(await stock(), { on_hand: 1, reserved: 2 });
  for (const refused of [missingScope, badCredentials, badOrder]) {
    assert.doesNotMatch(JSON.stringify(refused.data), /postgres(?:ql)?:|sprintb_http_|DATABASE_URL|incorrect-disposable-password/i);
  }
  for (const response of [created.data, replay.data]) {
    assert.equal(Object.hasOwn(response, "id"), false);
    assert.equal(Object.hasOwn(response, "customerId"), false);
    assert.equal(Object.hasOwn(response, "idempotencyKey"), false);
    assert.doesNotMatch(JSON.stringify(response), /postgres(?:ql)?:|sprintb_http_|DATABASE_URL/i);
  }
  console.log("[http-checkout] PASS: real local HTTP preview, order 201, immutable evidence, inventory, replay, conflict, missing/expired token, price, marketing, stock/stale-legal refusals, legacy-off checkout and scoped-on credential refusal");
} catch (error) {
  console.error("[http-checkout] FAIL:", error instanceof Error ? error.message : String(error));
  console.error("[http-checkout] Local server diagnostics (last 1200 chars):", serverOutput.slice(-1200).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]"));
  process.exitCode = 1;
} finally {
  await stopServer();
  await owner.end();
}
