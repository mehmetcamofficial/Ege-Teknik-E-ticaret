import { z } from "zod";

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
export const orderRequestSchema = z.object({
  customerName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(150),
  city: z.string().trim().min(2).max(100),
  address: z.string().trim().min(8).max(500),
  paymentProvider: z.enum(["PayTR", "iyzico", "discovery"]),
  items: z.array(z.object({ productId: z.string().min(1).max(160), quantity: z.number().int().min(1).max(10) })).min(1).max(20),
});

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
