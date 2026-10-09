/**
 * Sprint B.1 — the concurrency-sensitive SQL against a REAL, DISPOSABLE PostgreSQL.
 *
 * (Kept at the top level of tests/ on purpose: a subdirectory would make `sh` expand the npm test glob (tests, double-star, *.test.ts) to that
 * directory alone and silently drop the rest of the suite.)
 *
 * Opt-in: runs only when SPRINTB_PG_URL is set (otherwise every test is skipped, so `npm test` stays hermetic).
 * Hard safety guards: the URL must point at loopback and the database name must start with "sprintb". The suite
 * DROPS and recreates the public/drizzle schemas of that database, so it refuses anything else.
 *
 *   docker run -d --name ege-sprintb-pg -e POSTGRES_PASSWORD=... -e POSTGRES_DB=sprintb -p 127.0.0.1:55432:5432 postgres:18-alpine
 *   SPRINTB_PG_URL=postgresql://postgres:...@127.0.0.1:55432/sprintb npm test -- tests/sprint-b-postgres.integration.test.ts
 *
 * Nothing here uses a fake repository: the production dependency builders (lib/*-db.ts) run through Drizzle on real
 * pooled connections, so every "concurrent" case is several independent PostgreSQL transactions.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import test, { after } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "../db/schema.ts";
import { auditedMutationOn } from "../lib/admin-audited-db.ts";
import { claimRateLimit, maybePurgeExpiredBuckets, PURGE_BATCH } from "../lib/rate-limit.ts";
import { createRateLimitStore } from "../lib/rate-limit-db.ts";
import { reserveSecondHandProduct } from "../lib/second-hand-reservation.ts";
import { secondHandReservationDeps } from "../lib/second-hand-reservation-db.ts";
import { transitionOrder } from "../lib/order-transition.ts";
import { orderTransitionDeps } from "../lib/order-transition-db.ts";

const URL_ENV = process.env.SPRINTB_PG_URL;
const skip = URL_ENV ? false : "SPRINTB_PG_URL is not set (real-PostgreSQL verification is opt-in)";
const opts = { skip, timeout: 60_000 };
const actor = { userId: "admin-1", email: "admin@example.test" };
const NOW = () => new Date();
/** Drizzle wraps driver errors ("Failed query"); the PostgreSQL message is on `cause`. */
const causedBy = (pattern: RegExp) => (error: unknown) => pattern.test(String((error as { cause?: { message?: string } })?.cause?.message ?? error));

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
const deadlocks: unknown[] = [];

async function setup() {
  const target = new URL(URL_ENV!);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(target.hostname), "the integration DB must be a loopback instance");
  assert.ok(target.pathname.slice(1).startsWith("sprintb"), 'the integration DB name must start with "sprintb"');
  pool = new pg.Pool({ connectionString: URL_ENV, max: 40 });
  db = drizzle(pool, { schema });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  // Same path production took: 0000-0010, then a legacy owner exists, then 0011 (owner -> super_admin) and 0012.
  const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
  const partial = mkdtempSync(join(tmpdir(), "sprintb-mig-"));
  mkdirSync(join(partial, "meta"));
  writeFileSync(join(partial, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 11) }));
  for (const entry of journal.entries.slice(0, 11)) cpSync(`drizzle-pg/${entry.tag}.sql`, join(partial, `${entry.tag}.sql`));
  await migrate(db, { migrationsFolder: partial });
  await pool.query("insert into admin_users (id, external_user_id, email, role, active) values ('owner-1', 'password:o@example.test', 'o@example.test', 'owner', true)");
  await migrate(db, { migrationsFolder: "drizzle-pg" });
  // The forced-failure hook for the audit test: a real DB-level refusal, not a mock.
  await pool.query(`create function sprintb_block_audit() returns trigger language plpgsql as $$ begin if new.entity_type = 'forced_failure' then raise exception 'forced audit failure'; end if; return new; end $$;
    create trigger sprintb_block_audit_trg before insert on audit_logs for each row execute function sprintb_block_audit();`);
}

const noDeadlock = (results: PromiseSettledResult<unknown>[]) => {
  for (const r of results) if (r.status === "rejected" && (r.reason as { code?: string })?.code === "40P01") deadlocks.push(r.reason);
};

async function seedUsed(id: string, stock: number, status = "published") {
  await db.insert(schema.usedProducts).values({ id, slug: id, name: id, category: "test", stock, status });
}
const claimSecondHand = (productId: string, reservationId: string) =>
  reserveSecondHandProduct({ reservationId, productId, name: "Ada", phone: "05001112233", now: NOW(), expiresAt: new Date(Date.now() + 30 * 60_000) }, secondHandReservationDeps(db));

