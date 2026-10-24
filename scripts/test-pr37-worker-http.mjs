#!/usr/bin/env node
/**
 * PR #37: scoped notification worker on the REAL HTTP routes and a brand-new disposable PostgreSQL database.
 * The e-mail provider is a LOOPBACK mock: no real e-mail, no real payment.
 *
 * It creates its own database on a cluster that scripts/disposable-cluster-attest.mjs accepts as disposable (the local lab cluster whose
 * data_directory contains "pr37-worker-pg", or a CI service container marked by this very run) and REFUSES if that database already
 * exists (the migration bootstrap resets the schema, so it must never touch an existing database). It drops the database and
 * every role it created when it finishes.
 *
 * env: PR37_HTTP_PG_URL = owner/superuser URL of the lab cluster (database part is ignored), PR37_HTTP_DB = new database name
 *      (sprintb*), CI=true.
 * Optional CLONE MODE: PR37_HTTP_CLONE_FROM=<existing lab database> + PR37_LAB_WORKER_PASSWORD. The new database is then created
 *      WITH TEMPLATE from the lab database (schema, data and per-database ACLs are copied; the lab database itself is never connected
 *      to by the app and never modified), and the lab's own worker roles are used. This proves the lab ACL with real worker flows.
 * Optional PR37_STRESS_ROUNDS=<n>: n rounds of 3 orders + 6 concurrent dispatches, with latency and lock-wait sampling.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "../db/schema.ts";
import { requeueDeadNotification, sweepMissingNotifications } from "../lib/notifications/outbox.ts";
import { bootstrapDisposableDatabase, defaultStageDeps } from "./disposable-postgres-bootstrap.mjs";
import { hashLegalDocument } from "../lib/legal.ts";
import { attestDisposableCluster } from "./disposable-cluster-attest.mjs";

const refuse = (why) => { console.error(`[pr37-http] REFUSED: ${why}`); process.exit(1); };
const parse = (raw) => { try { return new URL(raw); } catch { return null; } };
const base0 = parse(process.env.PR37_HTTP_PG_URL), DB = process.env.PR37_HTTP_DB ?? "";
if (process.env.CI !== "true") refuse("requires CI=true");
if (!base0 || !["postgres:", "postgresql:"].includes(base0.protocol) || !["127.0.0.1", "localhost", "::1"].includes(base0.hostname)) refuse("loopback PostgreSQL URL required");
if (!/^sprintb[a-z0-9_]{3,40}$/.test(DB)) refuse("PR37_HTTP_DB must be a new sprintb* database name");

const secret = () => randomBytes(24).toString("hex");
const CLONE_FROM = process.env.PR37_HTTP_CLONE_FROM ?? "", LAB_MODE = CLONE_FROM !== "";
if (LAB_MODE && (!/^sprintb[a-z0-9_]{3,40}$/.test(CLONE_FROM) || CLONE_FROM === DB)) refuse("PR37_HTTP_CLONE_FROM must be a different sprintb* database");
if (LAB_MODE && !process.env.PR37_LAB_WORKER_PASSWORD) refuse("clone mode needs PR37_LAB_WORKER_PASSWORD");
const STRESS_ROUNDS = Math.min(Math.max(Number(process.env.PR37_STRESS_ROUNDS ?? 0) || 0, 0), 60);
const storePassword = secret(), adminPassword = secret(), workerPassword = LAB_MODE ? process.env.PR37_LAB_WORKER_PASSWORD : secret(), signingSecret = secret(), dispatchSecret = secret() + secret();
const probePassword = secret();
const ROLE = { storefront: "sprintb_pr37h_storefront", admin: "sprintb_pr37h_admin", probeBypass: "sprintb_pr37h_probe_bypass", probeAdmin: "sprintb_pr37h_probe_admin",
  workerGroup: LAB_MODE ? "sprintb_pr37_notification_worker" : "sprintb_pr37h_notification_worker", workerLogin: LAB_MODE ? "sprintb_pr37_worker_login" : "sprintb_pr37h_worker_login" };
const urlFor = (db, user, password) => { const u = new URL(base0); u.pathname = `/${db}`; if (user) { u.username = user; u.password = password; } return u.toString(); };
const maintenanceUrl = urlFor("postgres");
const raw = urlFor(DB);                                   // owner/superuser on the NEW database
const storefrontUrl = urlFor(DB, ROLE.storefront, storePassword), adminUrl = urlFor(DB, ROLE.admin, adminPassword), workerUrl = urlFor(DB, ROLE.workerLogin, workerPassword);
const ownerPassword = decodeURIComponent(base0.password);
const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));

const maintenance = new pg.Pool({ connectionString: maintenanceUrl, max: 1 });
let owner;
let createdDatabase = false;   // cleanup may only remove what THIS run created: a refused (pre-existing) database must survive untouched
let port = 44000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`, server, fullLog = "";
const bodies = [], dispatchBodies = [];                    // every HTTP body the QA saw, for the leak scan
const results = {};
const log = (chunk) => { fullLog = (fullLog + chunk).slice(-2_000_000); };

const request = async (path, body, key) => {
  const started = Date.now();
  const res = await fetch(base + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", origin: base, ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }).catch((error) => { throw Error(`POST ${path} (${key ?? "no key"}) failed after ${Date.now() - started}ms: ${error instanceof Error ? error.name : "error"}`); });
  const text = await res.text(); bodies.push(text);
  let data; try { data = JSON.parse(text); } catch { throw Error(`non-JSON HTTP ${res.status} from ${path}`); }
  return { status: res.status, data };
};
let inflight = 0, dispatchSeq = 0;
const latencies = [];
/** The server's stdout arrives asynchronously after the HTTP answer; wait (bounded) for a log line that was written after `mark`. */
const logged = async (pattern, mark, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (pattern.test(fullLog.slice(mark))) return true;
  return pattern.test(fullLog.slice(mark));
};
const dispatch = async (token = dispatchSecret) => {
  const id = ++dispatchSeq, started = Date.now(); inflight++;
  try {
    const res = await fetch(base + "/api/internal/notifications/dispatch", { headers: token ? { authorization: "Bearer " + token } : {}, signal: AbortSignal.timeout(60000) });
    const text = await res.text(); bodies.push(text); dispatchBodies.push(text); latencies.push(Date.now() - started);
    return { status: res.status, data: JSON.parse(text || "{}"), text };
  } catch (error) {
    throw Error(`dispatch #${id} failed after ${Date.now() - started}ms with ${inflight} in flight: ${error instanceof Error ? error.name : "error"}`);
  } finally { inflight--; }
};
const count = async (table) => Number((await owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
const assertStatus = (r, status, label) => assert.equal(r.status, status, `${label}: HTTP ${r.status} / ${r.data?.code ?? r.data?.error ?? "none"}`);
const stopServer = async () => {
  if (!server) return; const child = server; server = undefined; child.kill("SIGTERM");
  await Promise.race([new Promise((r) => child.once("exit", r)), new Promise((r) => setTimeout(r, 5000))]);
};
const startServer = async (overrides) => {
  port += 1; base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, APP_ENV: "development", NEON_BRANCH_ID: "disposable-http-ci", EXPECTED_NEON_DEVELOPMENT_BRANCH_ID: "disposable-http-ci",
    DATABASE_URL: raw, STOREFRONT_DATABASE_URL: storefrontUrl, ADMIN_DATABASE_URL: adminUrl, CHECKOUT_SCOPED_DB_ENABLED: "true",
    LEGAL_PREVIEW_SIGNING_SECRET: signingSecret, IP_HASH_SALT: secret(), LOCAL_BUILD_NO_UPLOAD: "1", NEXT_TELEMETRY_DISABLED: "1", ...overrides };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (c) => log(c.toString())); server.stderr.on("data", (c) => log(c.toString()));
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error("local Next server exited before readiness");
    try { const r = await fetch(base + "/api/health", { signal: AbortSignal.timeout(1500) }); if (r.status < 500) { ready = true; break; } } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(ready, "local Next server did not become ready");
};

