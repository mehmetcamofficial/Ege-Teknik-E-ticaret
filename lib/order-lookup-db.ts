import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orderItems, orders } from "@/db/schema";
import type { OrderLookupItemRow, OrderLookupRow, OrderLookupStore } from "@/lib/order-lookup";

/**
 * Drizzle wiring for lib/order-lookup.ts. Every statement below is a SELECT against the unique
 * orders_number_uq index; there is no transaction, no lock, no write and no session of any kind, because
 * looking an order up must not be able to change anything.
 *
 * Each projection names only the columns the public confirmation is built from, so the forbidden ones -
 * id, customer_id, idempotency_key, request_fingerprint, notes, billing_address_snapshot, and every
 * payments / refunds / shipments / customers / audit_logs column - are never even read, let alone returned.
 * orders.id is read as `internalId` purely to ask for that order's own items; it cannot reach a response
 * because lib/order-lookup.ts's projection carries no id field.
 */
export const orderLookupStore: OrderLookupStore = {
  async findByOrderNumber(orderNumber) {
    const [row] = await getDb()
      .select({
        internalId: orders.id,
        orderNumber: orders.orderNumber,
        email: orders.email,
        status: orders.status,
        createdAt: orders.createdAt,
        customerName: orders.customerName,
        phone: orders.phone,
        city: orders.city,
        address: orders.address,
        installationPreference: orders.installationPreference,
        shippingAddressSnapshot: orders.shippingAddressSnapshot,
        subtotal: orders.subtotal,
        vatTotal: orders.vatTotal,
        shippingTotal: orders.shippingTotal,
        installationTotal: orders.installationTotal,
        total: orders.total,
      })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1);
    return (row as OrderLookupRow | undefined) ?? null;
  },
  async listItemsForOrder(orderId) {
    return getDb()
      .select({ productName: orderItems.productName, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, lineTotal: orderItems.lineTotal })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(orderItems.createdAt) as Promise<OrderLookupItemRow[]>;
  },
};