#!/usr/bin/env node
/**
 * PR #37: ACL matrix of the dedicated notification-worker LOGIN against a DISPOSABLE loopback PostgreSQL.
 *
 *   1. role attributes: no superuser / createdb / createrole / replication / bypassrls; may not SET ROLE
 *   2. EFFECTIVE privileges, computed per column with has_column_privilege (tables AND views), must equal the minimal set EXACTLY
 *   3. real statements through the worker connection: every forbidden one must fail with SQLSTATE 42501
 *   4. the allowed ones must pass the privilege check (proved without leaving data behind: ROLLBACK, or a 23503 FK error that can only
 *      occur after the INSERT privilege was accepted)
 *
 * env: WORKER_ACL_ADMIN_URL (owner/admin of the SAME database), WORKER_ACL_WORKER_URL (worker LOGIN), CI=true.
 * Refuses anything that is not a loopback `sprintb*` database on a cluster scripts/disposable-cluster-attest.mjs accepts as disposable.
 * Prints no password, URL or row data.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { attestDisposableCluster } from "./disposable-cluster-attest.mjs";

const adminRaw = process.env.WORKER_ACL_ADMIN_URL, workerRaw = process.env.WORKER_ACL_WORKER_URL;
const parse = (raw) => { try { return new URL(raw); } catch { return null; } };
const a = parse(adminRaw), w = parse(workerRaw);
const refuse = (why) => { console.error(`[worker-acl] REFUSED: ${why}`); process.exit(1); };
if (process.env.CI !== "true") refuse("requires CI=true");
if (!a || !w) refuse("both URLs are required");
for (const u of [a, w]) if (!["127.0.0.1", "localhost", "::1"].includes(u.hostname) || !u.pathname.slice(1).startsWith("sprintb") || !["postgres:", "postgresql:"].includes(u.protocol)) refuse("loopback sprintb database only");
if (a.host !== w.host || a.pathname !== w.pathname) refuse("admin and worker must target the same database");
if (a.username === w.username) refuse("admin and worker must be different roles");

const MINIMAL = {
  // The worker has NO privilege on the orders table. It reads orders only through this view (docs/ops/notification-worker-grants-20261024.sql).
  notification_orders: { SELECT: ["city", "created_at", "customer_name", "delivery_method", "district", "email", "id", "installation_preference", "installation_total", "order_number", "payment_status", "shipping_total", "status", "subtotal", "total", "vat_total"] },
  order_items: { SELECT: ["line_total", "order_id", "product_name", "quantity", "unit_price"] },
  notification_outbox: {
    SELECT: ["attempts", "created_at", "dedupe_key", "id", "kind", "last_attempt_at", "last_error_code", "locked_until", "next_attempt_at", "order_id", "sent_at", "status"],
    INSERT: ["dedupe_key", "id", "kind", "order_id"],
    UPDATE: ["attempts", "last_attempt_at", "last_error_code", "locked_until", "next_attempt_at", "sent_at", "status"],
  },
  audit_logs: { INSERT: ["action", "actor_email", "actor_user_id", "entity_id", "entity_type", "id", "payload"] },
};
const VIEW_COLUMNS = MINIMAL.notification_orders.SELECT;
const expectedSet = new Set(Object.entries(MINIMAL).flatMap(([t, privs]) => Object.entries(privs).flatMap(([p, cols]) => cols.map((c) => `${t}.${c}:${p}`))));

const admin = new pg.Pool({ connectionString: adminRaw, max: 2 });
const worker = new pg.Pool({ connectionString: workerRaw, max: 2 });
// The cluster itself must be provably disposable (same proof as the HTTP suite) before any statement is sent through the worker.
try { await attestDisposableCluster({ url: adminRaw, query: (text, params) => admin.query(text, params), env: process.env }); }
catch (error) { await Promise.allSettled([admin.end(), worker.end()]); refuse(error instanceof Error ? error.message : "disposable cluster refused"); }
const results = [];
const record = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`[worker-acl] ${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`); };
const check = async (name, fn) => { try { await fn(); record(name, true); } catch (error) { record(name, false, (error instanceof Error ? error.message : String(error)).slice(0, 300)); } };
/** Run one statement through the worker connection; return the SQLSTATE (or "ok"). */
const attempt = async (sqlText, { rollback = true } = {}) => {
  const client = await worker.connect();
  try {
    await client.query("BEGIN");
    await client.query(sqlText);
    await client.query(rollback ? "ROLLBACK" : "COMMIT");
    return "ok";
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    return error?.code ?? "unknown";
  } finally { client.release(); }
};

