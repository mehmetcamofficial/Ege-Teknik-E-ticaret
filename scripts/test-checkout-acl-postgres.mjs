#!/usr/bin/env node
/**
 * Permanent real-PostgreSQL ACL matrix of the checkout STOREFRONT role, with the canonical grants (docs/ops/checkout-storefront-grants-20261029.sql).
 *
 *   1. refuses unless CI=true and CHECKOUT_ACL_PG_URL is a loopback PostgreSQL URL that is not the recovery port (55432) - no Neon, no Preview, no Production;
 *   2. proves the CLUSTER is disposable with scripts/disposable-cluster-attest.mjs (same proof as the worker, B9 and attestation suites);
 *   3. opens an oid ledger BEFORE creating anything, then creates its OWN database (sprintb_ckacl_*) and two LOGIN roles (storefront, admin) with random names
 *      and a random password, migrates the database 0000-head with the repository migrator, applies the canonical grants, and checks:
 *        - role attributes: no superuser / createdb / createrole / replication / bypassrls, may log in, member of no role, owns nothing
 *        - EFFECTIVE privileges (has_*_privilege per column, table, sequence, schema, database) equal the reviewed minimum EXACTLY: nothing more, nothing less
 *        - every SECURITY DEFINER function in public: no PUBLIC EXECUTE; the storefront may execute exactly lock_checkout_products and checkout_replay_by_key
 *        - real statements through the storefront connection: every forbidden one fails with SQLSTATE 42501, every allowed one passes the privilege check
 *        - the admin role holds no table, column, sequence or function privilege at all
 *   4. fails unless EXACTLY the expected number of checks ran and passed, then drops what it created - each object only if its CURRENT oid equals the recorded
 *      one - and verifies that nothing of this run is left.
 *
 * It never prints a URL, host, role name or password. env: CHECKOUT_ACL_PG_URL (host and credentials of the disposable cluster; its database part only supplies
 * the login, and the login must be a superuser of that cluster).
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { applyStorefrontGrants } from "./checkout-storefront-grants.mjs";
import { attestDisposableCluster } from "./disposable-cluster-attest.mjs";
import { bootstrapDisposableDatabase, defaultStageDeps } from "./disposable-postgres-bootstrap.mjs";
import { openLedger, releaseOwned } from "./test-resource-ledger.mjs";

const EXPECTED_CHECKS = 13;
const LOOPBACK = ["127.0.0.1", "localhost", "::1"];
const refuse = (why) => { console.error(`[checkout-acl] REFUSED: ${why}`); process.exit(1); };
const redact = (text) => text.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[redacted]");
let failed = false;
const fail = (why) => { failed = true; console.error(`[checkout-acl] FAIL: ${redact(String(why)).slice(0, 600)}`); };

const base = (() => { try { return new URL(process.env.CHECKOUT_ACL_PG_URL ?? ""); } catch { return null; } })();
if (process.env.CI !== "true") refuse("requires CI=true");
if (!base || !["postgres:", "postgresql:"].includes(base.protocol)) refuse("CHECKOUT_ACL_PG_URL must be a PostgreSQL URL");
if (!LOOPBACK.includes(base.hostname.replace(/^\[|\]$/g, ""))) refuse("loopback PostgreSQL URL required");
if (base.port === "55432") refuse("the recovery cluster port is never allowed");

const urlFor = (database, user, password) => { const u = new URL(base); u.pathname = `/${database}`; if (user) { u.username = user; u.password = password; } return u.toString(); };
const maintenance = new pg.Pool({ connectionString: urlFor("postgres"), max: 1, connectionTimeoutMillis: 8000 });
maintenance.on("error", () => {});
const nonce = randomBytes(5).toString("hex");
const password = randomBytes(18).toString("base64url");
const names = { db: `sprintb_ckacl_${nonce}`, storefront: `sprintb_ckacl_${nonce}_store`, admin: `sprintb_ckacl_${nonce}_admin` };
const quoted = (n) => `"${n}"`;
let ledger = null, owner = null, storefront = null, admin = null;

// The reviewed minimum, written out independently of the SQL file: file and matrix must change together or this gate fails.
const SELECT_ALL = ["products", "inventory", "legal_documents", "legal_document_versions", "rate_limit_buckets"];
const INSERT_ALL = ["customers", "addresses", "orders", "order_items", "order_legal_acceptances", "rate_limit_buckets"];
const UPDATE_COLUMNS = { inventory: ["on_hand", "reserved", "updated_at", "version"], rate_limit_buckets: ["count", "expires_at", "window_started_at"], legal_documents: ["created_at"] };
const EXECUTABLE_DEFINERS = ["checkout_replay_by_key", "lock_checkout_products"];

const results = [];
const record = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`[checkout-acl] ${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`); if (!ok) failed = true; };
const check = async (name, fn) => { try { await fn(); record(name, true); } catch (error) { record(name, false, redact(error instanceof Error ? error.message : String(error)).slice(0, 400)); } };
const same = (actual, expected, what) => { const a = JSON.stringify([...actual].sort()), e = JSON.stringify([...expected].sort()); if (a !== e) throw new Error(`${what}: extra=${JSON.stringify([...actual].filter((x) => !expected.includes(x)))} missing=${JSON.stringify([...expected].filter((x) => !actual.includes(x)))}`); };

/** One statement through a role's connection, always rolled back. Returns the SQLSTATE, or "ok". */
async function attempt(pool, sql) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query(sql); await client.query("ROLLBACK"); return "ok"; }
  catch (error) { try { await client.query("ROLLBACK"); } catch { /* ignore */ } return typeof error?.code === "string" ? error.code : "error"; }
  finally { client.release(); }
}