async function seedOrder(id: string, status: string, onHand: number, reserved: number, quantity: number, productId = `prod-${id}`) {
  await db.insert(schema.products).values({ id: productId, slug: productId, name: productId, sku: productId });
  await db.insert(schema.inventory).values({ id: `inv-${id}`, productId, onHand, reserved });
  await db.insert(schema.orders).values({ id, orderNumber: `N-${id}`, idempotencyKey: `key-${id}`, customerName: "Ada", phone: "05001112233", city: "İzmir", address: "Sokak No 1 Bornova", status });
  await db.insert(schema.orderItems).values({ id: `item-${id}`, orderId: id, productId, productName: productId, unitPrice: 100, vatRateBps: 2000, vatAmount: 17, quantity, lineTotal: 100 * quantity });
  return productId;
}
const transition = (orderId: string, expectedStatus: string, nextStatus: string) =>
  transitionOrder({ orderId, expectedStatus: expectedStatus as never, nextStatus: nextStatus as never, actor }, orderTransitionDeps(db));
const inv = async (productId: string) => (await pool.query("select on_hand, reserved from inventory where product_id=$1", [productId])).rows[0] as { on_hand: number; reserved: number };
const one = async (q: string, params: unknown[] = []) => Number((await pool.query(q, params)).rows[0].n);

test("setup: the disposable database is migrated to head through the real migrator (0011 promotes the legacy owner)", opts, async () => {
  await setup();
  const headCount = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8")).entries.length; // 13 before the finance ledger, 14 with 0013
  assert.equal(await one("select count(*)::int n from drizzle.__drizzle_migrations"), headCount);
  assert.equal(await one("select count(*)::int n from admin_users where role='super_admin' and active"), 1);
  assert.equal(await one("select count(*)::int n from admin_users where role='owner'"), 0);
});

test("setup: migration 0017 is recorded exactly once in Drizzle with the source hash and locked-down function ACL", opts, async () => {
  const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
  const entry = journal.entries.find((item: { tag: string }) => item.tag === "0017_checkout_product_lock");
  assert.ok(entry, "migration 0017 must exist in the journal");
  assert.equal(journal.entries.length, 18, "the migration ledger should contain 0000 through 0017");

  const source = readFileSync(`drizzle-pg/${entry.tag}.sql`, "utf8");
  const expectedHash = createHash("sha256").update(source).digest("hex");
  const migrations = (await pool.query(
    "SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations WHERE created_at = $1::bigint",
    [String(entry.when)],
  )).rows;
  assert.equal(migrations.length, 1, "the Drizzle migrator must record 0017 exactly once");
  assert.equal(migrations[0].hash, expectedHash, "recorded hash must match the migration file");
  assert.equal(migrations[0].created_at, String(entry.when));
  assert.equal(await one("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations"), 18);

  const functions = (await pool.query(`SELECT p.prosecdef AS security_definer,
    pg_get_userbyid(p.proowner) AS owner,
    EXISTS (
      SELECT 1 FROM aclexplode(p.proacl) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) AS public_can_execute
    FROM pg_proc AS p
    WHERE p.oid = 'public.lock_checkout_products(text[])'::regprocedure`)).rows;
  assert.equal(functions.length, 1, "migration must install the checkout lock function");
  assert.equal(functions[0].security_definer, true);
  assert.equal(functions[0].public_can_execute, false, "PUBLIC EXECUTE must be revoked by the same migration");

  // Re-running the migrator must not append a second 0017 record.
  await migrate(db, { migrationsFolder: "drizzle-pg" });
  assert.equal(await one("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations"), 18);
});

test("1. second-hand: stock=1 and two genuinely concurrent independent transactions => exactly one reservation", opts, async () => {
  await seedUsed("u-one", 1);
  const results = await Promise.allSettled([claimSecondHand("u-one", "res-a"), claimSecondHand("u-one", "res-b")]);
  noDeadlock(results);
  const outcomes = results.map((r) => (r.status === "fulfilled" ? (r.value.ok ? "ok" : r.value.code) : "error"));
  assert.deepEqual(outcomes.sort(), ["UNAVAILABLE", "ok"]);
  assert.equal(await one("select count(*)::int n from second_hand_reservations where product_id='u-one'"), 1);
});

