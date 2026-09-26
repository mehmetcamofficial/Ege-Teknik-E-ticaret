import { createHash } from "node:crypto";
import { z } from "zod";
import { readDeliverySnapshot } from "./order-delivery.ts";

export const orderStatuses = ["pending_payment", "paid", "preparing", "shipped", "delivery", "delivered", "installation", "completed", "cancelled", "returned", "service"] as const;
export type OrderStatus = typeof orderStatuses[number];
export const orderStatusLabels: Record<OrderStatus, string> = {
  pending_payment: "Ödeme Bekleniyor", paid: "Ödeme Alındı", preparing: "Hazırlanıyor", shipped: "Kargoya Verildi",
  delivery: "Dağıtımda", delivered: "Teslim Edildi", installation: "Montaj Bekleniyor", completed: "Tamamlandı",
  cancelled: "İptal Edildi", returned: "İade Edildi", service: "Serviste",
};
export function orderStatusLabel(status: string) {
  return orderStatusLabels[status as OrderStatus] ?? status;
}
const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"], paid: ["preparing", "cancelled", "service"], preparing: ["shipped", "delivery", "cancelled", "service"],
  shipped: ["delivered", "service"], delivery: ["delivered", "service"], delivered: ["installation", "completed", "returned", "service"],
  installation: ["completed", "service"], completed: ["returned", "service"], cancelled: [], returned: ["service"], service: ["completed"],
};
export function canTransitionOrder(from: OrderStatus, to: OrderStatus) { return transitions[from]?.includes(to) ?? false; }
export function calculateLine(unitPrice: number, quantity: number, vatRateBps: number) {
  const lineTotal = unitPrice * quantity; const vatAmount = Math.round(lineTotal * vatRateBps / (10_000 + vatRateBps)); return { lineTotal, vatAmount };
}

/**
 * The request body carries product ids and quantities only. Prices, VAT rates and totals are
 * never read from the client; they are derived here from the rows the server loaded.
 */
/**
 * Legacy values of `orders.installation_preference` (Phase 3.4 replaced the optional-installation choice:
 * standard installation is now part of the air-conditioner price). Orders created before that keep their
 * old values, so historical rows stay readable; new orders only ever get the two below.
 */
