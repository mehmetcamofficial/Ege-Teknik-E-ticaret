/**
 * What an order recorded about its delivery, read back for people (Phase 3.4C). Dependency-free so both the
 * server (order confirmation replay) and the admin UI can use it.
 *
 * New orders store the facts in `orders.shipping_address_snapshot` (province, district and a `delivery` object with
 * the method, region, fee and whether standard installation was included) plus `installation_preference`. Orders
 * created before Phase 3.4 have none of the new fields, so every reader here degrades to a fixed, honest
 * fallback ("—" or an explicit legacy label) instead of guessing - and legacy orders are never migrated.
 */
export type DeliverySnapshot = { district: string; method: string; region: string; shippingFee: number | null; installationIncluded: boolean | null };

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Defensive read of the stored snapshot: any missing or malformed field becomes an empty/null value. */
export function readDeliverySnapshot(snapshot: unknown): DeliverySnapshot {
  const root = (snapshot && typeof snapshot === "object" ? snapshot : {}) as Record<string, unknown>;
  const delivery = (root.delivery && typeof root.delivery === "object" ? root.delivery : {}) as Record<string, unknown>;
  return {
    district: str(root.district),
    method: str(delivery.method),
    region: str(delivery.region),
    shippingFee: typeof delivery.shippingFee === "number" && Number.isFinite(delivery.shippingFee) ? delivery.shippingFee : null,
    installationIncluded: typeof delivery.installationIncluded === "boolean" ? delivery.installationIncluded : null,
  };
}

const METHOD_LABELS: Record<string, string> = { dealer: "Adrese teslim (Ege Teknik)", pickup: "Mağazadan teslim", shipping: "Kargo" };
const REGION_LABELS: Record<string, string> = { service: "Ege Teknik hizmet bölgesi", outside: "Hizmet bölgesi dışı" };
const INSTALLATION_LABELS: Record<string, string> = {
  included_standard: "Standart montaj dahil",
  none: "Montaj yok",
  // Legacy (before the standard installation was included in the air-conditioner price):
  survey_then_install: "Kurulum istendi (eski model, keşif sonrası fiyatlandırma)",
  delivery_only: "Kurulum yok (eski model)",
};

export type OrderDeliveryView = {
  province: string;
  district: string;
  method: string;
  region: string;
  /** Carrier fee in TL, or null when the order recorded no delivery fee. */
  shippingFee: number | null;
  installation: string;
  /** False for orders created before the delivery snapshot existed. */
  hasSnapshot: boolean;
};

export function describeOrderDelivery(order: { city?: string | null; shippingTotal?: number | null; installationPreference?: string | null; shippingAddressSnapshot?: unknown }): OrderDeliveryView {
  const snap = readDeliverySnapshot(order.shippingAddressSnapshot);
  const hasSnapshot = Boolean(snap.method);
  const shippingTotal = typeof order.shippingTotal === "number" && order.shippingTotal > 0 ? order.shippingTotal : null;
  const preference = order.installationPreference ?? "";
  return {
    province: order.city?.trim() || "—",
    district: snap.district || "—",
    method: METHOD_LABELS[snap.method] ?? "—",
    region: REGION_LABELS[snap.region] ?? "—",
    shippingFee: snap.method === "shipping" ? snap.shippingFee ?? shippingTotal : shippingTotal,
    installation: INSTALLATION_LABELS[preference] ?? (snap.installationIncluded === true ? INSTALLATION_LABELS.included_standard! : "—"),
    hasSnapshot,
  };
}
