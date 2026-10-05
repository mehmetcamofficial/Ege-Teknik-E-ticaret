import { getDb } from "@/db";
import { inventory, products } from "@/db/schema";
import { isCustomerVisibleProduct } from "@/lib/catalog-visibility";
import { finalizeOrderTotals, totalMatchesDisplayed } from "@/lib/checkout-charges";
import { planDelivery, type DeliveryPlan } from "@/lib/delivery";
import { checkLegalAcceptance, missingNoticeSlugs, type RequiredLegalVersion } from "@/lib/legal";
import { loadCurrentLegalIndex, loadRequiredCheckoutLegalVersions } from "@/lib/legal-db";
import { MARKETING_CONSENT_DISABLED, computeOrderTotals, marketingConsentRequested, priceOrderLines, type OrderRequest } from "@/lib/order-domain";
import { and, eq, inArray } from "drizzle-orm";

/**
 * P3-LEGAL-3C.3 / P1 - the authoritative READ-AND-CALCULATE half of checkout.
 *
 * Everything a legal renderer will eventually need about an order is decided HERE, on the server, from database
 * prices and the server's own delivery/tariff rules - never from what the browser claims. This module exists so a
 * future pre-acceptance legal preview and real order creation consume ONE implementation and cannot disagree.
 *
 * It performs READS and CALCULATION only: no transaction, no writes. The caller owns the order transaction.
 * A refusal is returned as DATA (never as a `Response`) so this module stays free of HTTP concerns while the route
 * keeps owning status codes and bodies verbatim.
 *
 * P1 is a pure extraction: check order, messages, status codes and computed values are identical to the code that
 * was inlined in `POST /api/orders` before this module existed.
 */

type ProductRow = typeof products.$inferSelect;
type PricedLines = ReturnType<typeof priceOrderLines<ProductRow>>;

/** A refusal that must become exactly this HTTP response. */
export type CheckoutAuthorityRefusal = {
  ok: false;
  status: number;
  body: { error: string; code: string; total?: number };
};

/** The authoritative facts an order (and, later, a pre-acceptance legal render) must agree on. */
export type CheckoutAuthorityContext = {
  ok: true;
  /** Server-repriced lines. Every price comes from the database, never from the request. */
  lines: PricedLines;
  /** The server's delivery decision: method, canonical province/district, region and the shipping charge. */
  plan: DeliveryPlan;
  /** Product rows in the database's select order; SQL does not promise a stable order. */
  products: ProductRow[];
  subtotal: number;
  vatTotal: number;
  total: number;
  shippingTotal: number;
  installationTotal: number;
  /** Legal versions the server requires. The client never chooses these; it may only echo the ids. */
  requiredLegal: RequiredLegalVersion[];
  /** Derived from the validated customer name; used only by the customer insert. */
  customer: { firstName: string; lastName: string };
};

export type CheckoutAuthority = CheckoutAuthorityRefusal | CheckoutAuthorityContext;

const refuse = (status: number, body: CheckoutAuthorityRefusal["body"]): CheckoutAuthorityRefusal => ({ ok: false, status, body });

/**
 * LAYER 1 - preflight: what any checkout interaction needs before anything can be priced.
 *
 * Product visibility, the closed marketing gate, and the currently required checkout legal versions. The legal
 * PREVIEW calls this too: a preview legitimately happens BEFORE the customer has accepted anything, so it must not
 * depend on an acceptance assertion.
 */
export async function resolveCheckoutPreflight(
  parsed: { data: OrderRequest },
  requested: ReadonlyMap<string, number>,
): Promise<{ ok: true; requiredLegal: RequiredLegalVersion[] } | CheckoutAuthorityRefusal> {
  if ([...requested.keys()].some((productId) => !isCustomerVisibleProduct(productId))) {
    return refuse(409, { error: "Sepette satışa açık olmayan bir ürün var.", code: "PRODUCT_NOT_SELLABLE" });
  }
  // Marketing permission is closed until the İYS / izin-ret flow is ready: an explicit opt-in is refused, never recorded.
  if (marketingConsentRequested(parsed.data.marketing)) {
    return refuse(MARKETING_CONSENT_DISABLED.status, { error: MARKETING_CONSENT_DISABLED.error, code: MARKETING_CONSENT_DISABLED.code });
  }
  const legal = await loadRequiredCheckoutLegalVersions();
  if (!legal.ok) return refuse(503, { error: "Yasal metinler şu anda yayında değil; sipariş alınamıyor.", code: "LEGAL_DOCUMENTS_UNAVAILABLE" });
  return { ok: true, requiredLegal: legal.required };
}

/**
 * LAYER 2 - order-SUBMISSION-only legal gates. Deliberately NOT part of a preview.
 *
 * These assert that the customer actually accepted every required version, and that the KVKK notice is published. A
 * preview runs before acceptance, so requiring acceptance here would be circular; and a preview never takes personal
 * data, so the notice gate belongs to the moment data is collected.
 */