const effectivePrivileges = async (role) => {
  const rows = (...q) => owner.query(...q).then((r) => r.rows);
  const columns = (await rows(`SELECT c.relname || '.' || a.attname || ':' || p.priv AS item FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND has_column_privilege($1::name, c.oid, a.attnum, p.priv)`, [role])).map((r) => r.item);
  const tables = (await rows(`SELECT c.relname || ':' || p.priv AS item FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      CROSS JOIN (VALUES ('DELETE'), ('TRUNCATE'), ('TRIGGER'), ('MAINTAIN')) p(priv) WHERE c.relkind IN ('r', 'p') AND has_table_privilege($1::name, c.oid, p.priv)`, [role])).map((r) => r.item);
  const sequences = (await rows(`SELECT c.relname || ':' || p.priv AS item FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) p(priv) WHERE c.relkind = 'S' AND has_sequence_privilege($1::name, c.oid, p.priv)`, [role])).map((r) => r.item);
  const schemas = (await rows(`SELECT n.nspname || ':' || p.priv AS item FROM pg_namespace n CROSS JOIN (VALUES ('USAGE'), ('CREATE')) p(priv)
      WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema' AND has_schema_privilege($1::name, n.oid, p.priv)`, [role])).map((r) => r.item);
  const database = (await rows(`SELECT p.priv AS item FROM (VALUES ('CREATE')) p(priv) WHERE has_database_privilege($1::name, current_database(), p.priv)`, [role])).map((r) => r.item);
  const functions = (await rows(`SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) AS signature, p.prosecdef AS definer, has_function_privilege($1::name, p.oid, 'EXECUTE') AS role_can,
      has_function_privilege('public', p.oid, 'EXECUTE') AS public_can FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'`, [role]));
  return { columns, tables, sequences, schemas, database, functions };
};

