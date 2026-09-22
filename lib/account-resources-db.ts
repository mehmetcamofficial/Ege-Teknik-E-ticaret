import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { addresses, orderItems, orders, customers } from "@/db/schema";
import {
  addressType,
  type AddressInput,
  type AddressStore,
  type CustomerAddress,
  type OrderStore,
  type ProfileStore,
} from "@/lib/account-resources";

/**
 * Drizzle wiring for lib/account-resources.ts. Every read/write below scopes
 * a resource by its owning customer in the SAME query as the resource id -
 * this is the IDOR/BOLA defense the pure layer's atomic store contract
 * requires (see lib/account-resources.ts's module comment). None of these
 * functions ever take a Request, header, cookie or client-supplied
 * customerId - the customerId argument always comes from the caller having
 * already resolved it from a verified Clerk session (lib/customer-auth.ts).
 */

const addressRow = (row: typeof addresses.$inferSelect): CustomerAddress => ({
  id: row.id,
  customerId: row.customerId,
  type: row.type,
  title: row.title,
  recipientName: row.recipientName,
  phone: row.phone,
  city: row.city,
  district: row.district,
  postalCode: row.postalCode,
  line1: row.line1,
  line2: row.line2,
  billing: row.billing,
});

/** Exported so tests can assert the exact WHERE predicate without needing a live database (see .toSQL() in tests/account-resources-boundary.test.ts). */
export function ownedAddressWhere(customerId: string, addressId: string) {
  return and(eq(addresses.id, addressId), eq(addresses.customerId, customerId));
}

export function ownedOrderWhere(customerId: string, orderId: string) {
  return and(eq(orders.id, orderId), eq(orders.customerId, customerId));
}

export const profileStore: ProfileStore = {
  getOwnedProfile: async (customerId) => {
    const [row] = await getDb()
      .select({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName, phone: customers.phone, email: customers.email })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1);
    return row ?? null;
  },
  updateOwnedProfile: async (customerId, patch) => {
    const [row] = await getDb()
      .update(customers)
      .set({ firstName: patch.firstName, lastName: patch.lastName, phone: patch.phone, updatedAt: new Date() })
      .where(eq(customers.id, customerId))
      .returning({ id: customers.id, firstName: customers.firstName, lastName: customers.lastName, phone: customers.phone, email: customers.email });
    return row ?? null;
  },
};

export const addressStore: AddressStore = {
  listOwnedAddresses: async (customerId) => {
    const rows = await getDb().select().from(addresses).where(eq(addresses.customerId, customerId)).orderBy(desc(addresses.createdAt));
    return rows.map(addressRow);
  },
  createOwnedAddress: async (customerId, input: AddressInput, id) => {
    const [row] = await getDb()
      .insert(addresses)
      .values({ id, customerId, type: addressType(input), title: input.title, recipientName: input.recipientName, phone: input.phone, city: input.city, district: input.district, postalCode: input.postalCode, line1: input.line1, line2: input.line2, billing: input.billing })
      .returning();
    return addressRow(row);
  },
  getOwnedAddress: async (customerId, addressId) => {
    const [row] = await getDb().select().from(addresses).where(ownedAddressWhere(customerId, addressId)).limit(1);
    return row ? addressRow(row) : null;
  },
  updateOwnedAddress: async (customerId, addressId, input: AddressInput) => {
    const [row] = await getDb()
      .update(addresses)
      .set({ type: addressType(input), title: input.title, recipientName: input.recipientName, phone: input.phone, city: input.city, district: input.district, postalCode: input.postalCode, line1: input.line1, line2: input.line2, billing: input.billing, updatedAt: new Date() })
      .where(ownedAddressWhere(customerId, addressId))
      .returning();
    return row ? addressRow(row) : null;
  },
  deleteOwnedAddress: async (customerId, addressId) => {
    const deleted = await getDb().delete(addresses).where(ownedAddressWhere(customerId, addressId)).returning({ id: addresses.id });
    return deleted.length > 0;
  },
};

export const orderStore: OrderStore = {
  listOwnedOrders: async (customerId) => {
    const rows = await getDb()
      .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, total: orders.total, currency: orders.currency, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt));
    return rows;
  },
  getOwnedOrder: async (customerId, orderId) => {
    // Explicit projection: only the columns OrderDetail actually exposes to the account UI.
    // idempotencyKey, notes and the raw contact-snapshot fields (customerName/phone/email)
    // never need to leave the database for this read.
    const [order] = await getDb()
      .select({
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
      })
      .from(orders)
      .where(ownedOrderWhere(customerId, orderId))
      .limit(1);
    if (!order) return null;
    const items = await getDb()
      .select({ id: orderItems.id, productName: orderItems.productName, productSku: orderItems.productSku, productSlug: orderItems.productSlug, unitPrice: orderItems.unitPrice, quantity: orderItems.quantity, lineTotal: orderItems.lineTotal })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      total: order.total,
      currency: order.currency,
      createdAt: order.createdAt,
      subtotal: order.subtotal,
      vatTotal: order.vatTotal,
      shippingTotal: order.shippingTotal,
      paymentStatus: order.paymentStatus,
      shippingAddressSnapshot: order.shippingAddressSnapshot,
      billingAddressSnapshot: order.billingAddressSnapshot,
      items,
    };
  },
};
