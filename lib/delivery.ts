import { CHECKOUT_TARIFFS, priceShipping, type ChargeLine, type CheckoutTariffs } from "./checkout-charges.ts";
import { deliveryTraits, isDeliveryClass, type DeliveryClass } from "./delivery-classes.ts";
import { DISTRICTS_BY_PROVINCE, TURKEY_PROVINCES, type ProvinceName } from "./turkey-locations.ts";
import type { deliveryMethods } from "./order-domain.ts";

/** Delivery domain (Phase 3.4): the classes, labels and traits live in ./delivery-classes.ts and are re-exported here; this module adds the province rules and the delivery plan. */
export * from "./delivery-classes.ts";

/**
 * The Ege Teknik SERVICE AREA: the provinces where Ege Teknik (or the related GREE service organisation) delivers and
 * installs. This is a business/service coverage decision, NOT the geographic "Ege Region" (Balikesir is in it, and
 * Afyonkarahisar is): never model it as a region. Every official district of these provinces is served.
 */
export const EGE_TEKNIK_SERVICE_PROVINCES = ["İzmir", "Aydın", "Muğla", "Manisa", "Denizli", "Uşak", "Kütahya", "Afyonkarahisar", "Balıkesir"] as const satisfies readonly ProvinceName[];

export { DISTRICTS_BY_PROVINCE, TURKEY_PROVINCES };
export type { ProvinceName };

/** Case-, diacritic- and locale-insensitive form: "IZMIR", "İzmir" and "izmir" are one name; "Muğla" = "mugla". Exact after that: no fuzzy matching. */
export function foldTr(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR").replaceAll("ı", "i").replaceAll("ş", "s").replaceAll("ğ", "g").replaceAll("ü", "u").replaceAll("ö", "o").replaceAll("ç", "c").replaceAll("â", "a").replaceAll("î", "i").replaceAll("û", "u").replace(/\s+/g, " ");
}
const foldedProvinces = new Map<string, ProvinceName>(TURKEY_PROVINCES.map((name) => [foldTr(name), name]));

/** The canonical province name for free input, or null when it is not a Turkish province. */
export function canonicalProvince(input: string): ProvinceName | null {
  return foldedProvinces.get(foldTr(input)) ?? null;
}
/** The canonical name of `district` INSIDE `province`, or null: unknown, or a real district of a different province. */
export function canonicalDistrict(province: ProvinceName, input: string): string | null {
  const wanted = foldTr(input);
  return (DISTRICTS_BY_PROVINCE[province] as readonly string[]).find((name) => foldTr(name) === wanted) ?? null;
}
export const isServiceProvince = (canonical: string): boolean => (EGE_TEKNIK_SERVICE_PROVINCES as readonly string[]).includes(canonical);

export type DeliveryMethod = (typeof deliveryMethods)[number];
export type DeliveryErrorCode = "INVALID_PROVINCE" | "INVALID_DISTRICT" | "DISTRICT_REQUIRED" | "SERVICE_AREA_UNAVAILABLE" | "INVALID_DELIVERY_METHOD" | "SHIPPING_UNAVAILABLE" | "INVALID_PRODUCT_DELIVERY" | "EMPTY_CART";
export type DeliveryError = { code: DeliveryErrorCode; status: number; message: string };
export type DeliveryPlan = {
  method: DeliveryMethod;
  /** Canonical province name, "" when none was given (pickup only). */
  province: string;
  /** Canonical district name inside the province, "" when none was given (pickup only). */
  district: string;
  /** "service" = inside the Ege Teknik service area, "outside" = elsewhere, "none" = no province given (pickup only). */
  region: "service" | "outside" | "none";
  /** Carrier shipping charge: zero unless the customer chose shipping for a parts-only cart. */
  shipping: ChargeLine;
  installationIncluded: boolean;
};

const fail = (code: DeliveryErrorCode, status: number, message: string): { ok: false; error: DeliveryError } => ({ ok: false, error: { code, status, message } });
export const SERVICE_AREA_MESSAGE = "Bu ürün için şu anda Ege Teknik hizmet bölgesi içinde teslimat ve kurulum hizmeti sunuyoruz.";
const PROVINCE_MESSAGE = "Lütfen listeden bir il seçin.";
const DISTRICT_MESSAGE = "Lütfen seçtiğiniz ile ait bir ilçe seçin.";
const DISTRICT_REQUIRED_MESSAGE = "Lütfen ilçe seçin.";

