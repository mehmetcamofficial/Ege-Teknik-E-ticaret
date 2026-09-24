import { publicTariffs } from "@/lib/checkout-charges";

/** Read-only, non-secret: the delivery/installation tariffs the storefront may display. The server recomputes them when an order is created. */
export async function GET() {
  return Response.json(publicTariffs(), { headers: { "cache-control": "no-store" } });
}
