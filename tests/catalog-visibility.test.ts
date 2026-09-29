import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getBlockedProductInfo, isCustomerVisibleProduct } from "../lib/catalog-visibility.ts";

/**
 * P0-A #2: admin-facing block info must stay in lockstep with the customer-facing visibility gate -
 * both are read from the same catalog-enrichment.v1.json decisions, no second source of truth.
 */
const review = JSON.parse(readFileSync("data/catalog-enrichment/catalog-enrichment.v1.json", "utf8")) as {
  decisions: { productId: string; importStatus: string; reasons: string[] }[];
};
const blocked = review.decisions.filter((d) => d.importStatus.startsWith("BLOCKED_"));
const visible = review.decisions.find((d) => !d.importStatus.startsWith("BLOCKED_"));

test("every BLOCKED_* decision is hidden from customers and exposes its reasons to admins", () => {
  assert.ok(blocked.length > 0, "fixture sanity: catalog-enrichment.v1.json has blocked decisions");
  for (const decision of blocked) {
    assert.equal(isCustomerVisibleProduct(decision.productId), false, decision.productId);
    const info = getBlockedProductInfo(decision.productId);
    assert.ok(info, decision.productId);
    assert.equal(info!.importStatus, decision.importStatus);
    assert.deepEqual(info!.reasons, decision.reasons);
  }
});

test("a non-blocked decision is customer-visible and has no admin block info", () => {
  assert.ok(visible, "fixture sanity: catalog-enrichment.v1.json has a non-blocked decision");
  assert.equal(isCustomerVisibleProduct(visible!.productId), true);
  assert.equal(getBlockedProductInfo(visible!.productId), null);
});

test("an id outside the review entirely is customer-visible and has no admin block info", () => {
  const unknownId = "not-a-real-product-id";
  assert.equal(isCustomerVisibleProduct(unknownId), true);
  assert.equal(getBlockedProductInfo(unknownId), null);
});

test("isCustomerVisibleProduct and getBlockedProductInfo never disagree", () => {
  for (const decision of review.decisions) {
    assert.equal(isCustomerVisibleProduct(decision.productId), getBlockedProductInfo(decision.productId) === null, decision.productId);
  }
});