test("1b. second-hand: stock=3 with 25 concurrent claims => exactly 3 reservations, never more", opts, async () => {
  await seedUsed("u-three", 3);
  const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => claimSecondHand("u-three", `res-three-${i}`)));
  noDeadlock(results);
  assert.equal(results.filter((r) => r.status === "fulfilled" && r.value.ok).length, 3);
  assert.equal(results.filter((r) => r.status === "rejected").length, 0, "no transaction failed or deadlocked");
  assert.equal(await one("select count(*)::int n from second_hand_reservations where product_id='u-three'"), 3);
});

test("1c. second-hand: same idempotency key concurrently => one reservation, both callers get the same reservation; stock=0 and expired cases", opts, async () => {
  await seedUsed("u-idem", 1);
  const [a, b] = await Promise.all([claimSecondHand("u-idem", "res-same"), claimSecondHand("u-idem", "res-same")]);
  assert.ok(a.ok && b.ok);
  assert.equal(a.ok && b.ok && a.reservationId, "res-same");
  assert.equal(await one("select count(*)::int n from second_hand_reservations where product_id='u-idem'"), 1);
  await seedUsed("u-zero", 0);
  const zero = await claimSecondHand("u-zero", "res-zero");
  assert.deepEqual(zero.ok, false);
  assert.equal(await one("select count(*)::int n from second_hand_reservations where product_id='u-zero'"), 0, "no write on stock=0");
  await seedUsed("u-exp", 1);
  await pool.query("insert into second_hand_reservations (id, product_id, name, phone, expires_at) values ('res-old','u-exp','Old','05000000000', now() - interval '1 minute')");
  const fresh = await claimSecondHand("u-exp", "res-new");
  assert.ok(fresh.ok, "an expired reservation no longer blocks a new one");
});

test("1d. second-hand: a failure inside the transaction leaves no partial reservation", opts, async () => {
  await seedUsed("u-fail", 1);
  await pool.query("create function sprintb_fail_res() returns trigger language plpgsql as $$ begin if new.product_id = 'u-fail' then raise exception 'forced insert failure'; end if; return new; end $$; create trigger sprintb_fail_res_trg before insert on second_hand_reservations for each row execute function sprintb_fail_res();");
  await assert.rejects(claimSecondHand("u-fail", "res-fail"), causedBy(/forced insert failure/));
  assert.equal(await one("select count(*)::int n from second_hand_reservations where product_id='u-fail'"), 0);
  await pool.query("drop trigger sprintb_fail_res_trg on second_hand_reservations");
  assert.ok((await claimSecondHand("u-fail", "res-fail-2")).ok, "the product is still claimable after the failed attempt");
});

test("2. cancellation: two concurrent cancels from the same state => one effective transition, stock restored exactly once", opts, async () => {
  const p = await seedOrder("c1", "paid", 8, 2, 2);
  const results = await Promise.allSettled([transition("c1", "paid", "cancelled"), transition("c1", "paid", "cancelled")]);
  noDeadlock(results);
  const values = results.map((r) => (r.status === "fulfilled" ? (r.value.ok ? "ok" : r.value.code) : "error"));
  assert.deepEqual(values.sort(), ["STALE", "ok"]);
  assert.deepEqual(await inv(p), { on_hand: 10, reserved: 0 }, "released exactly once");
  assert.equal((await pool.query("select status from orders where id='c1'")).rows[0].status, "cancelled");
  assert.equal(await one("select count(*)::int n from audit_logs where entity_id='c1' and action='status'"), 1);
  const retry = await transition("c1", "paid", "cancelled");
  assert.deepEqual(retry.ok, false);
  assert.deepEqual(await inv(p), { on_hand: 10, reserved: 0 }, "a later retry moves no stock");
});

test("2b. cancellation stress: 20 orders x 2 concurrent cancels => 20 effective releases, no negative stock", opts, async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `cs${i}`);
  const products = await Promise.all(ids.map((id) => seedOrder(id, "paid", 5, 3, 3)));
  const results = await Promise.allSettled(ids.flatMap((id) => [transition(id, "paid", "cancelled"), transition(id, "paid", "cancelled")]));
  noDeadlock(results);
  assert.equal(results.filter((r) => r.status === "rejected").length, 0);
  assert.equal(results.filter((r) => r.status === "fulfilled" && r.value.ok).length, 20);
  for (const p of products) assert.deepEqual(await inv(p), { on_hand: 8, reserved: 0 });
});