try {
  let route;
  try { route = await attestDisposableCluster({ url: urlFor("postgres"), query: (text, params) => maintenance.query(text, params), env: process.env }); }
  catch (error) { throw new Error(`the cluster could not be reached or proven disposable (${error instanceof Error ? error.message.split(":")[0] : "error"}): this is not a pass`); }
  console.log(`[checkout-acl] disposable cluster attested (${route} route)`);
  const systemId = (await maintenance.query("SELECT system_identifier::text AS id FROM pg_control_system()")).rows[0].id;
  ledger = openLedger({ suite: "ckacl", systemId });
  if (!(await maintenance.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0]?.rolsuper) throw new Error("the cluster login must be a superuser of the disposable cluster");
  if ((await maintenance.query("SELECT 1 FROM pg_database WHERE datname = $1", [names.db])).rowCount) throw new Error("a scratch name already exists");

  for (const key of ["storefront", "admin"]) {
    await maintenance.query(`CREATE ROLE ${quoted(names[key])} LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`);
    ledger.state.roles.push({ name: names[key], oid: (await maintenance.query("SELECT oid::text AS oid FROM pg_roles WHERE rolname = $1", [names[key]])).rows[0].oid }); ledger.save();
  }
  await maintenance.query(`CREATE DATABASE ${quoted(names.db)}`);
  ledger.state.databases.push({ name: names.db, oid: (await maintenance.query("SELECT oid::text AS oid FROM pg_database WHERE datname = $1", [names.db])).rows[0].oid }); ledger.save();

  const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
  await bootstrapDisposableDatabase({ Pool: pg.Pool, drizzle, migrate, url: urlFor(names.db), journal, migrationsFolder: "drizzle-pg", ...defaultStageDeps, log: () => {} });
  owner = new pg.Pool({ connectionString: urlFor(names.db), max: 2 }); owner.on("error", () => {});
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${quoted(names.admin)}`);          // the admin role gets what the HTTP gates give it: schema usage and nothing else
  await applyStorefrontGrants((text) => owner.query(text), names.storefront);
  storefront = new pg.Pool({ connectionString: urlFor(names.db, names.storefront, password), max: 2 }); storefront.on("error", () => {});
  admin = new pg.Pool({ connectionString: urlFor(names.db, names.admin, password), max: 1 }); admin.on("error", () => {});
  const login = (await owner.query("SELECT current_user::text AS u")).rows[0].u;
  const mine = await effectivePrivileges(names.storefront);

  await check("role attributes: login only, no superuser / createdb / createrole / replication / bypassrls", async () => {
    const r = (await owner.query("SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = $1", [names.storefront])).rows[0];
    if (JSON.stringify(r) !== JSON.stringify({ rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolinherit: false })) throw new Error(JSON.stringify(r));
  });
  await check("the storefront role is a member of no role and owns no object", async () => {
    const members = (await owner.query("SELECT count(*)::int AS n FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1", [names.storefront])).rows[0].n;
    const owned = (await owner.query("SELECT (SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1)::int + (SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = $1)::int AS n", [names.storefront])).rows[0].n;
    if (members !== 0 || owned !== 0) throw new Error(`memberships=${members} owned=${owned}`);
  });
  await check("effective column privileges equal the reviewed minimum exactly (SELECT, INSERT, UPDATE, REFERENCES)", async () => {
    const all = async (table) => (await owner.query("SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped", [table])).rows.map((r) => r.attname);
    const expected = [];
    for (const t of SELECT_ALL) for (const c of await all(t)) expected.push(`${t}.${c}:SELECT`);
    for (const t of INSERT_ALL) for (const c of await all(t)) expected.push(`${t}.${c}:INSERT`);
    for (const [t, cols] of Object.entries(UPDATE_COLUMNS)) for (const c of cols) expected.push(`${t}.${c}:UPDATE`);
    same(mine.columns, expected, "column privileges");
  });
  await check("effective table privileges: DELETE on rate_limit_buckets only; no TRUNCATE, TRIGGER or MAINTAIN anywhere", () => same(mine.tables, ["rate_limit_buckets:DELETE"], "table privileges"));
  await check("no privilege on any sequence", () => same(mine.sequences, [], "sequence privileges"));
  await check("schema and database: USAGE on public only; no CREATE on any schema or on the database; nothing on the drizzle ledger schema", () => {
    same(mine.schemas, ["public:USAGE"], "schema privileges"); same(mine.database, [], "database privileges");
  });
  await check("role is not given the sensitive reads: orders, customers, addresses, order_items, order_legal_acceptances, admin_users, notification_outbox have no SELECT column at all", () => {
    const leaked = mine.columns.filter((c) => /^(orders|customers|addresses|order_items|order_legal_acceptances|admin_users|audit_logs|notification_outbox)\.[^:]+:SELECT$/.test(c));
    if (leaked.length) throw new Error(`${leaked.length} column(s) readable`);
  });
  await check("products and orders: no UPDATE and no DELETE at table or column level", () => {
    const bad = [...mine.columns.filter((c) => /^(products|orders)\.[^:]+:UPDATE$/.test(c)), ...mine.tables.filter((t) => /^(products|orders):DELETE$/.test(t))];
    if (bad.length) throw new Error(`${bad.length} privilege(s)`);
  });
  await check("SECURITY DEFINER functions in public: PUBLIC has no EXECUTE on any, and the storefront can execute exactly the two checkout entry points", () => {
    const name = (f) => f.signature.split("(")[0];
    const definers = mine.functions.filter((f) => f.definer);
    if (definers.filter((f) => EXECUTABLE_DEFINERS.includes(name(f))).length !== 2) throw new Error("the two checkout functions are not both SECURITY DEFINER");
    const publicExec = definers.filter((f) => f.public_can).map(name);
    if (publicExec.length) throw new Error(`PUBLIC can execute: ${publicExec.join(", ")}`);
    same(definers.filter((f) => f.role_can).map(name), EXECUTABLE_DEFINERS, "definer functions executable by the storefront");
  });
  await check("the two checkout functions pin their search_path (no object can be substituted by the caller)", async () => {
    const rows = (await owner.query("SELECT proname, prosecdef, proconfig::text AS cfg FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public' WHERE proname IN ('lock_checkout_products', 'checkout_replay_by_key')")).rows;
    if (rows.length !== 2 || rows.some((r) => !r.prosecdef || !/search_path=pg_catalog/.test(r.cfg ?? ""))) throw new Error(JSON.stringify(rows.map((r) => [r.proname, r.prosecdef])));
  });
  await check("forbidden statements through the storefront login all fail with SQLSTATE 42501", async () => {
    const forbidden = [
      "SELECT 1 FROM orders", "SELECT 1 FROM customers", "SELECT 1 FROM addresses", "SELECT 1 FROM order_items", "SELECT 1 FROM order_legal_acceptances", "SELECT 1 FROM admin_users", "SELECT 1 FROM notification_outbox",
      "SELECT id FROM products FOR UPDATE", "UPDATE products SET name = name WHERE false", "UPDATE orders SET status = status WHERE false", "UPDATE inventory SET product_id = product_id WHERE false",
      "DELETE FROM orders WHERE false", "DELETE FROM products WHERE false", "TRUNCATE rate_limit_buckets", "CREATE TABLE public.ckacl_probe (i int)", "SELECT 1 FROM drizzle.__drizzle_migrations",
      "ALTER TABLE products ADD COLUMN ckacl_probe int", "CREATE ROLE ckacl_probe_role", "SELECT rolpassword FROM pg_authid", `SET ROLE ${quoted(login)}`, "SET SESSION AUTHORIZATION postgres",
    ];
    const wrong = [];
    for (const sql of forbidden) {
      const code = await attempt(storefront, sql);
      const authorizationDenied =
        sql === "SET SESSION AUTHORIZATION postgres" &&
        (code === "42501" || code === "22023");
      if (code !== "42501" && !authorizationDenied) {
        wrong.push(`${sql.slice(0, 40)} -> ${code}`);
      }
    }
    if (wrong.length) throw new Error(wrong.join("; "));
  });
  await check("allowed statements pass the privilege check; the two functions are reachable and reject an invalid argument (22023) instead of a missing grant (42501)", async () => {
    const allowed = ["SELECT id FROM products LIMIT 1", "SELECT id FROM legal_documents FOR SHARE", "SELECT 1 FROM rate_limit_buckets", "DELETE FROM rate_limit_buckets WHERE false", "UPDATE inventory SET on_hand = on_hand WHERE false",
      "UPDATE rate_limit_buckets SET count = count WHERE false", "UPDATE legal_documents SET created_at = created_at WHERE false", "INSERT INTO customers DEFAULT VALUES", "INSERT INTO orders DEFAULT VALUES",
      "INSERT INTO order_items DEFAULT VALUES", "INSERT INTO order_legal_acceptances DEFAULT VALUES", "INSERT INTO addresses DEFAULT VALUES", "INSERT INTO rate_limit_buckets DEFAULT VALUES"];
    const wrong = [];
    for (const sql of allowed) { const code = await attempt(storefront, sql); if (code === "42501") wrong.push(`${sql.slice(0, 40)} -> 42501`); }
    for (const [sql, code] of [["SELECT public.lock_checkout_products(ARRAY[]::text[])", "22023"], ["SELECT public.checkout_replay_by_key('short', 'x')", "22023"]]) { const got = await attempt(storefront, sql); if (got !== code) wrong.push(`${sql.slice(0, 40)} -> ${got}`); }
    if (wrong.length) throw new Error(wrong.join("; "));
  });
  await check("the admin role holds no table, column, sequence or function privilege (schema USAGE only)", async () => {
    const theirs = await effectivePrivileges(names.admin);
    same([...theirs.columns, ...theirs.tables, ...theirs.sequences, ...theirs.database], [], "admin privileges");
    same(theirs.schemas, ["public:USAGE"], "admin schema privileges");
    same(theirs.functions.filter((f) => f.definer && f.role_can).map((f) => f.signature), [], "admin definer functions");
    if ((await attempt(admin, "SELECT 1 FROM orders")) !== "42501") throw new Error("admin can read orders");
  });

  if (results.length !== EXPECTED_CHECKS || results.some((r) => !r.ok)) throw new Error(`expected exactly ${EXPECTED_CHECKS} passing checks, saw ${results.filter((r) => r.ok).length} of ${results.length}`);
  console.log(`[checkout-acl] OK: ${EXPECTED_CHECKS} checks executed against real PostgreSQL sessions, 0 skipped.`);
} catch (error) {
  fail(error instanceof Error ? error.message : error);
} finally {
  await Promise.allSettled([storefront?.end(), admin?.end(), owner?.end()]);
  if (!ledger || (ledger.state.databases.length + ledger.state.roles.length) === 0) console.log("[checkout-acl] cleanup: nothing was created by this run, nothing is dropped");
  else {
    try {
      const problems = await releaseOwned({ query: (t, p) => maintenance.query(t, p), databases: ledger.state.databases, roles: ledger.state.roles });
      const left = (await maintenance.query("SELECT (SELECT count(*) FROM pg_database WHERE datname LIKE $1)::int + (SELECT count(*) FROM pg_roles WHERE rolname LIKE $1)::int AS n", [`sprintb_ckacl_${nonce}%`])).rows[0].n;
      if (problems.length || left !== 0) fail(`cleanup incomplete (${problems.length} problem(s), ${left} object(s) left)`);
      else { ledger.remove(); console.log("[checkout-acl] cleanup: scratch database and roles dropped"); }
    } catch (error) { fail(`cleanup incomplete: ${error instanceof Error ? error.message : error}`); }
  }
  await maintenance.end().catch(() => {});
  if (failed) process.exitCode = 1;
}
