import { randomUUID } from "node:crypto";

/**
 * P3-LEGAL-3C.4 / P2 - the ONE order-identity generator.
 *
 * The legal preview mints the order identity BEFORE the order exists, and `POST /api/orders` must then reuse
 * exactly that identity. Two independent generators would let a preview and its order disagree, so the format lives
 * here and both call sites use it. The format is unchanged from canonical: `ETS-<YYYYMMDD>-<6 hex>` derived from the
 * order's own timestamp, so the printed number and the displayed order date always agree.
 *
 * Order numbers are deliberately NOT contiguous: an abandoned stateless preview may consume one. Nothing may depend
 * on contiguity.
 */
export type OrderIdentity = { id: string; orderNumber: string };

export function createOrderIdentity(issuedAt: Date): OrderIdentity {
  const id = randomUUID();
  return { id, orderNumber: `ETS-${issuedAt.toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}` };
}