/**
 * The single server-side decision for how an order is delivered and what that costs. Pure and fail-closed; the client
 * selects are convenience only - every province/district combination is validated here.
 *
 *  - Any dealer-delivered line (air conditioner, local delivery): EVERYTHING in the order travels with the
 *    dealer/service delivery - spare parts in the same cart ride along, no separate shipping is offered or
 *    charged. Only the Ege Teknik service-area provinces are served, and the district must be a real district of the
 *    chosen province; anything else is refused, never silently accepted.
 *  - Parts only: the customer picks pickup (free) or carrier shipping (Turkey-wide, paid). Shipping is refused
 *    while its tariff is still `pending`; pickup keeps working. Province and district are required for shipping.
 *  - Pickup needs neither; but whatever IS given must be valid (a district needs its province, and belong to it).
 *  - The client only names a preference; the fee is never client-supplied.
 */
export function planDelivery(input: { classes: readonly unknown[]; province: string; district?: string; method?: DeliveryMethod | undefined; tariffs?: CheckoutTariffs }): { ok: true; plan: DeliveryPlan } | { ok: false; error: DeliveryError } {
  if (input.classes.length === 0) return fail("EMPTY_CART", 400, "Sepetiniz boş.");
  const classes: DeliveryClass[] = [];
  for (const value of input.classes) {
    if (!isDeliveryClass(value)) return fail("INVALID_PRODUCT_DELIVERY", 409, "Sepetteki bir ürünün teslimat bilgisi geçersiz; sipariş oluşturulamıyor.");
    classes.push(value);
  }
  const rawProvince = input.province.trim(), rawDistrict = (input.district ?? "").trim();
  let province: ProvinceName | "" = "";
  if (rawProvince) {
    const found = canonicalProvince(rawProvince);
    if (!found) return fail("INVALID_PROVINCE", 400, PROVINCE_MESSAGE);
    province = found;
  }
  let district = "";
  if (rawDistrict) {
    if (!province) return fail("INVALID_PROVINCE", 400, PROVINCE_MESSAGE);
    const found = canonicalDistrict(province, rawDistrict);
    if (!found) return fail("INVALID_DISTRICT", 422, DISTRICT_MESSAGE);
    district = found;
  }
  const region: DeliveryPlan["region"] = !province ? "none" : isServiceProvince(province) ? "service" : "outside";
  const locationRequired = () => (!province ? fail("INVALID_PROVINCE", 400, PROVINCE_MESSAGE) : !district ? fail("DISTRICT_REQUIRED", 400, DISTRICT_REQUIRED_MESSAGE) : null);
  const installationIncluded = classes.some((c) => deliveryTraits(c).installationIncluded);
  const zero: ChargeLine = { amount: 0, vatAmount: 0 };

  if (classes.some((c) => deliveryTraits(c).dealerDelivered)) {
    if (!province) return fail("INVALID_PROVINCE", 400, PROVINCE_MESSAGE);
    if (region !== "service") return fail("SERVICE_AREA_UNAVAILABLE", 422, SERVICE_AREA_MESSAGE);
    if (!district) return fail("DISTRICT_REQUIRED", 400, DISTRICT_REQUIRED_MESSAGE);
    if (input.method !== undefined && input.method !== "dealer") return fail("INVALID_DELIVERY_METHOD", 400, "Bu sepet için yalnızca Ege Teknik teslimatı seçilebilir.");
    return { ok: true, plan: { method: "dealer", province, district, region, shipping: zero, installationIncluded } };
  }

  const method = input.method ?? "pickup";
  if (method === "dealer") return fail("INVALID_DELIVERY_METHOD", 400, "Bu sepet için Ege Teknik teslimatı seçilemez; mağazadan teslim veya kargo seçin.");
  if (method === "pickup") return { ok: true, plan: { method, province, district, region, shipping: zero, installationIncluded } };
  const missing = locationRequired();
  if (missing) return missing;
  const shipping = priceShipping(input.tariffs ?? CHECKOUT_TARIFFS);
  if (!shipping.ok) return fail("SHIPPING_UNAVAILABLE", 409, "Kargo ücreti henüz belirlenmediği için kargo seçilemiyor; mağazadan teslim alabilirsiniz.");
  return { ok: true, plan: { method, province, district, region, shipping: shipping.charge, installationIncluded } };
}