test("2c. a non-cancellable state and a failing stock release leave inventory and status untouched", opts, async () => {
  const shipped = await seedOrder("nc1", "shipped", 5, 1, 1);
  const r1 = await transition("nc1", "shipped", "cancelled");
  assert.deepEqual([r1.ok, !r1.ok && r1.code], [false, "INVALID_TRANSITION"]);
  assert.deepEqual(await inv(shipped), { on_hand: 5, reserved: 1 });
  const p = await seedOrder("nc2", "paid", 5, 0, 2); // reserved < quantity: the release guard must refuse and roll the status back
  const r2 = await transition("nc2", "paid", "cancelled");
  assert.deepEqual([r2.ok, !r2.ok && r2.code], [false, "INVENTORY_INVARIANT"]);
  assert.equal((await pool.query("select status from orders where id='nc2'")).rows[0].status, "paid");
  assert.deepEqual(await inv(p), { on_hand: 5, reserved: 0 });
  assert.equal(await one("select count(*)::int n from audit_logs where entity_id='nc2'"), 0);
});

test("3. status CAS: two conflicting transitions from the same expected status => one commits, one is stale", opts, async () => {
  const p = await seedOrder("cas1", "paid", 8, 2, 2);
  const results = await Promise.allSettled([transition("cas1", "paid", "preparing"), transition("cas1", "paid", "cancelled")]);
  noDeadlock(results);
  const settled = results.map((r) => (r.status === "fulfilled" ? r.value : null));
  assert.equal(settled.filter((r) => r?.ok).length, 1);
  assert.equal(settled.filter((r) => r && !r.ok && r.code === "STALE").length, 1);
  const status = (await pool.query("select status from orders where id='cas1'")).rows[0].status as string;
  assert.ok(status === "preparing" || status === "cancelled");
  assert.deepEqual(await inv(p), status === "cancelled" ? { on_hand: 10, reserved: 0 } : { on_hand: 8, reserved: 2 }, "stock matches the single winner");
  assert.equal(await one("select count(*)::int n from audit_logs where entity_id='cas1' and action='status'"), 1, "the audit matches the committed state");
});

test("3b. finance guards inside the transition on real PostgreSQL: paid needs the ledger, cancel needs the refund, payment_status is derived", opts, async () => {
  const p = await seedOrder("fg1", "pending_payment", 8, 2, 2);
  await pool.query("update orders set total = 1000 where id = 'fg1'");
  const early = await transition("fg1", "pending_payment", "paid");
  assert.deepEqual([early.ok, !early.ok && early.code], [false, "PAYMENT_NOT_RECORDED"]);
  assert.equal((await pool.query("select status, payment_status from orders where id='fg1'")).rows[0].status, "pending_payment");
  assert.equal(await one("select count(*)::int n from audit_logs where entity_id='fg1'"), 0);

  await pool.query("insert into payments (id, order_id, provider, amount, status, method, paid_at) values ('pay-fg1','fg1','manual',1000,'paid','cash', now())");
  const paid = await transition("fg1", "pending_payment", "paid");
  assert.deepEqual([paid.ok, paid.ok && paid.paymentStatus], [true, "paid"]);
  assert.equal((await pool.query("select payment_status from orders where id='fg1'")).rows[0].payment_status, "paid");

  const blocked = await Promise.all([transition("fg1", "paid", "cancelled"), transition("fg1", "paid", "cancelled")]);
  assert.ok(blocked.every((r) => !r.ok && r.code === "REFUND_REQUIRED"), "both concurrent cancels are refused while money is held");
  assert.deepEqual(await inv(p), { on_hand: 8, reserved: 2 }, "a refused cancel moves no stock");

  await pool.query("insert into refunds (id, order_id, payment_id, amount, status, refunded_at, reason) values ('ref-fg1','fg1','pay-fg1',1000,'completed', now(),'test')");
  const results = await Promise.allSettled([transition("fg1", "paid", "cancelled"), transition("fg1", "paid", "cancelled")]);
  noDeadlock(results);
  const outcomes = results.map((r) => (r.status === "fulfilled" ? (r.value.ok ? "ok" : r.value.code) : "error"));
  assert.deepEqual(outcomes.sort(), ["STALE", "ok"]);
  assert.deepEqual(await inv(p), { on_hand: 10, reserved: 0 }, "stock restored exactly once");
  assert.equal((await pool.query("select payment_status, status from orders where id='fg1'")).rows[0].payment_status, "refunded");
  const audit = (await pool.query("select payload from audit_logs where entity_id='fg1' and action='status' and payload->>'to'='cancelled'")).rows;
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0].payload.paymentStatus, { from: "paid", to: "refunded" });
  assert.deepEqual(audit[0].payload.stockReleased, [{ productId: p, quantity: 2 }]);
});

