export const orderStatuses = ["pending_payment", "paid", "preparing", "shipped", "delivery", "delivered", "installation", "completed", "cancelled", "returned", "service"] as const;
export type OrderStatus = typeof orderStatuses[number];
const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"], paid: ["preparing", "cancelled", "service"], preparing: ["shipped", "delivery", "cancelled", "service"],
  shipped: ["delivered", "service"], delivery: ["delivered", "service"], delivered: ["installation", "completed", "returned", "service"],
  installation: ["completed", "service"], completed: ["returned", "service"], cancelled: [], returned: ["service"], service: ["completed"],
};
export function canTransitionOrder(from: OrderStatus, to: OrderStatus) { return transitions[from]?.includes(to) ?? false; }
export function calculateLine(unitPrice: number, quantity: number, vatRateBps: number) {
  const lineTotal = unitPrice * quantity; const vatAmount = Math.round(lineTotal * vatRateBps / (10_000 + vatRateBps)); return { lineTotal, vatAmount };
}
