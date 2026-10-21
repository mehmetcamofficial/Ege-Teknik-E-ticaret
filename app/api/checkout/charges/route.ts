import { publicTariffs } from "@/lib/checkout-charges";
import { DISTRICTS_BY_PROVINCE, EGE_TEKNIK_SERVICE_PROVINCES, publicDeliveryTraits } from "@/lib/delivery";

/**
 * Read-only, non-secret: what the storefront may display - the optional carrier-shipping tariff, the Ege Teknik service-area
 * provinces (dealer delivery + installation are offered only there), the ONE canonical province -> district dataset (81
 * provinces, 973 districts; the province list is its keys, so nothing is repeated) and the delivery-class trait table (so the
 * browser looks a class up instead of carrying its own copy of the rule). The server recomputes and re-validates everything -
 * including that a district belongs to its province - when an order is created; the selects are convenience, not a boundary.
 */
export async function GET() {
  return Response.json({ ...publicTariffs(), serviceProvinces: EGE_TEKNIK_SERVICE_PROVINCES, locations: DISTRICTS_BY_PROVINCE, deliveryTraits: publicDeliveryTraits }, { headers: { "cache-control": "no-store" } });
}
