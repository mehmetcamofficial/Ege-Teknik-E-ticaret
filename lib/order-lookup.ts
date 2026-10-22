import { z } from "zod";
import { sameOrderEmail } from "./order-email.ts";
import { deliverySummaryFromSnapshot, toOrderConfirmation, type PublicOrderConfirmation } from "./order-domain.ts";

/**
 * P3-A1: the guest's own order lookup - the customer proves an order is theirs with the order number AND
 * the e-mail address they gave at checkout. No account, no session, no Clerk.
 *
 * Pure by design (no next/*, no db import), the same convention as lib/account-resources.ts: the ownership
 * rule is unit-testable under plain `node --test` with in-memory fake stores, and the real Drizzle wiring
 * lives in lib/order-lookup-db.ts.
 *
 * Three rules this module exists to enforce:
 *
 *  1. Ownership is TWO facts, never one. The order number alone is not accepted anywhere (its suffix is a
 *     UUID slice), and an e-mail alone is not a secret. Both must match.
 *  2. The e-mail is compared against the ORDER's own snapshot (orders.email - the value typed at checkout),
 *     never a customers table: a guest order's customer row belongs to no account, and the address the
 *     order was placed with is the one the customer still holds.
 *  3. The three refusals - no such order, wrong e-mail, and an order whose stored e-mail is empty - return
 *     the SAME failure object, so nothing external can tell them apart (no order-number enumeration
 *     oracle). That is the same refusal startPaytrPayment() already returns for the same proof.
 */

/** The body. Bounded and shaped here so a malformed request never reaches the database. */
export const orderLookupSchema = z.object({
  orderNumber: z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9-]+$/, "Sipariş numarası geçersiz."),
  email: z.string().trim().email().max(150),
});
export type OrderLookupInput = z.infer<typeof orderLookupSchema>;

/** One refusal for all three ownership failures: identical status, code and message (see rule 3). */
export const ORDER_LOOKUP_FAILURE = {
  status: 404,
  code: "ORDER_NOT_FOUND",
  error: "Sipariş bilgileri doğrulanamadı. Sipariş numarası ve e-posta adresini kontrol edin.",
} as const;

/** Malformed input, refused before any lookup. Says nothing about whether the order exists. */
export const ORDER_LOOKUP_INVALID = {
  status: 400,
  code: "INVALID_REQUEST",
  error: "Sipariş numarası ve e-posta adresini kontrol edin.",
} as const;

/**
 * Exactly the columns the public confirmation can be built from - and nothing else. `internalId` is the
 * order's own database id, used ONLY to fetch that order's items; it must never reach a response (the
 * projection below cannot carry it). No idempotency key, fingerprint, notes, billing snapshot, payment,
 * refund, shipment, customer, admin or audit column may be added here: the store has no reason to read them.
 */
export type OrderLookupRow = {
  internalId: string;
  orderNumber: string;
  email: string;
  status: string;
  createdAt: Date;
  customerName: string;
  phone: string;
  city: string;
  address: string;
  installationPreference: string | null;
  shippingAddressSnapshot: unknown;
  subtotal: number;
  vatTotal: number;
  shippingTotal: number;
  installationTotal: number;
  total: number;
};

/** The four order-item columns the customer saw at checkout. No id, productId, snapshot or VAT breakdown. */
export type OrderLookupItemRow = { productName: string; quantity: number; unitPrice: number; lineTotal: number };

export type OrderLookupStore = {
  /** Must select ONLY OrderLookupRow's fields, WHERE order_number = $1, LIMIT 1. A SELECT only. */
  findByOrderNumber: (orderNumber: string) => Promise<OrderLookupRow | null>;
  /** Must select ONLY OrderLookupItemRow's fields WHERE order_id = $1 - the matched order's own internal id. */
  listItemsForOrder: (orderId: string) => Promise<OrderLookupItemRow[]>;
};

export type OrderLookupResult = { ok: true; order: PublicOrderConfirmation } | { ok: false; failure: typeof ORDER_LOOKUP_FAILURE };

/**
 * Read-only. Items are fetched only after ownership has been proven, so a wrong e-mail never even reads
 * them, and the projection is the same allow-list the checkout confirmation and the idempotent replay use.
 */
export async function lookupGuestOrder(input: OrderLookupInput, store: OrderLookupStore): Promise<OrderLookupResult> {
  const row = await store.findByOrderNumber(input.orderNumber);
  if (!row || !row.email || !sameOrderEmail(row.email, input.email)) return { ok: false, failure: ORDER_LOOKUP_FAILURE };
  const items = await store.listItemsForOrder(row.internalId);
  return {
    ok: true,
    order: toOrderConfirmation({
      orderNumber: row.orderNumber,
      status: row.status,
      createdAt: row.createdAt,
      items,
      subtotal: row.subtotal,
      vatTotal: row.vatTotal,
      shippingTotal: row.shippingTotal,
      installationTotal: row.installationTotal,
      total: row.total,
      customerName: row.customerName,
      phone: row.phone,
      email: row.email,
      city: row.city,
      address: row.address,
      installation: row.installationPreference ?? "none",
      ...deliverySummaryFromSnapshot(row.shippingAddressSnapshot),
    }),
  };
}