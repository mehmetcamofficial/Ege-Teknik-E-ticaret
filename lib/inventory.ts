/**
 * Inventory invariant (one model, used everywhere):
 *
 *   on_hand  = units that can be sold RIGHT NOW. This is the number shown as "Stok" to customers
 *              (GET /api/products, product page), edited by the admin, and set to 0 on archive.
 *   reserved = units ALREADY REMOVED from on_hand and committed to open orders. Informational
 *              bookkeeping for fulfilment/return reconciliation; it is never subtracted again.
 *
 *   available = on_hand
 *   reserve(qty):     on_hand -= qty, reserved += qty   allowed only while on_hand >= qty
 *   (future) cancel:  on_hand += qty, reserved -= qty
 *   (future) fulfil:  reserved -= qty
 *
 * A reservation of N therefore lowers availability by exactly N. The order route enforces the same
 * rule in SQL as one atomic conditional UPDATE (`WHERE on_hand >= qty ... RETURNING`), which is what
 * makes concurrent orders unable to oversell; this module is the executable specification of it.
 * Before this rule was fixed the guard was `on_hand - reserved >= qty`, which counted every reserved
 * unit twice (it had already been removed from on_hand).
 */
export type InventoryRow = { onHand: number; reserved: number };

export function availableUnits(row: InventoryRow): number {
  return row.onHand;
}

export function reserveUnits(row: InventoryRow, quantity: number): { ok: true; next: InventoryRow } | { ok: false } {
  if (!Number.isInteger(quantity) || quantity < 1 || availableUnits(row) < quantity) return { ok: false };
  return { ok: true, next: { onHand: row.onHand - quantity, reserved: row.reserved + quantity } };
}