test("4. rate limit: 40 genuinely parallel claims with limit 7 => exactly 7 allowed", opts, async () => {
  const store = createRateLimitStore(db);
  const results = await Promise.allSettled(Array.from({ length: 40 }, () => claimRateLimit(store, { key: "rl-burst", limit: 7, windowMs: 60_000, now: NOW() })));
  noDeadlock(results);
  assert.equal(results.filter((r) => r.status === "rejected").length, 0);
  assert.equal(results.filter((r) => r.status === "fulfilled" && r.value).length, 7);
  assert.equal(await one("select count::int n from rate_limit_buckets where key='rl-burst'"), 7);
  assert.equal(await claimRateLimit(store, { key: "rl-other", limit: 7, windowMs: 60_000, now: NOW() }), true, "keys are isolated");
});

test("5. rate limit window reset: an expired bucket resets to 1 with real ON CONFLICT semantics", opts, async () => {
  const store = createRateLimitStore(db);
  await pool.query("insert into rate_limit_buckets (key, count, window_started_at, expires_at) values ('rl-expired', 99, now() - interval '2 minutes', now() - interval '1 minute')");
  assert.equal(await claimRateLimit(store, { key: "rl-expired", limit: 2, windowMs: 60_000, now: NOW() }), true);
  const row = (await pool.query("select count, expires_at > now() as live from rate_limit_buckets where key='rl-expired'")).rows[0];
  assert.deepEqual([row.count, row.live], [1, true]);
  assert.equal(await claimRateLimit(store, { key: "rl-expired", limit: 2, windowMs: 60_000, now: NOW() }), true);
  assert.equal(await claimRateLimit(store, { key: "rl-expired", limit: 2, windowMs: 60_000, now: NOW() }), false, "the new window enforces the limit again");
});

test("6. rate limit cleanup: long-expired rows are removed (bounded), active and just-ended rows are preserved", opts, async () => {
  const store = createRateLimitStore(db);
  await pool.query("delete from rate_limit_buckets");
  await pool.query(`insert into rate_limit_buckets (key, count, window_started_at, expires_at) values
    ('old', 5, now() - interval '5 hours', now() - interval '4 hours'),
    ('just-ended', 5, now() - interval '2 minutes', now() - interval '1 minute'),
    ('live', 1, now(), now() + interval '1 minute')`);
  assert.equal(await maybePurgeExpiredBuckets(store, NOW(), () => 0), 1);
  const keys = (await pool.query("select key from rate_limit_buckets order by key")).rows.map((r) => r.key);
  assert.deepEqual(keys, ["just-ended", "live"]);
  await pool.query(`insert into rate_limit_buckets (key, count, window_started_at, expires_at) select 'bulk-' || g, 1, now() - interval '5 hours', now() - interval '4 hours' from generate_series(1, ${PURGE_BATCH + 50}) g`);
  assert.equal(await maybePurgeExpiredBuckets(store, NOW(), () => 0), PURGE_BATCH, "one pass is bounded");
  assert.equal(await one("select count(*)::int n from rate_limit_buckets where key in ('live','just-ended')"), 2);
  // correctness is unaffected by cleanup
  assert.equal(await claimRateLimit(store, { key: "live", limit: 1, windowMs: 60_000, now: NOW() }), false);
});

test("7. audit transaction: a forced audit-insert failure rolls the admin mutation back (real DB refusal)", opts, async () => {
  await seedUsed("u-audit", 1);
  await assert.rejects(
    auditedMutationOn(db, actor, { action: "update", entityType: "forced_failure", entityId: "u-audit", payload: {} }, async (tx) => {
      await tx.update(schema.usedProducts).set({ name: "CHANGED" }).where(sql`${schema.usedProducts.id} = 'u-audit'`);
    }),
    causedBy(/forced audit failure/),
  );
  assert.equal((await pool.query("select name from used_products where id='u-audit'")).rows[0].name, "u-audit", "the mutation did not survive without its audit");
  assert.equal(await one("select count(*)::int n from audit_logs where entity_id='u-audit'"), 0);
  await auditedMutationOn(db, actor, { action: "update", entityType: "second_hand_product", entityId: "u-audit", payload: {} }, async (tx) => {
    await tx.update(schema.usedProducts).set({ name: "OK" }).where(sql`${schema.usedProducts.id} = 'u-audit'`);
  });
  assert.equal((await pool.query("select name from used_products where id='u-audit'")).rows[0].name, "OK");
  assert.equal(await one("select count(*)::int n from audit_logs where entity_id='u-audit'"), 1, "success commits both, exactly one audit row");
});


