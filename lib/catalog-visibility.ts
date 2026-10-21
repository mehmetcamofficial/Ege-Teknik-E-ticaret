import review from "../data/catalog-enrichment/catalog-enrichment.v1.json" with { type: "json" };

// Customer visibility follows the reviewed product decisions. Blocked rows remain
// in the database for admin review, but cannot be listed, opened or ordered.
const blockedDecisions = new Map(
  review.decisions
    .filter((decision) => decision.importStatus.startsWith("BLOCKED_"))
    .map((decision) => [decision.productId, { importStatus: decision.importStatus, reasons: decision.reasons }] as const),
);

export function isCustomerVisibleProduct(productId: string) {
  return !blockedDecisions.has(productId);
}

export type BlockedProductInfo = { importStatus: string; reasons: string[] };

/**
 * Admin-only: why a product is hidden from customers (badge + reason + filter). Reuses the exact
 * same catalog-enrichment review that drives isCustomerVisibleProduct above - one source of truth,
 * no schema change, no second copy of the block list.
 */
export function getBlockedProductInfo(productId: string): BlockedProductInfo | null {
  return blockedDecisions.get(productId) ?? null;
}