export async function assertOrderSubmissionLegalGates(
  parsed: { data: OrderRequest },
  requiredLegal: readonly RequiredLegalVersion[],
): Promise<CheckoutAuthorityRefusal | null> {
  const acceptance = checkLegalAcceptance(requiredLegal, parsed.data.legalAcceptances);
  if (!acceptance.ok) {
    const missing = acceptance.code === "LEGAL_ACCEPTANCE_REQUIRED";
    return refuse(missing ? 422 : 409, {
      error: missing ? "Devam etmek için tüm yasal metinleri kabul etmelisiniz." : "Yasal metinler güncellendi; lütfen sayfayı yenileyip tekrar onaylayın.",
      code: acceptance.code,
    });
  }
  // The KVKK disclosure is informational (never a checkbox) but must be published before personal data is collected.
  if (missingNoticeSlugs((await loadCurrentLegalIndex()).map((doc) => doc.slug)).length) {
    return refuse(503, { error: "Aydınlatma metni şu anda yayında değil; sipariş alınamıyor.", code: "LEGAL_NOTICE_UNAVAILABLE" });
  }
  return null;
}

/** LAYER 3 - the authoritative pricing/delivery/totals calculation. Pure reads and arithmetic; writes nothing. */
export async function resolveCheckoutCalculation(
  parsed: { data: OrderRequest },
  requested: ReadonlyMap<string, number>,
  requiredLegal: readonly RequiredLegalVersion[],
): Promise<CheckoutAuthorityContext | CheckoutAuthorityRefusal> {
  const rows = await getDb().select({ product: products }).from(products).innerJoin(inventory, eq(inventory.productId, products.id))
    .where(and(inArray(products.id, [...requested.keys()]), eq(products.status, "published"), eq(products.saleMode, "online")));
  if (rows.length !== requested.size) return refuse(409, { error: "Sepette satışa açık olmayan bir ürün var.", code: "PRODUCT_NOT_SELLABLE" });

  const catalog = rows.map(({ product }) => product);
  const lines = priceOrderLines(rows.map(({ product }) => product), requested);
  // Delivery plan, server-authoritative and fail-closed: the products' stored delivery classes decide installation,
  // shipping eligibility and the service area; the province is validated; any shipping fee is priced here. A refusal
  // (outside the Ege service area, shipping not available, invalid method) happens BEFORE anything is written.
  const delivery = planDelivery({ classes: rows.map(({ product }) => product.deliveryClass), province: parsed.data.city, district: parsed.data.district, method: parsed.data.delivery });
  if (!delivery.ok) return refuse(delivery.error.status, { error: delivery.error.message, code: delivery.error.code });
  const plan = delivery.plan;
  // Store pickup needs no address; dealer delivery and carrier shipping do.
  if (plan.method !== "pickup" && parsed.data.address.length < 8) return refuse(400, { error: "Lütfen teslimat adresinizi girin.", code: "ADDRESS_REQUIRED" });
  const { subtotal, vatTotal, total, shippingTotal, installationTotal } = finalizeOrderTotals(computeOrderTotals(lines), plan.shipping);
  // The displayed total is a guard, never the charged amount: a mismatch refuses the order so nothing unseen is charged.
  if (!totalMatchesDisplayed(total, parsed.data.expectedTotal)) {
    return refuse(409, { error: "Sipariş tutarı güncellendi; lütfen yeni tutarı kontrol edip tekrar onaylayın.", code: "PRICE_CHANGED", total });
  }
  const nameParts = parsed.data.customerName.split(/\s+/);
  const lastName = nameParts.length > 1 ? nameParts.pop()! : "-";
  return {
    ok: true,
    lines,
    plan,
    products: catalog,
    subtotal,
    vatTotal,
    total,
    shippingTotal,
    installationTotal,
    requiredLegal: [...requiredLegal],
    customer: { firstName: nameParts.join(" "), lastName },
  };
}

/**
 * The full order-submission authority: preflight, then the submission-only legal gates, then the calculation.
 *
 * The sequence is load-bearing and unchanged from canonical - the first matching refusal decides which message the
 * customer sees. It stays a single composed entry point so `POST /api/orders` behaviour cannot drift.
 */
export async function resolveCheckoutAuthority(parsed: { data: OrderRequest }, requested: ReadonlyMap<string, number>): Promise<CheckoutAuthority> {
  const preflight = await resolveCheckoutPreflight(parsed, requested);
  if (!preflight.ok) return preflight;
  const legalGate = await assertOrderSubmissionLegalGates(parsed, preflight.requiredLegal);
  if (legalGate) return legalGate;
  return resolveCheckoutCalculation(parsed, requested, preflight.requiredLegal);
}
