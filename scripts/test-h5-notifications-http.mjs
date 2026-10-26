#!/usr/bin/env node
/**
 * H5-A: order notifications end to end on the REAL HTTP route and a disposable PostgreSQL, with a LOOPBACK mock of the e-mail provider
 * (no real e-mail can be sent). Since PR #37 the dispatch route runs as a dedicated least-privilege WORKER identity (own LOGIN role created from
 * the operator SQL, NOTIFICATION_WORKER_DATABASE_URL) and fails closed; this suite creates that identity, asserts each fail-closed answer and
 * drives delivery through it.
 *
 * Isolation and ownership (this suite runs in CI, in the PostgreSQL job):
 *   - env: H5_PG_URL (login of a disposable cluster; its database part is ignored). The cluster must pass scripts/disposable-cluster-attest.mjs
 *     (loopback, never port 55432, no foreign database, not a hosted compute, lab cluster or this CI run's marker). It creates its OWN database
 *     and its OWN roles, all with random per-run names; it never resets or alters anything that existed before.
 *   - ownership is PROVEN by oid in a private ledger (scripts/test-resource-ledger.mjs), never by a name or a comment: the suite drops only
 *     objects whose current oid equals the one recorded at creation. A SIGKILLed run is recovered with scripts/h5-recover-leftovers.mjs under the
 *     same proof; a normal run never touches another run's resources.
 *   - the mock mail server, the Next process group, the database and the roles are removed on success, failure, time-out AND SIGINT/SIGTERM
 *     (the signal handler cleans up on its own dedicated connection, bounded by timeouts).
 *   - the dev server gets an allow-listed environment: no ambient mail, payment or database credential can reach it.
 * Log lines CI relies on appear only when true: "[h5-http] PASS: ..." after every assertion, "[h5-http] cleanup: owned resources removed" after
 * every owned object was removed (and the exit code is non-zero if it was not).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startNextDev } from "./http-test-server.mjs";
import { workerOperatorSql } from "./notification-worker-test-role.mjs";
import { attestDisposableCluster } from "./disposable-cluster-attest.mjs";
import { openLedger, processStart, releaseOwned } from "./test-resource-ledger.mjs";
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

// R-04: a send budget key is mandatory (without it nothing is sent); this suite sends many mails to the same few addresses, so the limits are lifted here.
// The limits themselves are proven by scripts/notification-budget-scenarios.mjs.
const BUDGET_ENV = { NOTIFICATION_RATE_KEY: "r04-test-key-not-a-secret-0123456789abcdef", NOTIFICATION_CUSTOMER_DOMAIN_PER_HOUR: "100000", NOTIFICATION_CUSTOMER_PER_HOUR: "100000", NOTIFICATION_CUSTOMER_PER_DAY: "100000", NOTIFICATION_CUSTOMER_GLOBAL_PER_DAY: "100000",
  NOTIFICATION_OPS_PER_HOUR: "100000", NOTIFICATION_OPS_PER_DAY: "100000", NOTIFICATION_OPS_GLOBAL_PER_DAY: "100000" };

const refuse = (why) => { console.error(`[h5-http] REFUSED: ${why}`); process.exit(1); };
const base0 = (() => { try { return new URL(process.env.H5_PG_URL ?? ""); } catch { return null; } })();
if (process.env.CI !== "true") refuse("requires CI=true");
if (!base0 || !["postgres:", "postgresql:"].includes(base0.protocol)) refuse("H5_PG_URL must be a PostgreSQL URL");
if (!["127.0.0.1", "localhost", "::1"].includes(base0.hostname.replace(/^\[|\]$/g, ""))) refuse("loopback PostgreSQL URL required");
if (base0.port === "55432") refuse("the recovery cluster port is never allowed");

const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
const secret = () => randomBytes(24).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlFor = (db, user, password) => { const u = new URL(base0); u.pathname = `/${db}`; if (user) { u.username = user; u.password = password; } return u.toString(); };
const maintenanceUrl = urlFor("postgres");
const maintenance = new pg.Pool({ connectionString: maintenanceUrl, max: 1 });
const storePassword = secret(), adminPassword = secret(), workerPassword = secret(), signingSecret = secret();
// Per-run names, set once the ledger (and with it this run's random nonce) exists.
let ledger, DB, ROLE, rawUrl, storefrontUrl, adminUrl, workerUrl, owner;
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
const assertStatus = (result, status, label) => {
  assert.equal(result.status, status, `${label}: HTTP ${result.status} / code ${result.data?.code ?? "none"}`);
};
const saveServers = () => { if (ledger) { ledger.state.servers = server ? [{ pid: server.pid, start: processStart(server.pid) }] : []; ledger.save(); } };
const stopServer = async () => {
  if (!server) return;
  const running = server;
  server = undefined;
  await running.stop();
  saveServers();
};
// The dev server never inherits the ambient environment: no mail, payment, auth or database credential of the developer's shell or CI job can reach it.
const PASSTHROUGH = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TZ", "CI", "USER", "SHELL"];
const ambient = Object.fromEntries(PASSTHROUGH.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
const startServer = async (overrides) => {
  serverOutput = "";
  server = await startNextDev({ onOutput: log, env: { ...ambient, APP_ENV: "development", NEON_BRANCH_ID: "disposable-http-ci",
      EXPECTED_NEON_DEVELOPMENT_BRANCH_ID: "disposable-http-ci",
      DATABASE_URL: rawUrl, STOREFRONT_DATABASE_URL: storefrontUrl, ADMIN_DATABASE_URL: adminUrl,
      CHECKOUT_SCOPED_DB_ENABLED: "true", LEGAL_PREVIEW_SIGNING_SECRET: signingSecret,
      IP_HASH_SALT: secret(), LOCAL_BUILD_NO_UPLOAD: "1", NEXT_TELEMETRY_DISABLED: "1",
      ...overrides } });
  base = server.base;
  saveServers();
};
// ---------- loopback mock of the e-mail provider (top level, so EVERY exit path can close it) ----------
const mail = { calls: [], mode: 200 };
const mock = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
    mail.calls.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || "{}") });
    res.writeHead(mail.mode, { "content-type": "application/json" }); res.end("{}");
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockBase = `http://127.0.0.1:${mock.address().port}`;
assert.match(mockBase, /^http:\/\/127\.0\.0\.1:\d+$/, "the mail provider is a loopback mock: no real e-mail can be sent");

// A creation that is in flight when a signal arrives finishes (and is recorded) before cleanup decides what it owns.
let inflight = Promise.resolve();
const own = (fn) => { const promise = (async () => fn())(); inflight = promise.catch(() => {}); return promise; };
const recordRoles = async (names) => {
  const rows = (await owner.query("SELECT rolname, oid::text AS oid FROM pg_roles WHERE rolname = ANY($1)", [names])).rows;
  for (const name of names) { const row = rows.find((r) => r.rolname === name); assert.ok(row, "a role this run just created must exist"); ledger.state.roles.push({ name, oid: row.oid }); }
  ledger.save();
};

/** Idempotent; used by success, failure, time-out and SIGINT/SIGTERM alike. Prints the "removed" line only if EVERYTHING owned is gone. */
let cleanupResult;
const cleanup = () => (cleanupResult ??= (async () => {
  const problems = [];
  await Promise.race([inflight, sleep(10_000)]);
  await stopServer().catch(() => problems.push("the dev server process group could not be stopped"));
  await new Promise((resolve) => { mock.closeAllConnections?.(); mock.close(() => resolve(undefined)); });
  if (owner) await owner.end().catch(() => {});
  const owned = ledger ? ledger.state.databases.length + ledger.state.roles.length : 0;
  if (owned) {
    // A dedicated connection with its own timeouts: the pool above may be mid-query or already ended.
    const admin = new pg.Client({ connectionString: maintenanceUrl, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
    try { await admin.connect(); problems.push(...await releaseOwned({ query: (t, p) => admin.query(t, p), databases: ledger.state.databases, roles: ledger.state.roles })); }
    catch { problems.push("could not connect to the cluster to remove the owned resources"); }
    finally { await admin.end().catch(() => {}); }
  }
  await maintenance.end().catch(() => {});
  if (problems.length) {
    console.error("[h5-http] cleanup INCOMPLETE (the ledger is kept; recover with scripts/h5-recover-leftovers.mjs):");
    for (const problem of problems) console.error(`    ${problem}`);
    process.exitCode = 1;
    return false;
  }
  ledger?.remove();
  console.log(owned ? "[h5-http] cleanup: owned resources removed" : "[h5-http] cleanup: nothing was created by this run");
  return true;
})());
// A hung step must end the run, and so must a signal: clean up (bounded), then exit non-zero. (The launcher defers to these handlers.)
const TIME_LIMIT_MS = 240_000;
const watchdog = setTimeout(async () => {
  console.error(`[h5-http] FAIL: overall time limit of ${TIME_LIMIT_MS / 1000}s exceeded`);
  await Promise.race([cleanup(), sleep(45_000)]);
  process.exit(1);
}, TIME_LIMIT_MS);
watchdog.unref();
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(signal, async () => {
    console.error(`[h5-http] ${signal}: cleaning up before exit`);
    await Promise.race([cleanup(), sleep(45_000)]);
    process.exit(code);
  });
}
try {
  const route = await attestDisposableCluster({ url: maintenanceUrl, query: (t, p) => maintenance.query(t, p), env: process.env });
  const systemId = (await maintenance.query("SELECT system_identifier::text AS id FROM pg_control_system()")).rows[0].id;
  ledger = openLedger({ suite: "h5", systemId });   // before anything is created: a run that cannot be recovered creates nothing
  DB = `sprintb_h5_${ledger.nonce}`;
  ROLE = { store: `${DB}_store`, admin: `${DB}_admin`, group: `${DB}_worker`, login: `${DB}_wlogin` };
  rawUrl = urlFor(DB);
  storefrontUrl = urlFor(DB, ROLE.store, storePassword); adminUrl = urlFor(DB, ROLE.admin, adminPassword); workerUrl = urlFor(DB, ROLE.login, workerPassword);
  assert.equal((await maintenance.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB])).rowCount, 0, "database already exists: refusing to reuse or reset it");
  await own(async () => {
    await maintenance.query(`CREATE DATABASE "${DB}"`);
    ledger.state.databases.push({ name: DB, oid: (await maintenance.query("SELECT oid::text AS oid FROM pg_database WHERE datname = $1", [DB])).rows[0].oid });
    ledger.save();
  });
  owner = new pg.Pool({ connectionString: rawUrl, max: 3 });
  await bootstrapDisposableDatabase({ Pool: pg.Pool, drizzle, migrate, url: rawUrl, journal,
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
  // Fresh, private storefront and admin roles (this suite no longer alters roles other suites created).
  await own(async () => {
    await owner.query(`CREATE ROLE "${ROLE.store}" LOGIN PASSWORD '${storePassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await recordRoles([ROLE.store]);
    await owner.query(`CREATE ROLE "${ROLE.admin}" LOGIN PASSWORD '${adminPassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await recordRoles([ROLE.admin]);
  });
  await owner.query(`GRANT USAGE ON SCHEMA public TO "${ROLE.store}", "${ROLE.admin}"`);
  await owner.query(`GRANT SELECT ON products, inventory, legal_documents, legal_document_versions,
    rate_limit_buckets TO "${ROLE.store}"`);
  await owner.query(`GRANT INSERT ON customers, addresses, orders, order_items,
    order_legal_acceptances, rate_limit_buckets TO "${ROLE.store}"`);
  await owner.query(`GRANT UPDATE (on_hand, reserved, version, updated_at) ON inventory TO "${ROLE.store}"`);
  await owner.query(`GRANT UPDATE (count, window_started_at, expires_at) ON rate_limit_buckets TO "${ROLE.store}"`);
  await owner.query(`GRANT DELETE ON rate_limit_buckets TO "${ROLE.store}"`);
  await owner.query(`GRANT UPDATE (created_at) ON legal_documents TO "${ROLE.store}"`);
  await owner.query(`GRANT EXECUTE ON FUNCTION public.lock_checkout_products(text[]) TO "${ROLE.store}"`);
  await owner.query(`GRANT EXECUTE ON FUNCTION public.checkout_replay_by_key(text,text) TO "${ROLE.store}"`);
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
    assert.deepEqual(p, { role: ROLE.store, orders_update: false,
      order_column_update: false, products_update: false, can_lock: true, can_replay: true,
      orders_read: false, items_read: false, evidence_read: false });
  } finally { await probe.end(); }
  // The dedicated worker identity, created from the operator SQL exactly as an operator would (minimal column-level grants); one statement, all or nothing.
  await own(async () => {
    await owner.query(workerOperatorSql({ database: DB, group: ROLE.group, login: ROLE.login, password: workerPassword }));
    await recordRoles([ROLE.group, ROLE.login]);
  });

  await startServer({});
  const dispatchSecret = secret() + secret();
  const dbx = drizzleClient(owner, { schema });
  const dispatch = async (token = dispatchSecret) => { const r = await fetch(base + "/api/internal/notifications/dispatch", { headers: token ? { authorization: "Bearer " + token } : {}, signal: AbortSignal.timeout(25000) }); return { status: r.status, data: await r.json().catch(() => null) }; };
  let order1Id = "";   // once set, order 1's parked rows are excluded: the worker's own sweep may legitimately look at it again
  const outbox = async () => (await owner.query("SELECT kind, status, attempts, last_error_code, dedupe_key, next_attempt_at, order_id FROM notification_outbox WHERE order_id <> $1 ORDER BY created_at, kind", [order1Id])).rows;
  const cart = { customerName: "Ada <b>Yılmaz</b>", phone: "05000000000", email: "customer@example.test",
    city: "İzmir", district: "Bornova", address: "Disposable address test street 10",
    paymentProvider: "discovery", items: [{ productId: "http-product", quantity: 1 }], delivery: "pickup", expectedTotal: 10000, legalAcceptances: [] };
  const placeOrder = async (key, over = {}) => {
    await owner.query("DELETE FROM rate_limit_buckets");
    const body = { ...cart, ...over }; const p = await request("/api/checkout/legal-preview", body); assertStatus(p, 200, "preview " + key);
    const accepted = { ...body, legalPreviewToken: p.data.legalPreviewToken, legalAcceptances: p.data.documents.map((d) => d.documentVersionId) };
    const o = await request("/api/orders", accepted, key); return { accepted, o };
  };
  const results = { cluster: `disposable cluster attested (${route} route)` };
  await owner.query("UPDATE inventory SET on_hand = 50 WHERE product_id = 'http-product'");
  await owner.query("DELETE FROM rate_limit_buckets");

  // ---- 1. Dispatch endpoint: authorization and fail-closed configuration (PR #37 contract), BEFORE any order exists ----
  const alerts = { ORDER_ALERT_EMAILS: "ops@example.test, boss@example.test" };
  assert.equal((await dispatch()).status, 404, "secret not configured: the route does not exist");
  await stopServer(); await startServer({ NOTIFICATION_DISPATCH_SECRET: dispatchSecret });
  assert.equal((await dispatch(null)).status, 401, "no credentials");
  assert.equal((await dispatch("x".repeat(40))).status, 401, "wrong secret");
  const noRecipients = await dispatch();
  assert.equal(noRecipients.status, 503, "no ORDER_ALERT_EMAILS: fail closed (there is no admin_users fallback)"); assert.equal(noRecipients.data?.error, "not_configured");
  await stopServer(); await startServer({ NOTIFICATION_DISPATCH_SECRET: dispatchSecret, ...alerts });
  const noWorker = await dispatch();
  assert.equal(noWorker.status, 503, "no worker URL: fail closed, never the owner/storefront/admin connection"); assert.equal(noWorker.data?.error, "worker_unavailable");
  await stopServer(); await startServer({ NOTIFICATION_DISPATCH_SECRET: dispatchSecret, ...alerts, NOTIFICATION_WORKER_DATABASE_URL: storefrontUrl });
  const sharedRole = await dispatch();
  assert.equal(sharedRole.status, 503, "a worker URL that reuses the storefront role is refused"); assert.equal(sharedRole.data?.error, "worker_unavailable");
  await stopServer(); await startServer({ NOTIFICATION_DISPATCH_SECRET: dispatchSecret, ...alerts, NOTIFICATION_WORKER_DATABASE_URL: workerUrl });
  const notConfigured = await dispatch();
  assert.equal(notConfigured.status, 200);
  assert.equal(notConfigured.data.providerConfigured, false, "no e-mail service configured is reported, not hidden");
  assert.equal(notConfigured.data.sent, 0);
  results.dispatchAuth = "404 absent / 401 none / 401 wrong / 503 no recipients / 503 no worker URL / 503 shared role / 200 correct worker";

  // ---- 2. The storefront role has NO grant on the outbox: the order must still succeed (savepoint isolation) ----
  const first = await placeOrder("h5-order-1");
  assertStatus(first.o, 201, "order succeeds although the outbox insert is not permitted");
  assert.equal((await outbox()).length, 0, "the failed savepoint left no outbox row");
  assert.equal(await count("orders"), 1);
  results.outboxFailureDoesNotBlockOrder = true;

  // ---- 3. The sweep recovers the order whose enqueue failed, but only inside the 30-minute window (orders are immutable: the clock moves, not the row) ----
  const swept = await sweepMissingNotifications(dbx, new Date(Date.now() + 5 * 60_000));
  const rows1 = await outbox();
  assert.equal(swept, 2, "both notifications re-enqueued by the sweep");
  assert.deepEqual(rows1.map((r) => [r.kind, r.status, r.attempts]).sort(), [["order_admin_new", "pending", 0], ["order_customer_received", "pending", 0]], "not configured: rows wait untouched, no attempt burned");
  assert.equal((await dispatch()).data.sent, 0, "still not configured: nothing sent");
  assert.equal((await outbox()).every((r) => r.attempts === 0), true);
  await owner.query("DELETE FROM notification_outbox");
  assert.equal(await sweepMissingNotifications(dbx, new Date(Date.now() + 3 * 3_600_000)), 0, "an old order is never back-filled (no mail for history)");
  order1Id = (await owner.query("SELECT id FROM orders ORDER BY created_at LIMIT 1")).rows[0].id;
  await owner.query("INSERT INTO notification_outbox (id, kind, order_id, dedupe_key, status, sent_at) SELECT gen_random_uuid()::text, k.kind, $1, 'order:' || $1 || ':' || k.kind, 'sent', now() FROM (VALUES ('order_customer_received'), ('order_admin_new')) AS k(kind)", [order1Id]);
  results.sweep = "recovers a failed enqueue within 30 minutes; never back-fills older orders";

  // ---- 4. With the grant, orders enqueue inline; replay does not duplicate ----
  await owner.query(`GRANT INSERT ON notification_outbox TO "${ROLE.store}"`);
  await stopServer(); await startServer({ NOTIFICATION_DISPATCH_SECRET: dispatchSecret, RESEND_API_KEY: "test-key-not-real", MAIL_FROM: "Ege Teknik <noreply@example.test>", RESEND_API_BASE: mockBase, ...BUDGET_ENV, ...alerts, SITE_ORIGIN: "https://egeteknik.tr", ADMIN_ORIGIN: "https://admin.example.test", NOTIFICATION_WORKER_DATABASE_URL: workerUrl });
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
  const on = await operationsSummary(dbx, { RESEND_API_KEY: "k", MAIL_FROM: "x@example.test", ORDER_ALERT_EMAILS: "ops@example.test", ...BUDGET_ENV });
  assert.equal(on.notifications.providerConfigured, true); assert.equal(on.orders.awaitingPayment, await count("orders")); assert.ok(on.orders.last24h >= 1);
  const off = await operationsSummary(dbx, {});
  assert.deepEqual([off.notifications.providerConfigured, off.notifications.providerReason], [false, "RESEND_API_KEY_missing"]);
  results.summary = { awaitingPayment: on.orders.awaitingPayment, disabledReported: true };
  console.log("[h5-http] PASS: scoped-worker notification integration");
  console.log("[h5-http] results " + JSON.stringify(results));

} catch (error) {
  console.error("[h5-http] FAIL:", (error instanceof Error ? error.message : String(error)).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]"));
  console.error("[h5-http] Local server diagnostics (last 1200 chars):", serverOutput.slice(-1200).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]"));
  process.exitCode = 1;
} finally {
  await cleanup();
  clearTimeout(watchdog);
}

function created2OrderNumber(res) { return res.data.orderNumber; }