// ---- environments of the server under test ---------------------------------------------------------------------------------------
const mail = { calls: [], mode: 200 };
const mock = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { mail.calls.push({ url: req.url, headers: req.headers, body: JSON.parse(b || "{}") }); res.writeHead(mail.mode, { "content-type": "application/json" }); res.end("{}"); }); });
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockBase = `http://127.0.0.1:${mock.address().port}`;
const fullEnv = (extra = {}) => ({ NOTIFICATION_DISPATCH_SECRET: dispatchSecret, RESEND_API_KEY: "test-key-not-real", MAIL_FROM: "Ege Teknik <noreply@example.test>", RESEND_API_BASE: mockBase,
  ORDER_ALERT_EMAILS: "ops@example.test, boss@example.test", SITE_ORIGIN: "https://egeteknik.tr", ADMIN_ORIGIN: "https://admin.example.test", NOTIFICATION_WORKER_DATABASE_URL: workerUrl, ...extra });

const cart = { customerName: "Ada <b>Yılmaz</b>", phone: "05000000000", email: "customer@example.test", city: "İzmir", district: "Bornova", address: "Disposable address test street 10",
  paymentProvider: "discovery", items: [{ productId: "http-product", quantity: 1 }], delivery: "pickup", expectedTotal: 10000, legalAcceptances: [] };
const placeOrder = async (key, over = {}) => {
  await owner.query("DELETE FROM rate_limit_buckets");
  const body = { ...cart, ...over }; const p = await request("/api/checkout/legal-preview", body); assertStatus(p, 200, "preview " + key);
  const accepted = { ...body, legalPreviewToken: p.data.legalPreviewToken, legalAcceptances: p.data.documents.map((d) => d.documentVersionId) };
  return { accepted, o: await request("/api/orders", accepted, key), preview: p };
};
// order 1 stays inside the 30-minute sweep window, so the worker legitimately keeps recovering it; its rows are parked as `sent` and excluded here
let order1Id = "";
const outbox = async () => (await owner.query("SELECT id, kind, status, attempts, last_error_code, dedupe_key, next_attempt_at, order_id FROM notification_outbox WHERE order_id <> $1 ORDER BY created_at, kind", [order1Id])).rows;

const grantsSql = readFileSync("docs/ops/notification-worker-grants-20261024.sql", "utf8");
const ident = (v) => { assert.match(v, /^[a-z][a-z0-9_]{2,62}$/); return `"${v}"`; };
const operatorSql = grantsSql.replaceAll(':"dbname"', ident(DB)).replaceAll(':"worker_role"', ident(ROLE.workerGroup)).replaceAll(':"worker_login"', ident(ROLE.workerLogin)).replaceAll(":'worker_password'", `'${workerPassword}'`);
assert.doesNotMatch(operatorSql, /:"[a-z_]+"|:'[a-z_]+'/, "all operator SQL placeholders were substituted");

