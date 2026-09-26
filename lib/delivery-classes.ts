/**
 * Delivery classes: the pure, dependency-free half of the delivery domain. It lives in its own module so client
 * components (the admin product form and list) can use the labels without pulling server-only code such as
 * node:crypto (via order-domain) into the browser bundle. lib/delivery.ts re-exports everything here.
 */
/**
 * ONE stored fact per product - `products.delivery_class` - and everything else
 * (is installation included? may it be shipped? does it need the service area?) is derived from it here.
 * Nothing in this module, or anywhere that uses it, may infer any of that from a product name or a category
 * label: the class is an explicit column, defaulting to the safest value (dealer delivery with installation,
 * never carrier shipping).
 *
 *   installed_delivery  air conditioners: Ege Teknik delivers to the address, standard installation is part of
 *                       the product price. Never shipped by carrier, no delivery or installation surcharge.
 *   local_delivery      large/heavy items without a standard installation: dealer delivery only, never carrier.
 *   shippable           small spare parts/accessories: pickup, or paid carrier shipping if the customer chooses it.
 */
export const deliveryClasses = ["installed_delivery", "shippable", "local_delivery"] as const;
export type DeliveryClass = (typeof deliveryClasses)[number];
export const DEFAULT_DELIVERY_CLASS: DeliveryClass = "installed_delivery";
export const isDeliveryClass = (value: unknown): value is DeliveryClass => (deliveryClasses as readonly unknown[]).includes(value);

/** Admin-facing names (never show the raw enum), short descriptions and compact list badges: one source for every screen. */
export const deliveryClassLabels: Record<DeliveryClass, string> = {
  installed_delivery: "Adrese teslim + standart montaj",
  shippable: "Kargoya uygun",
  local_delivery: "Yerel teslimat",
};
export const deliveryClassDescriptions: Record<DeliveryClass, string> = {
  installed_delivery: "Ürün Ege Teknik hizmet bölgesinde adrese teslim edilir ve standart montajı fiyata dahildir.",
  shippable: "Ürün mağazadan teslim alınabilir veya kargo tarifesi aktif olduğunda kargolanabilir.",
  local_delivery: "Ürün Ege Teknik hizmet bölgesinde bayi teslimatıyla gönderilir; standart montaj kapsamı ürün tipine göre uygulanır.",
};
export const deliveryClassBadges: Record<DeliveryClass, string> = {
  installed_delivery: "Montajlı teslimat",
  shippable: "Kargoya uygun",
  local_delivery: "Yerel teslimat",
};
/** Label for a stored value; an unknown/legacy value is shown as-is rather than guessed. */
export const deliveryClassLabel = (value: unknown): string => (isDeliveryClass(value) ? deliveryClassLabels[value] : "—");

export type DeliveryTraits = { installationIncluded: boolean; shippingEligible: boolean; dealerDelivered: boolean };
const TRAITS: Record<DeliveryClass, DeliveryTraits> = {
  installed_delivery: { installationIncluded: true, shippingEligible: false, dealerDelivered: true },
  local_delivery: { installationIncluded: false, shippingEligible: false, dealerDelivered: true },
  shippable: { installationIncluded: false, shippingEligible: true, dealerDelivered: false },
};
export const deliveryTraits = (deliveryClass: DeliveryClass): DeliveryTraits => TRAITS[deliveryClass];
/** The trait table the storefront may read, so the browser needs no copy of the rule (it only looks the class up). */
export const publicDeliveryTraits = Object.fromEntries(deliveryClasses.map((c) => [c, TRAITS[c]])) as Record<DeliveryClass, DeliveryTraits>;

/** Compact badge text for a list row; null for an unknown value (nothing is guessed). */
export const deliveryClassBadge = (value: unknown): string | null => (isDeliveryClass(value) ? deliveryClassBadges[value] : null);
