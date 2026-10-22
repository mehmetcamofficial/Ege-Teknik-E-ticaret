import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { addresses, orderItems, orders } from "../db/schema.ts";

/**
 * The ownership predicates and order read queries used by lib/account-resources-db.ts,
 * kept free of server-only/db-pool imports (same pattern as lib/product-image.ts) so
 * tests can build the application's REAL queries with a disconnected drizzle instance
 * and assert their SQL - not a hand-copied reimplementation of them.
 *
 * Every resource read or write is scoped by the owning customer in the same predicate
 * as the resource id, so there is no gap between an ownership check and the query it
 * guards.
 */

export type SelectDb = Pick<NodePgDatabase, "select">;

export function ownedAddressWhere(customerId: string, addressId: string) {
  return and(eq(addresses.id, addressId), eq(addresses.customerId, customerId));
}

export function ownedOrderWhere(customerId: string, orderId: string) {
  return and(eq(orders.id, orderId), eq(orders.customerId, customerId));
}

/**
 * Exactly the columns OrderDetail exposes to the account UI. idempotencyKey, notes and
 * the raw contact-snapshot fields (customerName/phone/email) never leave the database.
 */
export const orderDetailColumns = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  status: orders.status,
  total: orders.total,
  currency: orders.currency,
  createdAt: orders.createdAt,
  subtotal: orders.subtotal,
  vatTotal: orders.vatTotal,
  shippingTotal: orders.shippingTotal,
  paymentStatus: orders.paymentStatus,
  shippingAddressSnapshot: orders.shippingAddressSnapshot,
  billingAddressSnapshot: orders.billingAddressSnapshot,
};

export const orderSummaryColumns = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  status: orders.status,
  total: orders.total,
  currency: orders.currency,
  createdAt: orders.createdAt,
};

export const orderItemColumns = {
  id: orderItems.id,
  productName: orderItems.productName,
  productSku: orderItems.productSku,
  productSlug: orderItems.productSlug,
  unitPrice: orderItems.unitPrice,
  quantity: orderItems.quantity,
  lineTotal: orderItems.lineTotal,
};

export function ownedOrderDetailQuery(db: SelectDb, customerId: string, orderId: string) {
  return db.select(orderDetailColumns).from(orders).where(ownedOrderWhere(customerId, orderId)).limit(1);
}

export function ownedOrderListQuery(db: SelectDb, customerId: string) {
  return db.select(orderSummaryColumns).from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt));
}

/** Only ever called with the id of an order ownedOrderDetailQuery already returned for this customer. */
export function orderItemsQuery(db: SelectDb, orderId: string) {
  return db.select(orderItemColumns).from(orderItems).where(eq(orderItems.orderId, orderId));
}
