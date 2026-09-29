import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { orders } from "../db/schema.ts";
import { loadOrdersPage, ordersQuerySchema, type OrdersDb } from "../lib/orders-db.ts";

/**
 * P0-A #3: GET /api/admin/overview silently capped orders at 100 rows with no way to reach anything
 * older. loadOrdersPage replaces that for the orders list/detail screens, reusing lib/finance.ts's
 * FINANCE_PAGE_SIZE/pageCountFor - not a new pagination scheme.
 */
test("ordersQuerySchema: page defaults to 1, coerces, and rejects an unknown status", () => {
  assert.deepEqual(ordersQuerySchema.parse({}), { page: 1 });
  assert.equal(ordersQuerySchema.parse({ page: "3" }).page, 3);
  assert.equal(ordersQuerySchema.parse({ status: "" }).status, undefined);
  assert.equal(ordersQuerySchema.parse({ status: "paid" }).status, "paid");
  assert.equal(ordersQuerySchema.safeParse({ status: "not-a-status" }).success, false);
  assert.equal(ordersQuerySchema.parse({ q: "  FIN-1  " }).q, "FIN-1");
});

// ---- real-PostgreSQL checks, opt-in exactly like tests/finance-db.test.ts -----------------------------------
const url = process.env.FINANCE_TEST_DATABASE_URL;
const skip = !url && "FINANCE_TEST_DATABASE_URL not set (disposable migrated database required)";
let pool: pg.Pool;
let db: OrdersDb;
const run = crypto.randomUUID().slice(0, 8);
const at = (day: number) => new Date(Date.UTC(2005, 0, 1 + day, 3));

async function makeOrder(n: number, opts: { status?: string; customerName?: string; city?: string; phone?: string } = {}) {
  const id = `ord-db-${run}-${n}`;
  await db.insert(orders).values({
    id, orderNumber: `ODB-${run}-${n}`, idempotencyKey: `ord-db-key-${run}-${n}`,
    customerName: opts.customerName ?? `Müşteri ${n}`, phone: opts.phone ?? "05000000000", city: opts.city ?? "Aydın", address: "Test adresi 1",
    subtotal: 1000, vatTotal: 200, total: 1200, status: opts.status ?? "pending_payment", paymentStatus: "pending", createdAt: at(n), updatedAt: at(n),
  });
  return id;
}

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: url });
  db = drizzle(pool) as OrdersDb;
  for (let n = 1; n <= 7; n++) await makeOrder(n);
  await makeOrder(8, { status: "delivered", customerName: `Aranacak-${run} Müşteri`, city: "İzmir", phone: "05551112233" });
});
after(async () => { if (pool) await pool.end(); });

test("loadOrdersPage paginates newest-first with a small page size and a correct pageCount", { skip }, async () => {
  const page1 = await loadOrdersPage(db, { page: 1 }, 3);
  assert.equal(page1.rows.length, 3);
  assert.equal(page1.total >= 8, true);
  assert.equal(page1.pageCount >= 3, true);
  // newest (highest n / latest createdAt) first
  assert.equal(page1.rows[0]!.id, `ord-db-${run}-8`);
  const page2 = await loadOrdersPage(db, { page: 2 }, 3);
  assert.notDeepEqual(page1.rows.map((r) => r.id), page2.rows.map((r) => r.id));
});

test("loadOrdersPage filters by status and clamps an out-of-range page to the last page", { skip }, async () => {
  const filtered = await loadOrdersPage(db, { page: 1, status: "delivered" }, 3);
  assert.ok(filtered.rows.every((r) => r.status === "delivered"));
  assert.ok(filtered.rows.some((r) => r.id === `ord-db-${run}-8`));

  const overshoot = await loadOrdersPage(db, { page: 999 }, 3);
  assert.equal(overshoot.page, overshoot.pageCount);
});

test("loadOrdersPage searches order number, customer name, city and phone", { skip }, async () => {
  const byCustomer = await loadOrdersPage(db, { page: 1, q: `Aranacak-${run}` }, 20);
  assert.deepEqual(byCustomer.rows.map((r) => r.id), [`ord-db-${run}-8`]);

  const byOrderNumber = await loadOrdersPage(db, { page: 1, q: `ODB-${run}-3` }, 20);
  assert.deepEqual(byOrderNumber.rows.map((r) => r.id), [`ord-db-${run}-3`]);

  const byPhone = await loadOrdersPage(db, { page: 1, q: "05551112233" }, 20);
  assert.ok(byPhone.rows.some((r) => r.id === `ord-db-${run}-8`));
});
