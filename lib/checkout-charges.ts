import { calculateLine } from "./order-domain.ts";

/**
 * Charges that form part of the payable total besides the products (Phase 3.4 model).
 *
 * The air conditioner price INCLUDES Ege delivery and standard installation, so there is no delivery or
 * installation surcharge any more. The only extra charge is OPTIONAL carrier shipping for parts-only carts.
 *
 * FAIL-CLOSED: the shipping tariff is either `pending` (no approved commercial price yet) or `configured`
 * with an explicit VAT-inclusive amount (0 = genuinely free) and its VAT rate. While it is pending, only the
 * choice of carrier shipping is refused - pickup and dealer delivery are unaffected. Nothing here invents a
 * price: it stays `pending` until the operator approves one and a reviewed code change sets it. The client
 * never supplies an amount; it only receives this (public, non-secret) configuration for display, and the
 * server recomputes at order time. All amounts are integer TL.
 */
export type Tariff = { status: "pending" } | { status: "configured"; amount: number; vatRateBps: number };
export type CheckoutTariffs = { shipping: Tariff };

export const CHECKOUT_TARIFFS: CheckoutTariffs = {
  shipping: { status: "pending" }, // optional carrier shipping for parts; carrier and tariff not yet approved
};

export type ChargeLine = { amount: number; vatAmount: number };
export type ShippingCharge = { ok: true; charge: ChargeLine } | { ok: false; reason: "pending" };

const valid = (tariff: Tariff) => tariff.status === "configured" && Number.isInteger(tariff.amount) && tariff.amount >= 0 && Number.isInteger(tariff.vatRateBps) && tariff.vatRateBps >= 0 && tariff.vatRateBps <= 10_000;

/** The carrier shipping charge for one order (a flat fee per order), or `pending` while no approved tariff exists. */
export function priceShipping(tariffs: CheckoutTariffs = CHECKOUT_TARIFFS): ShippingCharge {
  const tariff = tariffs.shipping;
  if (tariff.status !== "configured" || !valid(tariff)) return { ok: false, reason: "pending" };
  return { ok: true, charge: { amount: tariff.amount, vatAmount: calculateLine(tariff.amount, 1, tariff.vatRateBps).vatAmount } };
}

/** Order totals = products (VAT-inclusive) + optional shipping. `subtotal` is net of all VAT; installation is included in the product price, so `installationTotal` is always 0. */
export function finalizeOrderTotals(productTotals: { total: number; vatTotal: number }, shipping: ChargeLine) {
  const total = productTotals.total + shipping.amount;
  const vatTotal = productTotals.vatTotal + shipping.vatAmount;
  return { subtotal: total - vatTotal, vatTotal, total, shippingTotal: shipping.amount, installationTotal: 0 };
}

/**
 * The total the customer was shown is only a guard, never the charged amount: if it differs from the
 * server's own total (price/tariff changed meanwhile) the order is refused so nothing unseen is charged.
 */
export function totalMatchesDisplayed(serverTotal: number, displayedTotal: number): boolean {
  return Number.isInteger(displayedTotal) && displayedTotal === serverTotal;
}

/** What the storefront may see: configuration only, no internals. */
export function publicTariffs(tariffs: CheckoutTariffs = CHECKOUT_TARIFFS) {
  const t = tariffs.shipping;
  return { shipping: valid(t) && t.status === "configured" ? { status: "configured" as const, amount: t.amount, vatRateBps: t.vatRateBps } : { status: "pending" as const } };
}