try {
  // ---- 0. the cluster is the PR37 lab, and the database is NEW ------------------------------------------------------------------------
  const route = await attestDisposableCluster({ url: maintenanceUrl, query: (text, params) => maintenance.query(text, params), env: process.env });
  results.cluster = `disposable cluster attested (${route} route)`;
  assert.equal((await maintenance.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB])).rowCount, 0, "database already exists: refusing to reuse or reset it");
  const ownedRoles = [ROLE.probeBypass, ROLE.probeAdmin, ROLE.storefront, ROLE.admin, ...(LAB_MODE ? [] : [ROLE.workerLogin, ROLE.workerGroup])];
  assert.equal((await maintenance.query("SELECT 1 FROM pg_roles WHERE rolname = ANY($1)", [ownedRoles])).rowCount, 0, "role already exists: refusing to reuse or drop it");
  if (LAB_MODE) {
    assert.equal((await maintenance.query("SELECT 1 FROM pg_database WHERE datname = $1", [CLONE_FROM])).rowCount, 1, "template database exists");
    assert.equal(Number((await maintenance.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1", [CLONE_FROM])).rows[0].n), 0, "nobody is connected to the template database");
    await maintenance.query(`CREATE DATABASE "${DB}" TEMPLATE "${CLONE_FROM}"`);
  } else await maintenance.query(`CREATE DATABASE "${DB}"`);
  createdDatabase = true;
  owner = new pg.Pool({ connectionString: raw, max: 3 });
  if (!LAB_MODE) await bootstrapDisposableDatabase({ Pool: pg.Pool, drizzle, migrate, url: raw, journal, migrationsFolder: "drizzle-pg", ...defaultStageDeps, log: () => {} });
  assert.equal(Number((await owner.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n), journal.entries.length, "all migrations applied");
  results.migrations = LAB_MODE ? `${journal.entries.length} migrations, database cloned WITH TEMPLATE from the lab database (lab roles and fixed ACL under test)` : `${journal.entries.length} applied on a new database`;

  await owner.query("INSERT INTO products (id, slug, name, sku, price, sale_mode, delivery_class, status) VALUES ('http-product', 'http-product', 'HTTP Test Product', 'HTTP-TEST', 10000, 'online', 'shippable', 'published')");
  await owner.query("INSERT INTO inventory (id, product_id, on_hand, reserved) VALUES ('http-inventory', 'http-product', 3, 0)");
  for (const slug of ["distance-sales", "pre-information", "kvkk"]) {
    const title = `Disposable ${slug}`, body = `Local HTTP checkout test ${slug} legal body.`;
    await owner.query("INSERT INTO legal_documents (id, slug) VALUES ($1, $2)", [`http-doc-${slug}`, slug]);
    await owner.query(`INSERT INTO legal_document_versions (id, document_id, version, title, body, content_hash, effective_at, published_at, published_by) VALUES ($1, $2, 1, $3, $4, $5, '2020-01-01', '2020-01-01', 'owner-1')`, [`http-version-${slug}`, `http-doc-${slug}`, title, body, hashLegalDocument({ title, body })]);
  }
  await owner.query(`CREATE ROLE ${ROLE.storefront} LOGIN PASSWORD '${storePassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await owner.query(`CREATE ROLE ${ROLE.admin} LOGIN PASSWORD '${adminPassword}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await owner.query(`CREATE ROLE ${ROLE.probeBypass} LOGIN PASSWORD '${probePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS`);
  await owner.query(`CREATE ROLE ${ROLE.probeAdmin} LOGIN PASSWORD '${probePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await owner.query(`GRANT SELECT (id) ON public.admin_users TO ${ROLE.probeAdmin}`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${ROLE.probeBypass}, ${ROLE.probeAdmin}`);   // the identity query must reach its verdict, not stop at "no schema access"
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${ROLE.storefront}, ${ROLE.admin}`);
  await owner.query(`GRANT SELECT ON products, inventory, legal_documents, legal_document_versions, rate_limit_buckets TO ${ROLE.storefront}`);
  await owner.query(`GRANT INSERT ON customers, addresses, orders, order_items, order_legal_acceptances, rate_limit_buckets TO ${ROLE.storefront}`);
  await owner.query(`GRANT UPDATE (on_hand, reserved, version, updated_at) ON inventory TO ${ROLE.storefront}`);
  await owner.query(`GRANT UPDATE (count, window_started_at, expires_at) ON rate_limit_buckets TO ${ROLE.storefront}`);
  await owner.query(`GRANT DELETE ON rate_limit_buckets TO ${ROLE.storefront}`);
  await owner.query(`GRANT UPDATE (created_at) ON legal_documents TO ${ROLE.storefront}`);
  await owner.query(`GRANT EXECUTE ON FUNCTION public.lock_checkout_products(text[]) TO ${ROLE.storefront}`);
  await owner.query(`GRANT EXECUTE ON FUNCTION public.checkout_replay_by_key(text,text) TO ${ROLE.storefront}`);
  if (!LAB_MODE) await owner.query(operatorSql);              // the candidate's operator SQL, textually substituted, creates the worker identity
  results.operatorSql = LAB_MODE ? "not applied: the lab's own worker roles and ACL (as fixed) are used" : "applied to the new database only";

  // ---- 1. ACL matrix on the NARROW (column-level) ACL, in a child process ---------------------------------------------------------------
  const acl = spawnSync(process.execPath, ["scripts/test-notification-worker-acl.mjs"], { env: { ...process.env, CI: "true", WORKER_ACL_ADMIN_URL: raw, WORKER_ACL_WORKER_URL: workerUrl }, encoding: "utf8", timeout: 120000 });
  const aclOut = (acl.stdout + acl.stderr).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]");
  console.log(aclOut.trim().split("\n").filter((l) => /worker-acl\] (PASS|FAIL|INFO)/.test(l)).map((l) => "  " + l).join("\n"));
  assert.equal(acl.status, 0, "ACL matrix on the narrow ACL must pass completely");
  results.aclMatrix = "10/10 on the column-level ACL";

  // ---- 2. R1: no dispatch secret -> route absent; order 1 succeeds although the storefront has NO outbox grant ---------------------------
  await startServer(fullEnv({ NOTIFICATION_DISPATCH_SECRET: undefined }));
  const first = await placeOrder("pr37-order-1");
  assertStatus(first.o, 201, "order succeeds although the outbox INSERT is not permitted");
  const { id: order1IdValue, created_at: order1At } = (await owner.query("SELECT id, created_at FROM orders LIMIT 1")).rows[0];
  order1Id = order1IdValue;
  assert.equal(await count("notification_outbox"), 0, "the refused savepoint left no outbox row");
  assert.equal(await count("orders"), 1);
  assert.equal((await dispatch()).status, 404, "secret not configured: the route does not exist");
  results.outboxFailureDoesNotBlockOrder = "201, no outbox row, order intact";

  // ---- 3. fail-closed configuration matrix: every misconfiguration answers 503 and never reaches the provider -----------------------------
  await owner.query(`INSERT INTO admin_users (id, external_user_id, email, role, active) VALUES ('fallback-bait', 'password:bait', 'bait-admin@example.test', 'super_admin', true) ON CONFLICT DO NOTHING`);
  const misconfigs = [
    ["ORDER_ALERT_EMAILS missing (no admin_users fallback)", { ORDER_ALERT_EMAILS: undefined }, "not_configured"],
    ["ORDER_ALERT_EMAILS invalid", { ORDER_ALERT_EMAILS: "not-an-address, also bad" }, "not_configured"],
    ["worker URL missing", { NOTIFICATION_WORKER_DATABASE_URL: undefined }, "worker_unavailable"],
    ["worker URL reuses the storefront role", { NOTIFICATION_WORKER_DATABASE_URL: storefrontUrl }, "worker_unavailable"],
    ["worker URL reuses the admin role", { NOTIFICATION_WORKER_DATABASE_URL: adminUrl }, "worker_unavailable"],
    ["worker URL reuses the owner/legacy role", { NOTIFICATION_WORKER_DATABASE_URL: raw }, "worker_unavailable"],
    ["worker URL points to another database", { NOTIFICATION_WORKER_DATABASE_URL: urlFor(DB + "_other", ROLE.workerLogin, workerPassword) }, "worker_unavailable"],
    ["worker URL has a wrong password", { NOTIFICATION_WORKER_DATABASE_URL: urlFor(DB, ROLE.workerLogin, "wrong-" + secret()) }, "worker_unavailable"],
  ];
  const matrix = [];
  for (const [label, over, expected] of misconfigs) {
    await stopServer(); await startServer(fullEnv(over));
    const before = mail.calls.length, r = await dispatch();
    assert.equal(r.status, 503, `${label}: HTTP ${r.status}`);
    assert.deepEqual(r.data, { error: expected }, `${label}: body is exactly the generic error`);
    assert.equal(mail.calls.length, before, `${label}: the provider was never called`);
    matrix.push(`${label} -> 503 ${expected}`);
  }
  // A DISTINCT but over-privileged identity passes every URL check; only the run-time identity attestation can refuse it.
  for (const [label, role] of [["worker URL is a distinct BYPASSRLS role", ROLE.probeBypass], ["worker URL is a distinct role with access to admin_users", ROLE.probeAdmin]]) {
    await stopServer(); await startServer(fullEnv({ NOTIFICATION_WORKER_DATABASE_URL: urlFor(DB, role, probePassword) }));
    const before = mail.calls.length, mark = fullLog.length, r = await dispatch();
    assert.equal(r.status, 503, label); assert.deepEqual(r.data, { error: "worker_unavailable" }, label);
    assert.equal(mail.calls.length, before, `${label}: the provider was never called`);
    assert.ok(await logged(/notification_dispatch_unavailable[^\n]*identity/, mark), `${label}: logged as an identity refusal, code only`);
    matrix.push(`${label} -> 503 (run-time identity check)`);
  }
  results.failClosed = matrix;

  // ---- 4. R2: secret + worker env, e-mail service NOT configured ---------------------------------------------------------------------
  await stopServer(); await startServer(fullEnv({ RESEND_API_KEY: undefined, MAIL_FROM: undefined }));
  assert.equal((await dispatch(null)).status, 401, "no credentials");
  assert.equal((await dispatch("x".repeat(40))).status, 401, "wrong secret");
  for (let i = 0; i < 90; i++) { if ((await owner.query("SELECT now() - $1::timestamptz > interval '65 seconds' AS old", [order1At])).rows[0].old) break; await new Promise((r) => setTimeout(r, 1000)); }
  const swept = await dispatch();
  assert.equal(swept.status, 200); assert.equal(swept.data.providerConfigured, false, "no e-mail service configured is reported, not hidden");
  assert.equal(swept.data.swept, 2, "the WORKER role's sweep re-enqueued both notifications of the order whose enqueue was refused");
  assert.deepEqual((await owner.query("SELECT kind, status, attempts FROM notification_outbox ORDER BY kind")).rows.map((r) => [r.kind, r.status, r.attempts]), [["order_admin_new", "pending", 0], ["order_customer_received", "pending", 0]], "not configured: rows wait untouched, no attempt burned");
  assert.equal((await dispatch()).data.swept, 0, "a second run re-enqueues nothing (dedupe key)");
  await owner.query("DELETE FROM notification_outbox");
  const dbx = drizzle(owner, { schema });
  assert.equal(await sweepMissingNotifications(dbx, new Date(Date.now() + 3 * 3_600_000)), 0, "an old order is never back-filled");
  await owner.query("INSERT INTO notification_outbox (id, kind, order_id, dedupe_key, status, sent_at) SELECT gen_random_uuid()::text, k.kind, $1, 'order:' || $1 || ':' || k.kind, 'sent', now() FROM (VALUES ('order_customer_received'), ('order_admin_new')) AS k(kind)", [order1Id]);
  results.dispatchAuthAndSweep = "404 absent / 401 none / 401 wrong / 200 correct; worker sweep recovered 2 rows once; old orders never back-filled";

  // ---- 5. checkout matrix 200 / 201 / 200 / 409 with the outbox grant in place --------------------------------------------------------
  await owner.query(`GRANT INSERT ON notification_outbox TO ${ROLE.storefront}`);
  await stopServer(); await startServer(fullEnv());
  await owner.query("UPDATE inventory SET on_hand = 50 WHERE product_id = 'http-product'");
  const ordersBefore = await count("orders");
  const second = await placeOrder("pr37-order-2");
  assertStatus(second.preview, 200, "legal preview"); assertStatus(second.o, 201, "order created");
  const rows2 = await outbox();
  assert.equal(rows2.length, 2, "two rows: customer + admin"); assert.ok(rows2.every((r) => r.dedupe_key === `order:${r.order_id}:${r.kind}`));
  const replay = await request("/api/orders", second.accepted, "pr37-order-2");
  assertStatus(replay, 200, "idempotent replay"); assert.equal(replay.data.orderNumber, second.o.data.orderNumber); assert.equal((await outbox()).length, 2, "replay adds no notification");
  const conflict = await request("/api/orders", { ...second.accepted, note: "different request" }, "pr37-order-2");
  assertStatus(conflict, 409, "idempotency conflict"); assert.equal(conflict.data.code, "IDEMPOTENCY_KEY_REUSED"); assert.equal((await outbox()).length, 2);
  assert.equal(await count("orders"), ordersBefore + 1, "exactly one new order");
  results.checkout = "200 preview / 201 create / 200 replay / 409 conflict; 2 outbox rows; replay and conflict add none";

  // ---- 6. transaction rollback: stock disappears between preview and order -> 409, nothing persisted --------------------------------------
  await owner.query("DELETE FROM rate_limit_buckets");
  const pv = await request("/api/checkout/legal-preview", cart); assertStatus(pv, 200, "preview before the stock vanishes");
  const snap = { orders: await count("orders"), items: await count("order_items"), outbox: await count("notification_outbox"), acceptances: await count("order_legal_acceptances") };
  await owner.query("UPDATE inventory SET on_hand = 0 WHERE product_id = 'http-product'");
  const inventoryBefore = (await owner.query("SELECT on_hand, reserved, version FROM inventory WHERE product_id = 'http-product'")).rows[0];
  const stale = await request("/api/orders", { ...cart, legalPreviewToken: pv.data.legalPreviewToken, legalAcceptances: pv.data.documents.map((d) => d.documentVersionId) }, "pr37-order-rollback");
  assertStatus(stale, 409, "out-of-stock order is refused");
  assert.deepEqual({ orders: await count("orders"), items: await count("order_items"), outbox: await count("notification_outbox"), acceptances: await count("order_legal_acceptances") }, snap, "the failed checkout left no order, item, evidence or outbox row");
  assert.deepEqual((await owner.query("SELECT on_hand, reserved, version FROM inventory WHERE product_id = 'http-product'")).rows[0], inventoryBefore, "inventory untouched by the failed checkout");
  await owner.query("UPDATE inventory SET on_hand = 50 WHERE product_id = 'http-product'");
  results.rollback = "409 out-of-stock; orders/items/evidence/outbox/inventory unchanged";

  // ---- 8. delivery: exact content, idempotency keys, masked audit, no duplicates -----------------------------------------------------------
  mail.calls.length = 0;
  const activity = async () => Object.fromEntries((await owner.query("SELECT usename, count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 GROUP BY 1", [DB])).rows.map((r) => [r.usename, r.n]));
  const beforeActivity = await activity();
  const sent = await dispatch();
  const afterActivity = await activity();
  assert.ok((afterActivity[ROLE.workerLogin] ?? 0) > (beforeActivity[ROLE.workerLogin] ?? 0), "dispatch opened connections as the worker LOGIN role");
  assert.ok((afterActivity[ROLE.storefront] ?? 0) <= (beforeActivity[ROLE.storefront] ?? 0), "dispatch opened no storefront connection");
  assert.ok((afterActivity[ROLE.admin] ?? 0) <= (beforeActivity[ROLE.admin] ?? 0), "dispatch opened no admin connection");
  assert.equal(sent.data.providerConfigured, true); assert.equal(sent.data.sent, 2); assert.equal(mail.calls.length, 2);
  const customerCall = mail.calls.find((c) => c.body.to.includes("customer@example.test")), adminCall = mail.calls.find((c) => c.body.to.includes("ops@example.test"));
  assert.ok(customerCall && adminCall); assert.deepEqual(adminCall.body.to.sort(), ["boss@example.test", "ops@example.test"]);
  assert.equal(customerCall.headers["idempotency-key"], rows2.find((r) => r.kind === "order_customer_received").dedupe_key);
  assert.equal(adminCall.headers["idempotency-key"], rows2.find((r) => r.kind === "order_admin_new").dedupe_key);
  const orderNumber = second.o.data.orderNumber;
  assert.match(customerCall.body.text, new RegExp(orderNumber)); assert.match(customerCall.body.text, /Tahsil edilmedi/); assert.match(customerCall.body.text, /₺10\.000/);
  assert.doesNotMatch(customerCall.body.html, /<b>Y/); assert.match(customerCall.body.html, /&lt;b&gt;/);
  assert.match(adminCall.body.subject, new RegExp(orderNumber)); assert.doesNotMatch(adminCall.body.text, /Yılmaz|Bornova|customer@example\.test|05000000000|Disposable address/);
  assert.ok((await outbox()).every((r) => r.status === "sent"));
  const audits = (await owner.query("SELECT actor_user_id, actor_email, action, entity_type, request_id, ip_hash, created_at, payload::text AS p FROM audit_logs WHERE entity_type = 'notification' ORDER BY created_at")).rows;
  assert.equal(audits.filter((a) => a.action === "notification_sent").length, 2);
  assert.ok(audits.every((a) => a.actor_user_id === "system:notification-worker" && a.request_id === "" && a.ip_hash === "" && a.created_at instanceof Date), "request_id/ip_hash/created_at carry the column DEFAULTS ('', '', now()): the worker never writes the ungranted columns");
  const auditText = audits.map((a) => a.p).join("|");
  assert.match(auditText, /c\*\*\*@e\*\*\*\.test/); assert.doesNotMatch(auditText, /customer@example\.test|ops@example\.test|boss@example\.test/, "audit lines carry masked addresses only");
  assert.equal((await dispatch()).data.processed, 0); assert.equal(mail.calls.length, 2, "a second run sends nothing");
  results.delivery = "exact content, escaping, idempotency keys, masked audit under the 7-column ACL, no duplicate";

  // ---- 8b. the endpoint runs as the worker role: remove ONE grant and it must fail closed ------------------------------------------------
  await owner.query(`REVOKE SELECT (created_at) ON public.orders FROM ${ROLE.workerGroup}`);
  const revokedMark = fullLog.length, revoked = await dispatch();
  assert.equal(revoked.status, 503); assert.deepEqual(revoked.data, { error: "worker_unavailable" });
  assert.ok(await logged(/notification_dispatch_unavailable[^\n]*42501/, revokedMark), "the refusal is SQLSTATE 42501 and only the code is logged");
  await owner.query(`GRANT SELECT (created_at) ON public.orders TO ${ROLE.workerGroup}`);
  assert.equal((await dispatch()).status, 200, "grant restored: the worker works again");
  results.workerIdentity = "dispatch connects as the worker LOGIN only; one revoked column grant -> 503 (42501), restored -> 200";

  // ---- 9. retry, dead letter, requeue, maximum attempts -------------------------------------------------------------------------------
  const third = await placeOrder("pr37-order-3"); assertStatus(third.o, 201, "order 3");
  mail.mode = 503; mail.calls.length = 0;
  assert.equal((await dispatch()).data.retried, 2);
  const retryRows = (await outbox()).filter((r) => r.status === "pending");
  assert.ok(retryRows.length === 2 && retryRows.every((r) => r.attempts === 1 && r.last_error_code === "provider_5xx" && new Date(r.next_attempt_at) > new Date(Date.now() + 30_000)), "rescheduled with backoff");
  const callsAfterFail = mail.calls.length; assert.equal((await dispatch()).data.processed, 0, "not due yet"); assert.equal(mail.calls.length, callsAfterFail);
  mail.mode = 200; await owner.query("UPDATE notification_outbox SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending'");
  assert.equal((await dispatch()).data.sent, 2, "sent on the second attempt");
  const fourth = await placeOrder("pr37-order-4"); assertStatus(fourth.o, 201, "order 4");
  mail.mode = 422; assert.equal((await dispatch()).data.dead, 2);
  const deadRows = (await owner.query("SELECT id, last_error_code FROM notification_outbox WHERE status = 'dead'")).rows;
  assert.ok(deadRows.length === 2 && deadRows.every((r) => r.last_error_code === "invalid_recipient"));
  mail.mode = 200; mail.calls.length = 0; assert.equal((await dispatch()).data.processed, 0, "dead rows are not retried automatically");
  assert.equal(await requeueDeadNotification(dbx, deadRows[0].id, { userId: "admin-1", email: "admin@example.test" }), true);
  assert.equal(await requeueDeadNotification(dbx, deadRows[0].id, { userId: "admin-1", email: "admin@example.test" }), false);
  assert.equal((await dispatch()).data.sent, 1); assert.equal(mail.calls.length, 1);
  // five failing attempts in a row end in a dead row, never a sixth send
  await owner.query("UPDATE notification_outbox SET status = 'pending', attempts = 0, sent_at = NULL, last_error_code = NULL, next_attempt_at = now() WHERE id = $1", [deadRows[1].id]);
  mail.mode = 503; mail.calls.length = 0;
  for (let attempt = 1; attempt <= 5; attempt++) {
    await owner.query("UPDATE notification_outbox SET next_attempt_at = now() - interval '1 second' WHERE id = $1 AND status = 'pending'", [deadRows[1].id]);
    await dispatch();
  }
  const exhausted = (await owner.query("SELECT status, attempts, last_error_code FROM notification_outbox WHERE id = $1", [deadRows[1].id])).rows[0];
  assert.deepEqual(exhausted, { status: "dead", attempts: 5, last_error_code: "attempts_exhausted" }, "maximum 5 attempts, then dead");
  assert.equal(mail.calls.length, 5, "exactly five provider calls"); mail.calls.length = 0; await dispatch(); assert.equal(mail.calls.length, 0, "no sixth attempt");
  mail.mode = 200;
  results.retryDeadMax = "503 -> backoff -> sent on attempt 2; 422 -> dead; requeue audited; 5 attempts -> dead(attempts_exhausted), no 6th call";

  // ---- 10. concurrency and crash recovery ---------------------------------------------------------------------------------------------
  await owner.query("UPDATE notification_outbox SET status = 'pending', attempts = 0, sent_at = NULL, last_error_code = NULL, next_attempt_at = now() WHERE id = $1", [deadRows[1].id]);
  mail.calls.length = 0;
  const burst = await Promise.all(Array.from({ length: 6 }, () => dispatch()));
  assert.ok(burst.every((r) => r.status === 200));
  assert.equal(burst.reduce((n, r) => n + r.data.sent, 0), 1, "six concurrent workers send one row once"); assert.equal(mail.calls.length, 1);
  const fifth = await placeOrder("pr37-order-5"); assertStatus(fifth.o, 201, "order 5");
  await owner.query("UPDATE notification_outbox SET status = 'sending', locked_until = now() - interval '1 minute', attempts = 1 WHERE status = 'pending'");
  mail.calls.length = 0; assert.equal((await dispatch()).data.sent, 2, "rows abandoned by a crashed worker are reclaimed after the lock expires"); assert.equal(mail.calls.length, 2);
  await owner.query("UPDATE notification_outbox SET status = 'sending', locked_until = now() - interval '1 minute', attempts = 5, sent_at = NULL WHERE id = $1", [deadRows[1].id]);
  mail.calls.length = 0; await dispatch(); assert.equal(mail.calls.length, 0, "a stalled row at the attempt ceiling is dead, never re-sent");
  assert.equal((await owner.query("SELECT status FROM notification_outbox WHERE id = $1", [deadRows[1].id])).rows[0].status, "dead");
  // bulk concurrency: 12 fresh rows, six workers, each provider call at most once
  const bulkOrders = []; for (let i = 0; i < 6; i++) { const r = await placeOrder(`pr37-bulk-${i}`); assertStatus(r.o, 201, "bulk order " + i); bulkOrders.push(r.o.data.orderNumber); }
  mail.calls.length = 0;
  const bulk = await Promise.all(Array.from({ length: 6 }, () => dispatch()));
  const keys = mail.calls.map((c) => c.headers["idempotency-key"]);
  assert.equal(new Set(keys).size, keys.length, "no duplicate provider call"); assert.equal(keys.length, 12, "12/12 notifications delivered");
  assert.equal(bulk.reduce((n, r) => n + r.data.sent, 0), 12);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM notification_outbox WHERE status <> 'sent' AND id <> $1", [deadRows[1].id])).rows[0].n, 0);
  results.concurrency = "6 concurrent workers: 1 row sent once; stale lock reclaimed; ceiling row dead; 12/12 bulk delivered with 0 duplicate provider calls";

  // ---- 10b. a long worker outage: the default 30-minute sweep cannot recover an old order; the floor-bound window can, once, without duplicates ----
  const workerPool = new pg.Pool({ connectionString: workerUrl, max: 2 }), wdb = drizzle(workerPool, { schema });
  try {
    await owner.query(`REVOKE INSERT ON notification_outbox FROM ${ROLE.storefront}`);
    const x = await placeOrder("pr37-outage-x"), z = await placeOrder("pr37-outage-z");
    await owner.query(`GRANT INSERT ON notification_outbox TO ${ROLE.storefront}`);
    assertStatus(x.o, 201, "outage order X"); assertStatus(z.o, 201, "outage order Z");
    const orderRows = (await owner.query("SELECT id, created_at FROM orders WHERE order_number = ANY($1) ORDER BY created_at", [[x.o.data.orderNumber, z.o.data.orderNumber]])).rows;
    assert.equal(orderRows.length, 2);
    const rowsFor = async () => Number((await owner.query("SELECT count(*)::int AS n FROM notification_outbox WHERE order_id = ANY($1)", [orderRows.map((r) => r.id)])).rows[0].n);
    assert.equal(await rowsFor(), 0, "both orders were committed without any notification because the enqueue was refused");
    const later = new Date(Date.now() + 2 * 3_600_000);                       // the worker has been down for two hours
    assert.equal(await sweepMissingNotifications(wdb, later, {}), 0, "THE HOLE (default configuration): a 30-minute window cannot recover orders after a 2 h outage");
    assert.equal(await rowsFor(), 0);
    const floorAfter = new Date(orderRows[1].created_at.getTime() + 1000).toISOString(), floorBefore = new Date(orderRows[0].created_at.getTime() - 60_000).toISOString();
    for (const [label, env] of [["a long window without a floor", { NOTIFICATION_SWEEP_WINDOW_MINUTES: "180" }],
      ["an invalid floor", { NOTIFICATION_SWEEP_WINDOW_MINUTES: "180", NOTIFICATION_SWEEP_NOT_BEFORE: "garbage" }],
      ["a floor after both orders: history is never mailed", { NOTIFICATION_SWEEP_WINDOW_MINUTES: "180", NOTIFICATION_SWEEP_NOT_BEFORE: floorAfter }]]) {
      assert.equal(await sweepMissingNotifications(wdb, later, env), 0, label);
    }
    assert.equal(await rowsFor(), 0, "unsafe or inconsistent configuration recovers nothing");
    const recoverEnv = { NOTIFICATION_SWEEP_WINDOW_MINUTES: "180", NOTIFICATION_SWEEP_NOT_BEFORE: floorBefore };
    assert.equal(await sweepMissingNotifications(wdb, later, recoverEnv), 4, "window + go-live floor recover both orders (2 notifications each) through the WORKER role");
    assert.equal(await rowsFor(), 4);
    assert.equal(await sweepMissingNotifications(wdb, later, recoverEnv), 0, "a second sweep creates no duplicate");
    mail.calls.length = 0; mail.mode = 200;
    assert.equal((await dispatch()).data.sent, 4);
    const outageKeys = mail.calls.map((c) => c.headers["idempotency-key"]);
    assert.equal(new Set(outageKeys).size, 4, "exactly one mail per notification (distinct provider idempotency keys)");
    assert.equal(await sweepMissingNotifications(wdb, later, recoverEnv), 0);
    mail.calls.length = 0; await dispatch(); assert.equal(mail.calls.length, 0, "nothing is ever sent twice");
    results.outageRecovery = "default 30 min window leaves a 2 h-old unnotified order forever; window+floor recovers it once via the worker role; unsafe config recovers nothing; 4 mails, 0 duplicates";
  } finally { await workerPool.end(); }

  if (STRESS_ROUNDS > 0) {
    await owner.query("UPDATE inventory SET on_hand = 100000 WHERE product_id = 'http-product'");
    let maxLockWaiters = 0, sampling = true;
    const sampler = (async () => { while (sampling) { try { maxLockWaiters = Math.max(maxLockWaiters, Number((await owner.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = 'Lock'", [DB])).rows[0].n)); } catch { /* sampling only */ } await new Promise((r) => setTimeout(r, 15)); } })();
    const stressStart = latencies.length, roundMs = [];
    for (let i = 0; i < STRESS_ROUNDS; i++) {
      for (let k = 0; k < 3; k++) assertStatus((await placeOrder(`pr37-stress-${i}-${k}`)).o, 201, "stress order");
      mail.calls.length = 0; const t0 = Date.now();
      const burst = await Promise.all(Array.from({ length: 6 }, () => dispatch()));
      roundMs.push(Date.now() - t0);
      assert.ok(burst.every((r) => r.status === 200), `round ${i}: every concurrent dispatch answered 200`);
      assert.equal(burst.reduce((n, r) => n + r.data.sent, 0), 6, `round ${i}: 3 orders x 2 notifications sent exactly once`);
      const ks = mail.calls.map((c) => c.headers["idempotency-key"]); assert.equal(new Set(ks).size, ks.length, `round ${i}: no duplicate provider call`);
    }
    sampling = false; await sampler;
    const lat = latencies.slice(stressStart).sort((a, b) => a - b), pct = (q) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))];
    results.stress = `${STRESS_ROUNDS} rounds x 6 concurrent dispatches (${lat.length} requests): p50 ${pct(0.5)} ms, p95 ${pct(0.95)} ms, max ${lat.at(-1)} ms, slowest round ${Math.max(...roundMs)} ms, max sessions waiting on a Lock: ${maxLockWaiters}, 0 hangs, 0 duplicates`;
  }
  { const all = [...latencies].sort((a, b) => a - b); results.dispatchLatencyMs = { requests: all.length, p50: all[Math.floor(all.length / 2)], p95: all[Math.floor(all.length * 0.95)], max: all.at(-1) }; }

  // ---- 11. leak scan: no secret, password, URL or customer datum in any HTTP body or server log ---------------------------------------------------
  const secretsOnly = { ownerPassword, storePassword, adminPassword, workerPassword, dispatchSecret, providerKey: "test-key-not-real", connectionString: "postgresql://", signingSecret };
  const customerData = { customerEmail: "customer@example.test", opsEmail: "ops@example.test", bossEmail: "boss@example.test", phone: "05000000000", street: "Disposable address test street" };
  const scan = (text, dict) => Object.entries(dict).filter(([, v]) => v && text.includes(v)).map(([k]) => k);
  const checkoutBodies = bodies.filter((b) => !dispatchBodies.includes(b)).join("\n");
  // The checkout response may echo the customer's OWN data back to that customer; it must still never carry a secret.
  assert.deepEqual(scan(fullLog, { ...secretsOnly, ...customerData }), [], "the server log carries no secret and no customer datum");
  assert.deepEqual(scan(dispatchBodies.join("\n"), { ...secretsOnly, ...customerData }), [], "dispatch answers carry no secret and no customer datum");
  assert.deepEqual(scan(checkoutBodies, secretsOnly), [], "checkout responses carry no secret");
  const echoed = scan(checkoutBodies, customerData);
  results.checkoutEchoesOwnData = echoed.length ? `info: checkout responses return ${echoed.join(", ")} to the requesting customer only` : "none";
  assert.ok(dispatchBodies.length > 20 && dispatchBodies.every((b) => Object.keys(JSON.parse(b)).every((k) => ["error", "ok", "swept", "processed", "sent", "retried", "dead", "providerConfigured"].includes(k))), "dispatch answers counts and generic errors only");
  results.leakScan = `clean: server log (${Math.round(fullLog.length / 1024)} KiB) and ${dispatchBodies.length} dispatch answers carry no secret or customer datum; checkout responses carry no secret`;

  console.log("[pr37-http] PASS " + JSON.stringify(results));
} catch (error) {
  console.error("[pr37-http] FAIL:", (error instanceof Error ? error.message : String(error)).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]").slice(0, 900));
  console.error("[pr37-http] server diagnostics (last 1200 chars):", fullLog.slice(-1200).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]"));
  console.error("[pr37-http] results so far: " + JSON.stringify(results));
  process.exitCode = 1;
} finally {
  await stopServer();
  await new Promise((r) => mock.close(r));
  if (owner) await owner.end().catch(() => {});
  // remove everything this run created (database first, then the roles that owned privileges in it) - and nothing else
  if (!createdDatabase) console.log("[pr37-http] cleanup: nothing was created by this run, nothing is dropped");
  else try {
    await maintenance.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    const created = [ROLE.probeBypass, ROLE.probeAdmin, ROLE.storefront, ROLE.admin, ...(LAB_MODE ? [] : [ROLE.workerLogin, ROLE.workerGroup])];
    for (const r of created) await maintenance.query(`DROP ROLE IF EXISTS ${r}`);
    console.log("[pr37-http] cleanup: scratch database and roles dropped");
  } catch (error) { console.error("[pr37-http] cleanup incomplete:", (error instanceof Error ? error.message : String(error)).slice(0, 200)); process.exitCode = 1; }
  await maintenance.end().catch(() => {});
}
