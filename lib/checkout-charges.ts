import { calculateLine } from "./order-domain.ts";

/**
 * Fulfilment charges that form part of the payable total besides the products.
 *
 * FAIL-CLOSED: a tariff is either `pending` (no approved commercial price yet) or `configured`
 * with an explicit VAT-inclusive amount (0 = genuinely free) and its VAT rate. While a MANDATORY
 * charge is pending, no order can be created - the total the customer would see is not final.
 * Nothing here invents a price: every tariff is `pending` until the operator approves one and a
 * reviewed code change sets it. The client never supplies an amount; it only receives this
 * (public, non-secret) configuration for display, and the server recomputes at order time.
 */
export type Tariff = { status: "pending" } | { status: "configured"; amount: number; vatRateBps: number };
export type CheckoutTariffs = { delivery: Tariff; installation: Tariff };

export const CHECKOUT_TARIFFS: CheckoutTariffs = {
  delivery: { status: "pending" }, // paid delivery; carrier and tariff not yet approved
  installation: { status: "pending" }, // optional standard installation package; scope/price not yet approved
};

export type InstallationChoice = "survey_then_install" | "delivery_only";
export type ChargeLine = { amount: number; vatAmount: number };
export type ChargeResult =
  | { ok: true; delivery: ChargeLine; installation: ChargeLine; chargesTotal: number; chargesVat: number }
  | { ok: false; undetermined: ("delivery" | "installation")[] };

const valid = (tariff: Tariff) => tariff.status === "configured" && Number.isInteger(tariff.amount) && tariff.amount >= 0 && Number.isInteger(tariff.vatRateBps) && tariff.vatRateBps >= 0 && tariff.vatRateBps <= 10_000;
const price = (tariff: Tariff): ChargeLine => {
  if (tariff.status !== "configured") return { amount: 0, vatAmount: 0 };
  return { amount: tariff.amount, vatAmount: calculateLine(tariff.amount, 1, tariff.vatRateBps).vatAmount };
};

/** Delivery is always a mandatory charge; installation only counts when the customer chose it. */
export function priceCharges(installation: InstallationChoice, tariffs: CheckoutTariffs = CHECKOUT_TARIFFS): ChargeResult {
  const undetermined: ("delivery" | "installation")[] = [];
  if (!valid(tariffs.delivery)) undetermined.push("delivery");
  if (installation === "survey_then_install" && !valid(tariffs.installation)) undetermined.push("installation");
  if (undetermined.length) return { ok: false, undetermined };
  const delivery = price(tariffs.delivery);
  const installationLine = installation === "survey_then_install" ? price(tariffs.installation) : { amount: 0, vatAmount: 0 };
  return { ok: true, delivery, installation: installationLine, chargesTotal: delivery.amount + installationLine.amount, chargesVat: delivery.vatAmount + installationLine.vatAmount };
}

/** Order totals = products (VAT-inclusive) + delivery + installation. `subtotal` is net of all VAT. */
export function finalizeOrderTotals(productTotals: { total: number; vatTotal: number }, charges: Extract<ChargeResult, { ok: true }>) {
  const total = productTotals.total + charges.chargesTotal;
  const vatTotal = productTotals.vatTotal + charges.chargesVat;
  return { subtotal: total - vatTotal, vatTotal, total, shippingTotal: charges.delivery.amount, installationTotal: charges.installation.amount };
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
  const view = (t: Tariff) => (valid(t) && t.status === "configured" ? { status: "configured" as const, amount: t.amount, vatRateBps: t.vatRateBps } : { status: "pending" as const });
  return { delivery: view(tariffs.delivery), installation: view(tariffs.installation) };
}
