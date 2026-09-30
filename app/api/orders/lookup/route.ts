import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { ORDER_LOOKUP_INVALID, lookupGuestOrder, orderLookupSchema } from "@/lib/order-lookup";
import { orderLookupStore } from "@/lib/order-lookup-db";

/**
 * POST /api/orders/lookup - the guest retrieves their own order with the order number and the e-mail
 * address they gave at checkout.
 *
 * POST although it only reads, and that is deliberate: the e-mail is a credential here, and a GET would
 * put it in the URL - browser history, Referer, and the access log of every proxy in front of this app. It
 * also inherits, for free, the same-origin refusal proxy.ts already applies to POST /api/* and its 64 KB
 * body cap, while readJson() adds the malformed-JSON and card-data rejections.
 *
 * Nothing about the caller is trusted and nothing is stored: no session, no cookie, no Clerk, no write.
 * Whether the order exists, the e-mail is wrong, or the order recorded no e-mail, the answer is the single
 * 404 below, so this endpoint cannot be used to discover which order numbers exist.
 */
const NO_STORE = { "cache-control": "no-store" };

async function lookup(request: Request) {
  await rateLimit(request, "order-lookup", 10, 15 * 60_000);
  const parsed = orderLookupSchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: ORDER_LOOKUP_INVALID.error, code: ORDER_LOOKUP_INVALID.code }, { status: ORDER_LOOKUP_INVALID.status, headers: NO_STORE });
  const result = await lookupGuestOrder(parsed.data, orderLookupStore);
  if (!result.ok) return Response.json({ error: result.failure.error, code: result.failure.code }, { status: result.failure.status, headers: NO_STORE });
  return Response.json({ ok: true, order: result.order }, { headers: NO_STORE });
}

/** publicRoute keeps the shared error contract (a thrown HttpError still yields the standard JSON), and
 *  every answer it produces - 200, 400, 404, 429 or 500 - is marked uncacheable here. */
export const POST = publicRoute(async (request: Request) => {
  const response = await lookup(request);
  response.headers.set("cache-control", "no-store");
  return response;
});