/**
 * Behavioural coverage for the account ownership queries and the mutation sequence, using
 * the application's REAL code: lib/account-queries.ts builds the exact queries
 * lib/account-resources-db.ts runs (rendered here with a disconnected drizzle instance -
 * no database), and runAccountMutation is the sequence every /account Server Action uses.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { addresses } from "../db/schema.ts";
import { orderDetailColumns, orderItemsQuery, ownedAddressWhere, ownedOrderDetailQuery, ownedOrderListQuery } from "../lib/account-queries.ts";
import { SESSION_MISSING_ERROR, runAccountMutation } from "../lib/account-resources.ts";

const db = drizzle({ connection: "postgres://unused:unused@127.0.0.1:1/unused" });
const selectedColumns = (sql: string) => [...sql.slice(0, sql.indexOf(" from ")).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

// ---- order ownership + projection -------------------------------------------

test("the order-detail query scopes by order id AND the resolved customer id in one predicate", () => {
  const { sql, params } = ownedOrderDetailQuery(db, "cust-1", "order-9").toSQL();
  assert.match(sql, /where \("orders"\."id" = \$1 and "orders"\."customer_id" = \$2\) limit \$3$/);
  assert.deepEqual(params, ["order-9", "cust-1", 1]);
});

test("the order-detail query selects exactly the OrderDetail columns and nothing internal", () => {
  const cols = selectedColumns(ownedOrderDetailQuery(db, "cust-1", "order-9").toSQL().sql);
  assert.deepEqual(cols, ["id", "order_number", "status", "total", "currency", "created_at", "subtotal", "vat_total", "shipping_total", "payment_status", "shipping_address_snapshot", "billing_address_snapshot"]);
  for (const internal of ["idempotency_key", "notes", "customer_name", "phone", "email", "customer_id"]) {
    assert.equal(cols.includes(internal), false, `${internal} must not be fetched for the account order page`);
  }
  assert.equal(Object.keys(orderDetailColumns).length, cols.length);
});

test("the order list is scoped to the customer, newest first, and fetches only summary columns", () => {
  const { sql, params } = ownedOrderListQuery(db, "cust-1").toSQL();
  assert.match(sql, /where "orders"\."customer_id" = \$1 order by "orders"\."created_at" desc$/);
  assert.deepEqual(params, ["cust-1"]);
  assert.deepEqual(selectedColumns(sql), ["id", "order_number", "status", "total", "currency", "created_at"]);
});

test("order items are read for a single order id", () => {
  const { sql, params } = orderItemsQuery(db, "order-9").toSQL();
  assert.match(sql, /from "order_items" where "order_items"\."order_id" = \$1$/);
  assert.deepEqual(params, ["order-9"]);
});

test("the real address ownership predicate binds id AND customer_id for update and delete", () => {
  const update = db.update(addresses).set({ city: "Ankara" }).where(ownedAddressWhere("cust-1", "addr-7")).toSQL();
  assert.match(update.sql, /where \("addresses"\."id" = \$2 and "addresses"\."customer_id" = \$3\)$/);
  assert.deepEqual(update.params, ["Ankara", "addr-7", "cust-1"]);
  const del = db.delete(addresses).where(ownedAddressWhere("cust-1", "addr-7")).toSQL();
  assert.deepEqual(del.params, ["addr-7", "cust-1"]);
});

// ---- mutation sequence (rate limit -> identity -> mutate) -------------------

function recorder(options: { limited?: string | null; customer?: { id: string } | null; mutate?: { ok: boolean; error?: string; extra?: unknown } } = {}) {
  const calls: string[] = [];
  const steps = {
    rateLimit: async () => { calls.push("rateLimit"); return options.limited ?? null; },
    resolveCustomer: async () => { calls.push("resolveCustomer"); return options.customer === undefined ? { id: "cust-1" } : options.customer; },
    mutate: async (customer: { id: string }) => { calls.push(`mutate:${customer.id}`); return options.mutate ?? { ok: true }; },
  };
  return { calls, steps };
}

test("a mutation runs rate limit, then identity, then the write - in that order", async () => {
  const { calls, steps } = recorder();
  assert.deepEqual(await runAccountMutation(steps), { ok: true });
  assert.deepEqual(calls, ["rateLimit", "resolveCustomer", "mutate:cust-1"]);
});

test("a rate-limited request never resolves identity or reaches the store", async () => {
  const { calls, steps } = recorder({ limited: "Çok fazla istek gönderildi." });
  assert.deepEqual(await runAccountMutation(steps), { ok: false, error: "Çok fazla istek gönderildi." });
  assert.deepEqual(calls, ["rateLimit"]);
});

test("without a verified session nothing is written", async () => {
  const { calls, steps } = recorder({ customer: null });
  assert.deepEqual(await runAccountMutation(steps), { ok: false, error: SESSION_MISSING_ERROR });
  assert.deepEqual(calls, ["rateLimit", "resolveCustomer"]);
});

test("the write receives only the session-resolved customer, and its result is reduced to ok/error", async () => {
  const { calls, steps } = recorder({ customer: { id: "cust-from-session" }, mutate: { ok: true, extra: { profile: { email: "x@y.test" } } } });
  assert.deepEqual(await runAccountMutation(steps), { ok: true }, "store payloads must not flow back to the client");
  assert.deepEqual(calls.at(-1), "mutate:cust-from-session");
  const failing = recorder({ mutate: { ok: false, error: "Adres bulunamadı." } });
  assert.deepEqual(await runAccountMutation(failing.steps), { ok: false, error: "Adres bulunamadı." });
});
