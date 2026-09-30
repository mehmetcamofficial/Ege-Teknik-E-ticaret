import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import { orderItems, orders } from "../db/schema.ts";
import { loadOrdersPage, ordersQuerySchema, type OrdersDb } from "../lib/orders-db.ts";
import { lookupGuestOrder, type OrderLookupItemRow, type OrderLookupRow, type OrderLookupStore } from "../lib/order-lookup.ts";

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

/** A guest order for the P3-A1 lookup: its own id prefix, a known e-mail, and real order_items rows. */
async function makeGuestOrder(key: string, n: number, email: string, itemNames: string[]) {
  const id = `ord-lookup-${run}-${key}`, orderNumber = `ODBG-${run}-${key}`;
  await db.insert(orders).values({
    id, orderNumber, idempotencyKey: `ord-lookup-key-${run}-${key}`, customerName: `Misafir ${key}`, phone: "05001112233",
    email, city: "İzmir", address: "Test adresi 1", subtotal: 1000, vatTotal: 200, total: 1200,
    status: "pending_payment", paymentStatus: "pending", createdAt: at(n), updatedAt: at(n),
  });
  for (const [index, productName] of itemNames.entries()) {
    await db.insert(orderItems).values({ id: `ord-lookup-item-${run}-${key}-${index}`, orderId: id, productName, unitPrice: 600, vatRateBps: 2000, vatAmount: 100, quantity: 1, lineTotal: 600 });
  }
  return orderNumber;
}

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: url });
  db = drizzle(pool) as OrdersDb;
  for (let n = 1; n <= 7; n++) await makeOrder(n);
  await makeOrder(8, { status: "delivered", customerName: `Aranacak-${run} Müşteri`, city: "İzmir", phone: "05551112233" });
  // P3-A1 guest-lookup fixtures. They use ids of their own and DATES OLDER THAN EVERY admin fixture
  // (at(-2)/at(-3) are December 2004), so they can never become the "newest first" row the pagination
  // tests above assert, and they stay deterministic across runs.
  await makeGuestOrder("A", -2, "Ada@Example.com", ["Airy 12000", "Fairy 9000"]);
  await makeGuestOrder("B", -3, "alan@example.test", ["Pular 18000"]);
  await makeGuestOrder("NOEMAIL", -4, "", ["Pular 24000"]);
});

// ---- P3-A1: the guest order lookup on real PostgreSQL -------------------------------------------------------------------
// The production store (lib/order-lookup-db.ts) is server-only, so the same two SELECTs are written out
// here over the real schema: one indexed read by order number, then that order's own items.
function guestLookupStore(database: OrdersDb): OrderLookupStore {
  return {
    findByOrderNumber: async (orderNumber) => {
      const [row] = await database
        .select({
          internalId: orders.id, orderNumber: orders.orderNumber, email: orders.email, status: orders.status, createdAt: orders.createdAt,
          customerName: orders.customerName, phone: orders.phone, city: orders.city, address: orders.address,
          installationPreference: orders.installationPreference, shippingAddressSnapshot: orders.shippingAddressSnapshot,
          subtotal: orders.subtotal, vatTotal: orders.vatTotal, shippingTotal: orders.shippingTotal, installationTotal: orders.installationTotal, total: orders.total,
        })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);
      return (row as OrderLookupRow | undefined) ?? null;
    },
    listItemsForOrder: async (orderId) => database
      .select({ productName: orderItems.productName, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, lineTotal: orderItems.lineTotal })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(orderItems.createdAt) as Promise<OrderLookupItemRow[]>,
  };
}

const guestNumber = (key: string) => `ODBG-${run}-${key}`;

test("guest lookup: the right order number and e-mail returns exactly that order", { skip }, async () => {
  const result = await lookupGuestOrder({ orderNumber: guestNumber("A"), email: "Ada@Example.com" }, guestLookupStore(db));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.order.orderNumber, guestNumber("A"));
  assert.equal(result.order.status, "pending_payment");
  assert.deepEqual(result.order.items.map((item) => item.productName), ["Airy 12000", "Fairy 9000"]);
  assert.equal(result.order.total, 1200);
  assert.equal(result.order.createdAt, at(-2).toISOString());
});

test("guest lookup: the e-mail matches case-insensitively, as it did for PayTR", { skip }, async () => {
  for (const typed of ["ada@example.com", "ADA@EXAMPLE.COM", "  ada@Example.com  "]) {
    const result = await lookupGuestOrder({ orderNumber: guestNumber("A"), email: typed }, guestLookupStore(db));
    assert.equal(result.ok, true, typed);
  }
});

test("guest lookup: a wrong e-mail, an unknown number and an order with no e-mail all refuse identically", { skip }, async () => {
  const refusals = [
    await lookupGuestOrder({ orderNumber: guestNumber("A"), email: "attacker@example.com" }, guestLookupStore(db)),
    await lookupGuestOrder({ orderNumber: guestNumber("DOES-NOT-EXIST"), email: "ada@example.com" }, guestLookupStore(db)),
    await lookupGuestOrder({ orderNumber: guestNumber("NOEMAIL"), email: "ada@example.com" }, guestLookupStore(db)),
  ];
  for (const result of refusals) {
    assert.equal(result.ok, false);
    assert.deepEqual(result.ok ? {} : { ...result.failure }, { status: 404, code: "ORDER_NOT_FOUND", error: "Sipariş bilgileri doğrulanamadı. Sipariş numarası ve e-posta adresini kontrol edin." });
  }
  assert.equal(refusals[0]!.ok ? null : refusals[0]!.failure, refusals[1]!.ok ? null : refusals[1]!.failure);
});

test("guest lookup: one order's items never leak into another order's result", { skip }, async () => {
  const first = await lookupGuestOrder({ orderNumber: guestNumber("A"), email: "Ada@Example.com" }, guestLookupStore(db));
  const second = await lookupGuestOrder({ orderNumber: guestNumber("B"), email: "alan@example.test" }, guestLookupStore(db));
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  const firstNames = first.order.items.map((item) => item.productName);
  const secondNames = second.order.items.map((item) => item.productName);
  assert.deepEqual(firstNames, ["Airy 12000", "Fairy 9000"]);
  assert.deepEqual(secondNames, ["Pular 18000"]);
  assert.equal(firstNames.some((name) => secondNames.includes(name)), false);
  assert.equal(JSON.stringify(first).includes(guestNumber("B")), false);
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