test("8. checkout lock: SECURITY DEFINER works under a restricted role without products UPDATE", opts, async () => {
  await pool.query("CREATE ROLE sprintb_checkout_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT");
  await pool.query("GRANT USAGE ON SCHEMA public TO sprintb_checkout_runtime");
  await pool.query("GRANT SELECT ON public.products TO sprintb_checkout_runtime");
  await pool.query("GRANT EXECUTE ON FUNCTION public.lock_checkout_products(text[]) TO sprintb_checkout_runtime");
  await db.insert(schema.products).values({ id: "lock-a", slug: "lock-a", name: "Lock A", sku: "lock-a" });

  const acl = (await pool.query(`SELECT
    has_table_privilege('sprintb_checkout_runtime','public.products','UPDATE') AS can_update,
    has_table_privilege('sprintb_checkout_runtime','public.products','SELECT') AS can_select,
    has_function_privilege('sprintb_checkout_runtime','public.lock_checkout_products(text[])','EXECUTE') AS can_execute,
    NOT EXISTS (
      SELECT 1 FROM pg_proc p, aclexplode(p.proacl) acl
      WHERE p.oid = 'public.lock_checkout_products(text[])'::regprocedure
        AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked`)).rows[0];
  assert.deepEqual(acl, { can_update: false, can_select: true, can_execute: true, public_execute_revoked: true });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE sprintb_checkout_runtime");
    assert.equal((await client.query("SELECT current_user AS role")).rows[0].role, "sprintb_checkout_runtime");
    await client.query("SELECT public.lock_checkout_products($1::text[])", [["lock-a"]]);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM public.products WHERE id='lock-a'")).rows[0].n, 1);
    await assert.rejects(
      client.query("UPDATE public.products SET name='FORBIDDEN' WHERE id='lock-a'"),
      (error: unknown) => (error as { code?: string }).code === "42501",
      "the storefront role must not acquire product UPDATE rights",
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  assert.equal((await pool.query("SELECT name FROM public.products WHERE id='lock-a'")).rows[0].name, "Lock A");
});

test("8b. checkout lock: malformed, duplicate and missing product IDs fail closed under restricted role", opts, async () => {
  const cases: { ids: (string | null)[] | null; code: string }[] = [
    { ids: null, code: "22023" },
    { ids: [], code: "22023" },
    { ids: ["lock-a", null], code: "22023" },
    { ids: ["lock-a", "lock-a"], code: "22023" },
    { ids: Array.from({ length: 26 }, (_, i) => `lock-${i}`), code: "22023" },
    { ids: ["lock-does-not-exist"], code: "23514" },
  ];
  const client = await pool.connect();
  try {
    for (const { ids, code } of cases) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE sprintb_checkout_runtime");
        await assert.rejects(
          client.query("SELECT public.lock_checkout_products($1::text[])", [ids]),
          (error: unknown) => (error as { code?: string }).code === code,
          `expected SQLSTATE ${code} for ${JSON.stringify(ids)}`,
        );
      } finally {
        await client.query("ROLLBACK");
      }
    }
  } finally {
    client.release();
  }
});

test("8c. checkout lock: product UPDATE waits for the shared lock and rollback releases it", opts, async () => {
  const checkout = await pool.connect();
  const admin = await pool.connect();
  try {
    await checkout.query("BEGIN");
    await checkout.query("SET LOCAL ROLE sprintb_checkout_runtime");
    await checkout.query("SELECT public.lock_checkout_products($1::text[])", [["lock-a"]]);

    await admin.query("BEGIN");
    await admin.query("SET LOCAL lock_timeout = '250ms'");
    await assert.rejects(
      admin.query("UPDATE public.products SET name='BLOCKED' WHERE id='lock-a'"),
      (error: unknown) => (error as { code?: string }).code === "55P03",
      "admin UPDATE must not bypass the checkout's FOR SHARE row lock",
    );
    await admin.query("ROLLBACK");
    assert.equal((await pool.query("SELECT name FROM public.products WHERE id='lock-a'")).rows[0].name, "Lock A");

    await checkout.query("ROLLBACK");
    await admin.query("BEGIN");
    const updated = await admin.query("UPDATE public.products SET name='AFTER LOCK' WHERE id='lock-a'");
    assert.equal(updated.rowCount, 1, "rollback must release the product lock");
    await admin.query("ROLLBACK");
    assert.equal((await pool.query("SELECT name FROM public.products WHERE id='lock-a'")).rows[0].name, "Lock A");
  } finally {
    await Promise.allSettled([checkout.query("ROLLBACK"), admin.query("ROLLBACK")]);
    checkout.release();
    admin.release();
  }
});