export const legacyInstallationPreferences = ["survey_then_install", "delivery_only"] as const;
export const installationPreferences = ["included_standard", "none", ...legacyInstallationPreferences] as const;
export const installationPreferenceFor = (installationIncluded: boolean) => (installationIncluded ? "included_standard" : "none") as "included_standard" | "none";
/** dealer = Ege Teknik delivery to the address; pickup = collected from the store; shipping = paid carrier (parts only). */
export const deliveryMethods = ["dealer", "pickup", "shipping"] as const;
export const orderRequestSchema = z.object({
  customerName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(150),
  // The PROVINCE (il) and DISTRICT (ilçe, free text). The province is checked against the canonical list on the server
  // (lib/delivery.ts); province and address are required by the server for every method except store pickup.
  city: z.string().trim().max(100).default(""),
  district: z.string().trim().max(100).default(""),
  address: z.string().trim().max(500).default(""),
  paymentProvider: z.enum(["PayTR", "iyzico", "discovery"]),
  items: z.array(z.object({ productId: z.string().min(1).max(160), quantity: z.number().int().min(1).max(10) })).min(1).max(20),
  // How the order is delivered. Only a PREFERENCE: the server derives what is allowed from the products' delivery
  // classes and prices any shipping itself. Omitted = the server's default (dealer delivery, or pickup for parts only).
  // Any `installation`/shipping/price field a client still sends is stripped by the schema and never read.
  delivery: z.enum(deliveryMethods).optional(),
  // Free-text delivery note: trimmed, length-limited, control characters removed.
  note: z.string().trim().max(500).transform((value) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")).default(""),
  // Ids of the legal document versions the customer accepted. The server decides which versions are
  // required; these are only checked against that set, never trusted as the source of truth.
  // The total shown to the customer. A guard only: the server recomputes every amount and refuses on mismatch.
  expectedTotal: z.number().int().min(0).max(100_000_000),
  // Optional, channel-specific marketing permission. Only an explicit `true` counts; omitted/false = no permission.
  marketing: z.object({ sms: z.boolean().default(false), email: z.boolean().default(false), whatsapp: z.boolean().default(false) }).default({ sms: false, email: false, whatsapp: false }),
  legalAcceptances: z.array(z.string().min(1).max(100)).max(10).refine((ids) => new Set(ids).size === ids.length, "Duplicate legal acceptance").default([]),
});
export type OrderRequest = z.infer<typeof orderRequestSchema>;

export const marketingChannelList = ["sms", "email", "whatsapp"] as const;
export type MarketingChannel = typeof marketingChannelList[number];
/** The channels the customer explicitly ticked, in a fixed order. */
export function marketingChannels(marketing: OrderRequest["marketing"]): MarketingChannel[] {
  return marketingChannelList.filter((channel) => marketing[channel] === true);
}

export type PricedProduct = { id: string; price: number; vatRateBps: number };

export function priceOrderLines<T extends PricedProduct>(products: readonly T[], quantities: ReadonlyMap<string, number>) {
  return products.map((product) => {
    const quantity = quantities.get(product.id) ?? 0;
    return { product, quantity, ...calculateLine(product.price, quantity, product.vatRateBps) };
  });
}

export function computeOrderTotals(lines: readonly { lineTotal: number; vatAmount: number }[]) {
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const vatTotal = lines.reduce((sum, line) => sum + line.vatAmount, 0);
  return { subtotal: total - vatTotal, vatTotal, total };
}

// ---- guest order confirmation --------------------------------------------------------------------
// What the customer may see immediately after placing (or replaying) an order: real order data only,
// projected through an explicit allow-list. No internal id ever appears here - not the order id, the
// customer id it was billed to, the address id, or the idempotency key. Both the just-created and the
// idempotent-replay response in app/api/orders/route.ts build their answer through this one function,
// so the two can never quietly drift apart.
export type PublicOrderItem = { productName: string; quantity: number; unitPrice: number; lineTotal: number };
export type PublicOrderConfirmation = {
  orderNumber: string;
  status: OrderStatus;
  items: PublicOrderItem[];
  subtotal: number;
  vatTotal: number;
  shippingTotal: number;
  installationTotal: number;
  total: number;
  delivery: { name: string; phone: string; email: string; city: string; district: string; address: string; installation: string; method: string };
};

export function toPublicOrderItem(line: { product: { name: string }; quantity: number; lineTotal: number }, unitPrice: number): PublicOrderItem {
  return { productName: line.product.name, quantity: line.quantity, unitPrice, lineTotal: line.lineTotal };
}

export function toOrderConfirmation(input: {
  orderNumber: string;
  status: string;
  items: readonly PublicOrderItem[];
  subtotal: number;
  vatTotal: number;
  shippingTotal: number;
  installationTotal: number;
  total: number;
  customerName: string;
  phone: string;
  email: string;
  city: string;
  district?: string;
  address: string;
  installation: string;
  deliveryMethod?: string;
}): PublicOrderConfirmation {
  return {
    orderNumber: input.orderNumber,
    status: input.status as OrderStatus,
    items: input.items.map((item) => ({ ...item })),
    subtotal: input.subtotal,
    vatTotal: input.vatTotal,
    shippingTotal: input.shippingTotal,
    installationTotal: input.installationTotal,
    total: input.total,
    delivery: { name: input.customerName, phone: input.phone, email: input.email, city: input.city, district: input.district ?? "", address: input.address, installation: input.installation, method: input.deliveryMethod ?? "" },
  };
}

/**
 * Deterministic fingerprint of the meaningful order-creation input, stored on the order so that an
 * Idempotency-Key replay can be told apart from a key re-used for a different request.
 * Canonical form: a fixed-order JSON array (never an object, so key order cannot vary), items sorted
 * by productId, legal version ids sorted. Client prices/totals and accepted_at are never part of it.
 * v2 adds the marketing channel choices; v3 (Phase 3.4) replaces the installation choice with the district and the
 * delivery preference. Bump the leading version number if the layout ever changes.
 */
export function orderRequestFingerprint(data: OrderRequest, quantities: ReadonlyMap<string, number>): string {
  const items = [...quantities].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonical = JSON.stringify([3, data.customerName, data.phone, data.email, data.city, data.district, data.address, data.paymentProvider, data.delivery ?? null, data.note, items, [...data.legalAcceptances].sort(), marketingChannels(data.marketing)]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** The delivery facts stored in `orders.shipping_address_snapshot`, read back defensively for the replay/confirmation. */
export function deliverySummaryFromSnapshot(snapshot: unknown): { district: string; deliveryMethod: string } {
  const { district, method } = readDeliverySnapshot(snapshot);
  return { district, deliveryMethod: method };
}
