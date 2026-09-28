import review from "../data/catalog-enrichment/catalog-enrichment.v1.json" with { type: "json" };

// Customer visibility follows the reviewed product decisions. Blocked rows remain
// in the database for admin review, but cannot be listed, opened or ordered.
const blockedProductIds = new Set(review.decisions.filter((decision) => decision.importStatus.startsWith("BLOCKED_")).map((decision) => decision.productId));

export function isCustomerVisibleProduct(productId: string) {
  return !blockedProductIds.has(productId);
}