test("8d. checkout lock: concurrent shared locks with opposite product order do not deadlock", opts, async () => {
  await db.insert(schema.products).values({ id: "lock-b", slug: "lock-b", name: "Lock B", sku: "lock-b" });
  const left = await pool.connect();
  const right = await pool.connect();
  try {
    await Promise.all([left.query("BEGIN"), right.query("BEGIN")]);
    await Promise.all([
      left.query("SET LOCAL ROLE sprintb_checkout_runtime"),
      right.query("SET LOCAL ROLE sprintb_checkout_runtime"),
    ]);
    await Promise.all([
      left.query("SET LOCAL statement_timeout = '3s'"),
      right.query("SET LOCAL statement_timeout = '3s'"),
    ]);
    await Promise.all([
      left.query("SELECT public.lock_checkout_products($1::text[])", [["lock-b", "lock-a"]]),
      right.query("SELECT public.lock_checkout_products($1::text[])", [["lock-a", "lock-b"]]),
    ]);
  } finally {
    await Promise.allSettled([left.query("ROLLBACK"), right.query("ROLLBACK")]);
    left.release();
    right.release();
  }
});

test("8e. scoped checkout: restricted LOGIN role commits stock, order and immutable legal evidence on disposable PostgreSQL", opts, async () => {
  // The role is local to the loopback sprintb database; no Neon roles, credentials or environments are changed.
  const password = randomBytes(24).toString("hex");
  await pool.query(`ALTER ROLE sprintb_checkout_runtime LOGIN PASSWORD '${password}'`);
  await pool.query(`GRANT SELECT ON public.inventory, public.orders, public.order_items,
    public.legal_documents, public.legal_document_versions, public.order_legal_acceptances,
    public.rate_limit_buckets TO sprintb_checkout_runtime`);
  await pool.query(`GRANT INSERT ON public.customers, public.addresses, public.orders,
    public.order_items, public.order_legal_acceptances, public.rate_limit_buckets TO sprintb_checkout_runtime`);
  await pool.query("GRANT UPDATE (on_hand, reserved, version, updated_at) ON public.inventory TO sprintb_checkout_runtime");
  // The 0015 legal-evidence trigger locks its parent order FOR KEY SHARE, which
  // requires at least one UPDATE-able column under PostgreSQL row-lock ACLs.
  // Do not grant table-wide UPDATE or access to immutable order identity columns.
  await pool.query("GRANT UPDATE (updated_at) ON public.orders TO sprintb_checkout_runtime");
  await pool.query("GRANT UPDATE (count, window_started_at, expires_at) ON public.rate_limit_buckets TO sprintb_checkout_runtime");
  await pool.query("GRANT DELETE ON public.rate_limit_buckets TO sprintb_checkout_runtime");
  // PostgreSQL requires UPDATE privilege to acquire FOR SHARE on legal_documents.
  // Migration 0016's trigger prevents mutation of created_at even with this narrow grant.
  await pool.query("GRANT UPDATE (created_at) ON public.legal_documents TO sprintb_checkout_runtime");
  await db.insert(schema.inventory).values({ id: "lock-inventory-a", productId: "lock-a", onHand: 3, reserved: 0 });

  const slugs = ["distance-sales", "pre-information"];
  for (const slug of slugs) {
    await db.insert(schema.legalDocuments).values({ id: `lock-legal-${slug}`, slug });
    await db.insert(schema.legalDocumentVersions).values({
      id: `lock-version-${slug}`, documentId: `lock-legal-${slug}`, version: 1,
      title: `Checkout ${slug}`, body: "Disposable legal fixture", contentHash: "a".repeat(64),
      publishedAt: new Date("2020-01-01T00:00:00Z"), effectiveAt: new Date("2020-01-01T00:00:00Z"),
      publishedBy: "owner-1",
    });
  }

  const url = new URL(URL_ENV!);
  url.username = "sprintb_checkout_runtime";
  url.password = password;
  const scoped = new pg.Pool({ connectionString: url.toString(), max: 2, connectionTimeoutMillis: 3000 });
  try {
    const role = (await scoped.query("SELECT current_user AS role")).rows[0].role;
    assert.equal(role, "sprintb_checkout_runtime", "must authenticate as the restricted role, not SET ROLE");
    const privileges = (await scoped.query(`SELECT
      has_table_privilege(current_user, 'public.products', 'UPDATE') AS products_update,
      has_column_privilege(current_user, 'public.inventory', 'on_hand', 'UPDATE') AS inventory_update,
      has_function_privilege(current_user, 'public.lock_checkout_products(text[])', 'EXECUTE') AS can_lock,
      (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged`)).rows[0];
    assert.deepEqual(privileges, { products_update: false, inventory_update: true, can_lock: true, privileged: false });

    const client = await scoped.connect();
    const acceptedAt = new Date();
    const rendered = "Rendered disposable checkout evidence";
    const digest = createHash("sha256").update(rendered).digest("hex");
    let committed = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query(`INSERT INTO rate_limit_buckets (key, count, expires_at)
        VALUES ('scoped-checkout-test', 1, now() + interval '15 minutes')
        ON CONFLICT (key) DO UPDATE SET count = rate_limit_buckets.count + 1`);
      await client.query("SELECT id FROM legal_documents ORDER BY id FOR SHARE");
      await client.query("SELECT public.lock_checkout_products($1::text[])", [["lock-a"]]);
      await client.query(`INSERT INTO customers (id, first_name, last_name, phone)
        VALUES ('scoped-customer', 'Test', 'Checkout', '05000000000')`);
      await client.query(`INSERT INTO addresses (id, customer_id, recipient_name, phone, city, line1)
        VALUES ('scoped-address', 'scoped-customer', 'Test Checkout', '05000000000', 'İzmir', 'Test street')`);
      await client.query(`INSERT INTO orders (id, order_number, customer_id, idempotency_key,
        customer_name, phone, city, address, order_issued_at, legal_evidence_version, created_at)
        VALUES ('scoped-order', 'SCOPED-ORDER-1', 'scoped-customer', 'scoped-order-key',
        'Test Checkout', '05000000000', 'İzmir', 'Test street', $1, 1, $1)`, [acceptedAt]);
      const changed = await client.query(`UPDATE inventory
        SET on_hand = on_hand - 1, reserved = reserved + 1, version = version + 1,
          updated_at = now()
        WHERE product_id = 'lock-a' AND on_hand >= 1 RETURNING id`);
      assert.equal(changed.rowCount, 1);
      await client.query(`INSERT INTO order_items (id, order_id, product_id, product_name,
        unit_price, vat_rate_bps, vat_amount, quantity, line_total)
        VALUES ('scoped-item', 'scoped-order', 'lock-a', 'Lock A', 100, 2000, 17, 1, 100)`);
      for (const slug of slugs) {
        await client.query(`INSERT INTO order_legal_acceptances
          (id, order_id, document_version_id, slug, title, version, template_content_hash,
           rendered_body, rendered_sha256, render_context_version, acceptance_type, accepted_at)
          VALUES ($1, 'scoped-order', $2, $3, $4, 1, $5, $6, $7, 2, 'checkout_required', $8)`,
          [`scoped-evidence-${slug}`, `lock-version-${slug}`, slug, `Checkout ${slug}`,
            "a".repeat(64), rendered, digest, acceptedAt]);
      }
      await client.query("COMMIT");
      committed = true;
    } finally {
      if (!committed) await client.query("ROLLBACK");
      client.release();
    }

    assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders WHERE id='scoped-order'")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM order_legal_acceptances WHERE order_id='scoped-order'")).rows[0].n, 2);
    assert.deepEqual((await pool.query("SELECT on_hand, reserved FROM inventory WHERE product_id='lock-a'")).rows[0], { on_hand: 2, reserved: 1 });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM rate_limit_buckets WHERE key='scoped-checkout-test'")).rows[0].n, 1);
    await assert.rejects(
      scoped.query("UPDATE products SET name='forbidden' WHERE id='lock-a'"),
      (error: unknown) => (error as { code?: string }).code === "42501",
      "a real restricted login must not update catalog products",
    );
  } finally {
    await scoped.end();
  }
});

test("invariants: no negative inventory, no over-reservation, no duplicate release, no deadlock, no lingering transactions", opts, async () => {
  assert.equal(await one("select count(*)::int n from inventory where on_hand < 0 or reserved < 0"), 0);
  assert.equal(await one("select count(*)::int n from (select product_id, count(*) c from second_hand_reservations where expires_at > now() group by product_id) x join used_products u on u.id = x.product_id where x.c > u.stock"), 0);
  assert.equal(await one("select count(*)::int n from (select entity_id from audit_logs where entity_type='order' and payload->>'to'='cancelled' group by entity_id having count(*) > 1) d"), 0, "no order was cancelled twice");
  assert.equal(deadlocks.length, 0, "no deadlock (SQLSTATE 40P01) in any tested scenario");
  assert.equal(await one("select count(*)::int n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'"), 0);
  assert.equal(await one("select count(*)::int n from pg_locks where not granted"), 0);
});

after(async () => { if (pool) await pool.end(); });