try {
  const who = (await worker.query("SELECT current_user AS u, session_user AS s, current_setting('role') AS r")).rows[0];
  const login = who.s;

  await check("1. worker role attributes are minimal (no superuser/createdb/createrole/replication/bypassrls)", async () => {
    const r = (await admin.query("SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1", [login])).rows[0];
    assert.deepEqual(r, { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true });
    const members = (await admin.query("SELECT g.rolname, m.set_option, m.admin_option FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1", [login])).rows;
    assert.ok(members.every((m) => m.set_option === false && m.admin_option === false), "memberships carry neither SET nor ADMIN option");
    assert.ok(members.every((m) => !/^pg_/.test(m.rolname)), "no predefined pg_* role");
  });

  await check("2. EFFECTIVE column privileges equal the minimal set exactly (nothing missing, nothing extra)", async () => {
    const rows = (await admin.query(`
      SELECT c.relname AS t, a.attname AS col, p.priv
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS p(priv)
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND has_column_privilege($1, c.oid, a.attnum, p.priv)`, [login])).rows;
    const actual = new Set(rows.map((r) => `${r.t}.${r.col}:${r.priv}`));
    const extra = [...actual].filter((x) => !expectedSet.has(x)).sort(), missing = [...expectedSet].filter((x) => !actual.has(x)).sort();
    assert.deepEqual({ extra: extra.slice(0, 12), extraCount: extra.length, missing }, { extra: [], extraCount: 0, missing: [] });
  });

  await check("3. no table-level DELETE/TRUNCATE/TRIGGER/MAINTAIN, no CREATE on any schema, no USAGE on drizzle or other app schemas", async () => {
    const t = (await admin.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v') AND (has_table_privilege($1, c.oid, 'DELETE') OR has_table_privilege($1, c.oid, 'TRUNCATE') OR has_table_privilege($1, c.oid, 'TRIGGER') OR has_table_privilege($1, c.oid, 'MAINTAIN'))`, [login])).rows;
    assert.deepEqual(t, []);
    const s = (await admin.query(`SELECT nspname, has_schema_privilege($1, oid, 'USAGE') AS u, has_schema_privilege($1, oid, 'CREATE') AS c FROM pg_namespace WHERE nspname !~ '^pg_' ORDER BY 1`, [login])).rows;
    assert.ok(s.every((x) => x.c === false), "CREATE on no schema");
    assert.equal(s.find((x) => x.nspname === "drizzle")?.u, false, "no USAGE on drizzle");
    assert.equal(s.find((x) => x.nspname === "public")?.u, true, "public USAGE (needed)");
    assert.equal((await admin.query("SELECT has_database_privilege($1, current_database(), 'CREATE') AS c", [login])).rows[0].c, false);
  });

  await check("4. no EXECUTE on ANY application function: the checkout lock / replay functions, and any SECURITY DEFINER function that could widen what the worker reads", async () => {
    for (const fn of ["public.lock_checkout_products(text[])", "public.checkout_replay_by_key(text,text)"]) {
      const exists = (await admin.query("SELECT to_regprocedure($1) IS NOT NULL AS e", [fn])).rows[0].e;
      if (exists) assert.equal((await admin.query("SELECT has_function_privilege($1, $2, 'EXECUTE') AS x", [login, fn])).rows[0].x, false, fn);
    }
    // A function created later keeps PostgreSQL's default EXECUTE for PUBLIC unless it is revoked, so an owner-rights function over orders would
    // reopen exactly what the view closes. Every function outside the system schemas must be unreachable for the worker (extension members excluded;
    // trigger functions are excluded because PostgreSQL refuses to call them outside a trigger: they are not a read path).
    const reachable = (await admin.query(`SELECT n.nspname || '.' || p.proname || CASE WHEN p.prosecdef THEN ' [SECURITY DEFINER]' ELSE '' END AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
        AND p.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
        AND has_function_privilege($1, p.oid, 'EXECUTE') ORDER BY 1`, [login])).rows.map((r) => r.fn);
    assert.deepEqual(reachable, [], `the worker can execute no application function (reachable: ${reachable.join(", ") || "none"})`);
  });

  await check("5. every other public table is unreadable: admin_users and all non-allowed tables answer 42501", async () => {
    const tables = (await admin.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.tablename);
    assert.ok(tables.includes("admin_users"), "admin_users exists in this database");
    const allowedTables = new Set(Object.keys(MINIMAL));
    const leaks = [];
    for (const table of tables.filter((x) => !allowedTables.has(x))) {
      const code = await attempt(`SELECT 1 FROM public."${table}" LIMIT 1`);
      if (code !== "42501") leaks.push(`${table}:${code}`);
    }
    assert.deepEqual(leaks, []);
    const views = (await admin.query("SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.viewname);
    for (const view of views.filter((x) => !allowedTables.has(x))) { const code = await attempt(`SELECT 1 FROM public."${view}" LIMIT 1`); if (code !== "42501") leaks.push(`view ${view}:${code}`); }
    assert.deepEqual(leaks, []);
    assert.equal(await attempt("SELECT email, role FROM public.admin_users"), "42501");
    assert.equal(await attempt("SELECT count(*) FROM public.admin_users"), "42501");
  });

  await check("6. sensitive data is unreachable by ANY path: orders is unreadable (phone, street address and the snapshot included), the view has no such column, SELECT * is refused where it would need more", async () => {
    // The table: nothing at all, not even the columns the e-mails need (they come from the view).
    for (const col of ["phone", "address", "notes", "billing_address_snapshot", "shipping_address_snapshot", "request_fingerprint", "idempotency_key", "customer_id", "legal_evidence_version", "id", "email"]) {
      assert.equal(await attempt(`SELECT ${col} FROM public.orders LIMIT 1`), "42501", `orders.${col}`);
    }
    for (const sqlText of ["SELECT * FROM public.orders LIMIT 1", "SELECT count(*) FROM public.orders", "SELECT row_to_json(o) FROM public.orders o LIMIT 1", "SELECT to_jsonb(o) FROM public.orders o LIMIT 1",
      "SELECT shipping_address_snapshot ->> 'line1' FROM public.orders LIMIT 1", "SELECT shipping_address_snapshot -> 'phone' FROM public.orders LIMIT 1"]) {
      assert.equal(await attempt(sqlText), "42501", sqlText);
    }
    // The view: those things do not exist in it (42703 undefined column), so there is no value to read and nothing to leak through an error message.
    for (const col of ["phone", "address", "notes", "billing_address_snapshot", "shipping_address_snapshot", "request_fingerprint", "idempotency_key", "customer_id", "legal_evidence_version", "recipient_name", "line1", "recipientName"]) {
      assert.equal(await attempt(`SELECT ${col} FROM public.notification_orders LIMIT 1`), "42703", `notification_orders.${col}`);
    }
    assert.equal(await attempt("SELECT o.shipping_address_snapshot FROM public.notification_orders o"), "42703", "no qualified path either");
    assert.equal(await attempt("SELECT notification_orders FROM public.notification_orders LIMIT 1"), "ok", "the whole-row value of the view is allowed: it only holds the whitelisted columns (check 11)");
    assert.equal(await attempt("SELECT * FROM public.order_items LIMIT 1"), "42501");
    assert.equal(await attempt("SELECT product_snapshot FROM public.order_items LIMIT 1"), "42501");
    assert.equal(await attempt("SELECT payload FROM public.audit_logs LIMIT 1"), "42501", "worker may append audit rows, not read them");
  });

  await check("7. forbidden writes answer 42501 (orders, outbox identity columns, audit update/delete, truncate, request_id/ip_hash/created_at)", async () => {
    const cases = [
      "UPDATE public.orders SET status = 'cancelled' WHERE false",
      "UPDATE public.notification_orders SET status = 'cancelled' WHERE false",
      "UPDATE public.notification_orders SET email = 'x' WHERE false",
      "DELETE FROM public.notification_orders WHERE false",
      "INSERT INTO public.notification_orders (id) VALUES ('x')",
      "DELETE FROM public.orders WHERE false",
      "INSERT INTO public.order_items (id) VALUES ('x')",
      "UPDATE public.notification_outbox SET kind = 'order_admin_new' WHERE false",
      "UPDATE public.notification_outbox SET order_id = 'x' WHERE false",
      "UPDATE public.notification_outbox SET dedupe_key = 'x' WHERE false",
      "DELETE FROM public.notification_outbox WHERE false",
      "TRUNCATE public.notification_outbox",
      "INSERT INTO public.notification_outbox (id, kind, order_id, dedupe_key, status) VALUES ('a', 'order_admin_new', 'o', 'k', 'sent')",
      "INSERT INTO public.audit_logs (id, actor_user_id, actor_email, action, entity_type, entity_id, payload, request_id) VALUES ('a','u','e','x','y','z','{}','r')",
      "INSERT INTO public.audit_logs (id, actor_user_id, actor_email, action, entity_type, entity_id, payload, ip_hash) VALUES ('a','u','e','x','y','z','{}','h')",
      "INSERT INTO public.audit_logs (id, actor_user_id, actor_email, action, entity_type, entity_id, payload, created_at) VALUES ('a','u','e','x','y','z','{}', now())",
      "UPDATE public.audit_logs SET action = 'x' WHERE false",
      "DELETE FROM public.audit_logs WHERE false",
      "TRUNCATE public.audit_logs",
    ];
    const bad = [];
    for (const sqlText of cases) { const code = await attempt(sqlText); if (code !== "42501") bad.push(`${code}: ${sqlText.slice(0, 60)}`); }
    assert.deepEqual(bad, []);
  });

  await check("8. DDL and server-level escapes answer 42501 (CREATE/DROP/ALTER, SET ROLE, file/program access, role catalog, migration ledger)", async () => {
    const adminRole = (await admin.query("SELECT current_user AS u")).rows[0].u;
    const cases = [
      "CREATE TABLE public.pr37_worker_probe (id int)", "CREATE SCHEMA pr37_worker_probe", "DROP TABLE public.notification_outbox",
      "ALTER TABLE public.notification_outbox ADD COLUMN pr37_probe int", "CREATE INDEX pr37_probe ON public.notification_outbox (status)",
      `SET ROLE "${adminRole}"`, "SELECT pg_read_file('/etc/hosts')", "COPY (SELECT 1) TO PROGRAM 'true'", "COPY public.notification_outbox TO '/tmp/pr37-probe.csv'",
      "SELECT rolpassword FROM pg_authid", "SELECT * FROM drizzle.__drizzle_migrations", "ALTER ROLE CURRENT_USER SUPERUSER", "CREATE ROLE pr37_probe_role",
      "GRANT SELECT ON public.admin_users TO PUBLIC",
      "CREATE OR REPLACE VIEW public.notification_orders AS SELECT * FROM public.orders",
      "ALTER VIEW public.notification_orders SET (security_invoker = true)",
      "ALTER VIEW public.notification_orders RENAME TO pr37_probe_view",
      "DROP VIEW public.notification_orders",
      "CREATE VIEW public.pr37_probe_view AS SELECT * FROM public.orders",
    ];
    const bad = [];
    for (const sqlText of cases) { const code = await attempt(sqlText); if (code !== "42501") bad.push(`${code}: ${sqlText.slice(0, 55)}`); }
    // The worker holds SELECT on the view WITHOUT grant option, so PostgreSQL answers a re-grant with a WARNING ("no privileges were granted"), not an error.
    // What matters is the effect: after it, PUBLIC (and any other role) still has nothing on the view.
    // Autocommit, so a grant that DID take effect would be visible to the admin connection (and to check 11).
    await worker.query("GRANT SELECT ON public.notification_orders TO PUBLIC").catch((error) => { if (error?.code !== "42501") throw error; });
    const effect = (await admin.query("SELECT has_table_privilege('public', 'public.notification_orders', 'SELECT') AS p")).rows[0].p;
    if (effect) bad.push("true: GRANT TO PUBLIC changed the ACL");
    // ALTER SYSTEM cannot run inside a transaction block, so it is tried outside one.
    const systemCode = await worker.query("ALTER SYSTEM SET work_mem = '64MB'").then(() => "ok", (error) => error?.code ?? "unknown");
    if (systemCode !== "42501") bad.push(`${systemCode}: ALTER SYSTEM`);
    assert.deepEqual(bad, []);
  });

  await check("9. allowed operations pass the privilege check (rollback only; INSERT proven by a 23503 FK error, which follows the privilege check)", async () => {
    assert.equal(await attempt("SELECT id, order_number, created_at, subtotal, vat_total, shipping_total, installation_total, total, customer_name, email, installation_preference, city, payment_status, status, district, delivery_method FROM public.notification_orders WHERE false"), "ok");
    assert.equal(await attempt("SELECT order_id, product_name, quantity, unit_price, line_total FROM public.order_items WHERE false"), "ok");
    assert.equal(await attempt("SELECT id, kind, order_id, dedupe_key, status, attempts, next_attempt_at, last_attempt_at, locked_until, last_error_code, sent_at, created_at FROM public.notification_outbox WHERE false"), "ok");
    assert.equal(await attempt("UPDATE public.notification_outbox SET status = 'pending', attempts = 0, last_attempt_at = now(), next_attempt_at = now(), locked_until = NULL, last_error_code = NULL, sent_at = NULL WHERE false"), "ok");
    assert.equal(await attempt("SELECT id FROM public.notification_outbox WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED"), "ok");
    assert.equal(await attempt("INSERT INTO public.audit_logs (id, actor_user_id, actor_email, action, entity_type, entity_id, payload) VALUES (gen_random_uuid()::text, 'system:acl-test', 'system@notifications.invalid', 'acl_probe', 'notification', 'x', '{\"recipient\":\"c***@e***.test\"}'::jsonb)"), "ok");
    assert.equal(await attempt("INSERT INTO public.notification_outbox (id, kind, order_id, dedupe_key) VALUES (gen_random_uuid()::text, 'order_admin_new', 'no-such-order', 'order:no-such-order:order_admin_new') ON CONFLICT (dedupe_key) DO NOTHING"), "23503");
    assert.equal(await attempt("INSERT INTO public.notification_outbox (id, kind, order_id, dedupe_key) SELECT gen_random_uuid()::text, k.kind, o.id, 'order:' || o.id || ':' || k.kind FROM public.notification_orders o CROSS JOIN (VALUES ('order_customer_received'), ('order_admin_new')) AS k(kind) WHERE o.created_at >= now() - interval '30 minutes' ON CONFLICT (dedupe_key) DO NOTHING"), "ok");
  });

  await check("10. TEMP is the only residual (inherited from PUBLIC) and is reported, never silently accepted", async () => {
    const temp = (await admin.query("SELECT has_database_privilege($1, current_database(), 'TEMPORARY') AS t", [login])).rows[0].t;
    console.log(`[worker-acl] INFO residual TEMPORARY privilege via PUBLIC: ${temp}`);
  });

  await check("11. the view is owner-rights + security_barrier, exposes exactly the whitelisted columns (no json), is not owned or writable by the worker, and PUBLIC has nothing", async () => {
    const v = (await admin.query(`SELECT c.relkind, c.reloptions, pg_get_userbyid(c.relowner) AS owner, c.relowner, pg_get_viewdef(c.oid) AS def
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'notification_orders'`)).rows[0];
    assert.ok(v, "public.notification_orders exists");
    assert.equal(v.relkind, "v");
    assert.deepEqual([...(v.reloptions ?? [])].sort(), ["security_barrier=true", "security_invoker=false"], "owner-rights (not invoker) and barrier");
    const member = (await admin.query("SELECT m.roleid FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1", [login])).rows.map((r) => r.roleid);
    assert.ok(v.relowner !== (await admin.query("SELECT oid FROM pg_roles WHERE rolname = $1", [login])).rows[0].oid && !member.includes(v.relowner), "the view is owned neither by the worker login nor by a group it belongs to");
    const cols = (await admin.query(`SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'notification_orders' AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attname`)).rows;
    assert.deepEqual(cols.map((c) => c.attname), [...VIEW_COLUMNS].sort(), "exactly the whitelisted columns");
    assert.deepEqual(cols.filter((c) => /json/i.test(c.type)), [], "no json or jsonb column: the snapshot cannot travel through the view");
    const def = v.def;
    assert.equal((def.match(/shipping_address_snapshot/g) ?? []).length, 2, "the snapshot is referenced exactly twice");
    assert.equal((def.match(/shipping_address_snapshot\s*->/g) ?? []).length, 2, "and only to extract a scalar, never selected whole");
    assert.ok(/'district'/.test(def) && /'delivery'/.test(def) && /'method'/.test(def), "the district and the delivery method are what is extracted");
    assert.doesNotMatch(def, /\b(phone|address|notes|billing_address_snapshot|request_fingerprint|idempotency_key|customer_id|legal_evidence_version)\b|'line1'|'phone'|recipientName/, "no sensitive column or key is referenced");
    const acl = (await admin.query(`SELECT c.relname, a.grantee, a.privilege_type, a.is_grantable, pg_get_userbyid(a.grantee) AS who FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname = 'public' AND c.relname = ANY($1)`, [["notification_orders", "orders", "order_items", "notification_outbox", "audit_logs", "admin_users"]])).rows;
    assert.deepEqual(acl.filter((r) => String(r.grantee) === "0"), [], "PUBLIC holds no privilege on the view or on any table the worker touches");
    const onView = acl.filter((r) => r.relname === "notification_orders" && r.who !== v.owner);
    assert.deepEqual([...new Set(onView.map((r) => r.privilege_type))], ["SELECT"], "everyone but the owner holds at most SELECT on the view");
    assert.deepEqual(acl.filter((r) => r.relname === "orders" && r.who !== v.owner && member.includes(r.grantee)), [], "no group of the worker holds anything on orders");
    // Without GRANT OPTION the worker cannot hand the view (or anything) to PUBLIC or another role: PostgreSQL answers a re-grant with a warning and no effect.
    assert.deepEqual(acl.filter((r) => r.who !== v.owner && r.is_grantable), [], "nobody but the owner holds a privilege WITH GRANT OPTION on the view or any table the worker touches");
    assert.equal((await admin.query("SELECT has_table_privilege($1, 'public.notification_orders', 'SELECT WITH GRANT OPTION') AS g", [login])).rows[0].g, false, "the worker login has no SELECT WITH GRANT OPTION on the view");
    assert.equal((await admin.query("SELECT has_table_privilege('public', 'public.notification_orders', 'SELECT') AS p")).rows[0].p, false, "PUBLIC has no SELECT on the view");
    // search_path cannot redirect the view: every reference in it was bound to public.orders when it was created. The worker keeps TEMP (PUBLIC default),
    // so it CAN create a temp table named orders and put pg_temp first; the view must still read the real table.
    const client = await worker.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query(`CREATE TEMP TABLE orders (id text, order_number text, created_at timestamptz, subtotal int, vat_total int, shipping_total int, installation_total int, total int,
        customer_name text, email text, installation_preference text, city text, payment_status text, status text, shipping_address_snapshot jsonb)`).then(() => true, (error) => error?.code === "42501" ? false : Promise.reject(error));
      if (created) {
        await client.query("INSERT INTO pg_temp.orders (id, email) VALUES ('temp-shadow-order', 'shadow@example.test')");
        await client.query("SET LOCAL search_path = pg_temp, public");
        const seen = (await client.query("SELECT id FROM public.notification_orders")).rows.map((r) => r.id);
        assert.ok(!seen.includes("temp-shadow-order"), "a temp table named orders and a hostile search_path do not redirect the view");
        const unqualified = (await client.query("SELECT id FROM notification_orders")).rows.map((r) => r.id);
        assert.ok(!unqualified.includes("temp-shadow-order"), "not even through the unqualified name");
      }
    } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`[worker-acl] ${failed.length ? "FAIL" : "PASS"} ${results.length - failed.length}/${results.length} checks`);
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error("[worker-acl] FAIL: harness error:", (error instanceof Error ? error.message : String(error)).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]").slice(0, 300));
  process.exitCode = 1;
} finally {
  await admin.end(); await worker.end();
}
