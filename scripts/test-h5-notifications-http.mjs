#!/usr/bin/env node
/**
 * H5-A: order notifications end to end on the REAL HTTP route and a disposable PostgreSQL, with a LOOPBACK mock of the
 * e-mail provider (no real e-mail can be sent). Harness generated from scripts/test-checkout-http-e2e.mjs; same guards.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import http from "node:http";
import { drizzle as drizzleClient } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";
import { requeueDeadNotification, operationsSummary, sweepMissingNotifications } from "../lib/notifications/outbox.ts";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { bootstrapDisposableDatabase, defaultStageDeps } from "./disposable-postgres-bootstrap.mjs";
import { hashLegalDocument } from "../lib/legal.ts";

const raw = process.env.CHECKOUT_HTTP_PG_URL;
const target = (() => { try { return new URL(raw); } catch { return null; } })();
if (process.env.CI !== "true" || !target || !["127.0.0.1", "localhost", "::1"].includes(target.hostname)
  || !target.pathname.slice(1).startsWith("sprintb") || !["postgres:", "postgresql:"].includes(target.protocol)) {
  console.error("[h5-notify] REFUSED: requires CI and a disposable sprintb loopback PostgreSQL URL");
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

  // ---------- loopback mock of the e-mail provider ----------
  const mail = { calls: [], mode: 200 };
  const mock = http.createServer((req, res) => {
    let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
      mail.calls.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || "{}") });
      res.writeHead(mail.mode, { "content-type": "application/json" }); res.end("{}");
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const mockBase = `http://127.0.0.1:${mock.address().port}`;
  const dispatchSecret = secret() + secret();
  const dbx = drizzleClient(owner, { schema });
  const dispatch = async (token = dispatchSecret) => { const r = await fetch(base + "/api/internal/notifications/dispatch", { headers: token ? { authorization: "Bearer " + token } : {}, signal: AbortSignal.timeout(25000) }); return { status: r.status, data: await r.json().catch(() => null) }; };
  const outbox = async () => (await owner.query("SELECT kind, status, attempts, last_error_code, dedupe_key, next_attempt_at, order_id FROM notification_outbox ORDER BY created_at, kind")).rows;
  const cart = { customerName: "Ada <b>Yılmaz</b>", phone: "05000000000", email: "customer@example.test",
    city: "İzmir", district: "Bornova", address: "Disposable address test street 10",
    paymentProvider: "discovery", items: [{ productId: "http-product", quantity: 1 }], delivery: "pickup", expectedTotal: 10000, legalAcceptances: [] };
  const placeOrder = async (key, over = {}) => {
    await owner.query("DELETE FROM rate_limit_buckets");
    const body = { ...cart, ...over }; const p = await request("/api/checkout/legal-preview", body); assertStatus(p, 200, "preview " + key);
    const accepted = { ...body, legalPreviewToken: p.data.legalPreviewToken, legalAcceptances: p.data.documents.map((d) => d.documentVersionId) };
    const o = await request("/api/orders", accepted, key); return { accepted, o };
  };
  const results = {};
  await owner.query("UPDATE inventory SET on_hand = 50 WHERE product_id = 'http-product'");
  await owner.query("DELETE FROM rate_limit_buckets");

  // ---- 1. The storefront role has NO grant on the outbox: the order must still succeed (savepoint isolation) ----
  const first = await placeOrder("h5-order-1");
  assertStatus(first.o, 201, "order succeeds although the outbox insert is not permitted");
  assert.equal((await outbox()).length, 0, "the failed savepoint left no outbox row");
  assert.equal(await count("orders"), 1);
  results.outboxFailureDoesNotBlockOrder = true;

  // ---- 2. Dispatch endpoint authorization ----
  assert.equal((await dispatch()).status, 404, "secret not configured: the route does not exist");
  await stopServer(); await startServer({ NOTIFICATION_DISPATCH_SECRET: dispatchSecret });
  assert.equal((await dispatch(null)).status, 401, "no credentials");
  assert.equal((await dispatch("x".repeat(40))).status, 401, "wrong secret");
  const notConfigured = await dispatch();
  assert.equal(notConfigured.status, 200);
  assert.equal(notConfigured.data.providerConfigured, false, "no e-mail service configured is reported, not hidden");
  assert.equal(notConfigured.data.sent, 0);
  results.dispatchAuth = "404 absent / 401 none / 401 wrong / 200 correct";

  // ---- 3. The sweep recovers the order whose enqueue failed, but only inside the 30-minute window (orders are immutable: the clock moves, not the row) ----
  const swept = await sweepMissingNotifications(dbx, new Date(Date.now() + 5 * 60_000));
  const rows1 = await outbox();
  assert.equal(swept, 2, "both notifications re-enqueued by the sweep");
  assert.deepEqual(rows1.map((r) => [r.kind, r.status, r.attempts]).sort(), [["order_admin_new", "pending", 0], ["order_customer_received", "pending", 0]], "not configured: rows wait untouched, no attempt burned");
  assert.equal((await dispatch()).data.sent, 0, "still not configured: nothing sent");
  assert.equal((await outbox()).every((r) => r.attempts === 0), true);
  await owner.query("DELETE FROM notification_outbox");
  assert.equal(await sweepMissingNotifications(dbx, new Date(Date.now() + 3 * 3_600_000)), 0, "an old order is never back-filled (no mail for history)");
  results.sweep = "recovers a failed enqueue within 30 minutes; never back-fills older orders";

  // ---- 4. With the grant, orders enqueue inline; replay does not duplicate ----
  await owner.query("GRANT INSERT ON notification_outbox TO sprintb_http_storefront");
  await stopServer(); await startServer({ NOTIFICATION_DISPATCH_SECRET: dispatchSecret, RESEND_API_KEY: "test-key-not-real", MAIL_FROM: "Ege Teknik <noreply@example.test>", RESEND_API_BASE: mockBase, ORDER_ALERT_EMAILS: "ops@example.test, boss@example.test", SITE_ORIGIN: "https://egeteknik.tr", ADMIN_ORIGIN: "https://admin.example.test" });
  const second = await placeOrder("h5-order-2");
  assertStatus(second.o, 201, "order 2");
  const rows2 = await outbox();
  assert.equal(rows2.length, 2, "two rows: customer + admin");
  assert.deepEqual(rows2.map((r) => r.kind).sort(), ["order_admin_new", "order_customer_received"]);
  assert.ok(rows2.every((r) => r.dedupe_key === `order:${r.order_id}:${r.kind}`));
  const replayed = await request("/api/orders", second.accepted, "h5-order-2");
  assert.equal(replayed.status, 200); assert.equal((await outbox()).length, 2, "replay of the same request adds no notification");
  results.enqueueAndReplay = "2 rows per order; replay adds none";

  // ---- 5. Delivery: exact content, idempotency keys, masked audit, no duplicates ----
  const sent = await dispatch();
  assert.equal(sent.data.providerConfigured, true); assert.equal(sent.data.sent, 2);
  assert.equal(mail.calls.length, 2);
  const customerCall = mail.calls.find((c) => c.body.to.includes("customer@example.test")), adminCall = mail.calls.find((c) => c.body.to.includes("ops@example.test"));
  assert.ok(customerCall && adminCall);
  assert.deepEqual(adminCall.body.to.sort(), ["boss@example.test", "ops@example.test"]);
  assert.equal(customerCall.headers["idempotency-key"], rows2.find((r) => r.kind === "order_customer_received").dedupe_key);
  assert.equal(adminCall.headers["idempotency-key"], rows2.find((r) => r.kind === "order_admin_new").dedupe_key);
  const orderNumber = created2OrderNumber(second.o);
  assert.match(customerCall.body.text, new RegExp(orderNumber)); assert.match(customerCall.body.text, /Tahsil edilmedi/); assert.match(customerCall.body.text, /₺10\.000/);
  assert.doesNotMatch(customerCall.body.html, /<b>Y/, "customer name is HTML-escaped"); assert.match(customerCall.body.html, /&lt;b&gt;/);
  assert.doesNotMatch(customerCall.body.text + customerCall.body.html, /ödeme alındı|kargoya verildi|montaj randevu/i);
  assert.match(adminCall.body.subject, new RegExp(orderNumber)); assert.match(adminCall.body.text, /https:\/\/admin\.example\.test\/admin\/orders\//); assert.doesNotMatch(adminCall.body.text, /Yılmaz|Bornova|customer@example\.test/);
  assert.ok((await outbox()).every((r) => r.status === "sent"));
  const audits = (await owner.query("SELECT payload::text AS p FROM audit_logs WHERE entity_type = 'notification'")).rows.map((r) => r.p).join("|");
  assert.match(audits, /c\*\*\*@e\*\*\*\.test/); assert.doesNotMatch(audits, /customer@example\.test|ops@example\.test|boss@example\.test/, "audit lines carry masked addresses only");
  assert.equal((await dispatch()).data.processed, 0); assert.equal(mail.calls.length, 2, "a second run sends nothing");
  results.delivery = "exact content, escaping, idempotency keys, masked audit, no duplicate";

  // ---- 6. Failure, controlled retry, permanent failure and requeue ----
  const third = await placeOrder("h5-order-3");
  assertStatus(third.o, 201, "order 3");
  mail.mode = 503; mail.calls.length = 0;
  const failing = await dispatch();
  assert.equal(failing.data.retried, 2);
  const retryRows = (await outbox()).filter((r) => r.status === "pending");
  assert.ok(retryRows.length === 2 && retryRows.every((r) => r.attempts === 1 && r.last_error_code === "provider_5xx" && new Date(r.next_attempt_at) > new Date(Date.now() + 30_000)), "rescheduled with backoff");
  const callsAfterFail = mail.calls.length;
  assert.equal((await dispatch()).data.processed, 0, "not due yet: no hammering");
  assert.equal(mail.calls.length, callsAfterFail);
  mail.mode = 200; await owner.query("UPDATE notification_outbox SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'");
  const recovered = await dispatch();
  assert.equal(recovered.data.sent, 2);
  assert.deepEqual((await outbox()).filter((r) => r.attempts === 2).length, 2, "sent on the second attempt");
  const fourth = await placeOrder("h5-order-4"); assertStatus(fourth.o, 201, "order 4");
  mail.mode = 422; const permanent = await dispatch();
  assert.equal(permanent.data.dead, 2);
  const deadRows = (await owner.query("SELECT id, last_error_code FROM notification_outbox WHERE status = 'dead'")).rows;
  assert.ok(deadRows.length === 2 && deadRows.every((r) => r.last_error_code === "invalid_recipient"));
  mail.mode = 200; mail.calls.length = 0;
  assert.equal((await dispatch()).data.processed, 0, "dead rows are not retried automatically");
  assert.equal(await requeueDeadNotification(dbx, deadRows[0].id, { userId: "admin-1", email: "admin@example.test" }), true);
  assert.equal(await requeueDeadNotification(dbx, deadRows[0].id, { userId: "admin-1", email: "admin@example.test" }), false, "only a dead row can be requeued, once");
  assert.equal((await dispatch()).data.sent, 1); assert.equal(mail.calls.length, 1);
  assert.equal(Number((await owner.query("SELECT count(*) FROM audit_logs WHERE action = 'notification_requeued'")).rows[0].count), 1, "requeue is audited with the human actor");
  results.retryDeadRequeue = "503 -> backoff -> sent on attempt 2; 422 -> dead; requeue audited";

  // ---- 7. Concurrency and crash recovery ----
  await owner.query("UPDATE notification_outbox SET status = 'pending', attempts = 0, sent_at = NULL, next_attempt_at = now() WHERE id = $1", [deadRows[1].id]);
  mail.calls.length = 0;
  const burst = await Promise.all(Array.from({ length: 6 }, () => dispatch()));
  assert.equal(burst.reduce((n, r) => n + r.data.sent, 0), 1, "six concurrent workers send one row once"); assert.equal(mail.calls.length, 1);
  const fifth = await placeOrder("h5-order-5"); assertStatus(fifth.o, 201, "order 5");
  await owner.query("UPDATE notification_outbox SET status = 'sending', locked_until = now() - interval '1 minute', attempts = 1 WHERE status = 'pending'");
  mail.calls.length = 0; const reclaimed = await dispatch();
  assert.equal(reclaimed.data.sent, 2, "rows abandoned by a crashed worker are reclaimed after the lock expires"); assert.equal(mail.calls.length, 2);
  await owner.query("UPDATE notification_outbox SET status = 'sending', locked_until = now() - interval '1 minute', attempts = 5, sent_at = NULL WHERE id = $1", [deadRows[1].id]);
  mail.calls.length = 0; await dispatch();
  assert.equal(mail.calls.length, 0, "a stalled row at the attempt ceiling is dead, never re-sent");
  assert.equal((await owner.query("SELECT status FROM notification_outbox WHERE id = $1", [deadRows[1].id])).rows[0].status, "dead");
  results.concurrencyAndCrash = "6 concurrent workers -> 1 send; stale lock reclaimed; exhausted row dead";

  // ---- 8. Operations summary and the disabled-service state ----
  const on = await operationsSummary(dbx, { RESEND_API_KEY: "k", MAIL_FROM: "x@example.test", ORDER_ALERT_EMAILS: "ops@example.test" });
  assert.equal(on.notifications.providerConfigured, true); assert.equal(on.orders.awaitingPayment, await count("orders")); assert.ok(on.orders.last24h >= 1);
  const off = await operationsSummary(dbx, {});
  assert.deepEqual([off.notifications.providerConfigured, off.notifications.providerReason], [false, "RESEND_API_KEY_missing"]);
  results.summary = { awaitingPayment: on.orders.awaitingPayment, disabledReported: true };
  await new Promise((r) => mock.close(r));
  console.log("[h5-notify] PASS " + JSON.stringify(results));

} catch (error) {
  console.error("[h5-notify] FAIL:", error instanceof Error ? error.message : String(error));
  console.error("[h5-notify] Local server diagnostics (last 1200 chars):", serverOutput.slice(-1200).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]"));
  process.exitCode = 1;
} finally {
  await stopServer();
  await owner.end();
}

function created2OrderNumber(res) { return res.data.orderNumber; }
