import { getDb } from "@/db";
import { serviceRequests } from "@/db/schema";
import { idempotencyKey } from "@/lib/request-security";
import { eq } from "drizzle-orm";
import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { serviceRequestSchema as requestSchema } from "@/lib/service-request-schema";

/** The bucket this endpoint has always used, unchanged: scope "service", 10 requests per hour per client. */
const SERVICE_REQUEST_LIMIT = 10;
const SERVICE_REQUEST_WINDOW_MS = 60 * 60 * 1000;

async function createServiceRequest(request: Request) {
  const key = idempotencyKey(request); if (!key) return Response.json({ error: "Güvenli istek anahtarı eksik." }, { status: 400 });
  const parsed = requestSchema.safeParse(await readJson(request,16_000));
  if (!parsed.success) return Response.json({ error: "Lütfen form alanlarını kontrol edin." }, { status: 400 });
  const db = getDb();
  const [existing] = await db.select({ requestNumber: serviceRequests.requestNumber }).from(serviceRequests).where(eq(serviceRequests.idempotencyKey, key)).limit(1);
  if (existing) return Response.json({ ok: true, requestNumber: existing.requestNumber });
  /* The one shared limiter every other public route uses. It keys on the same "service:<salted hash>"
     bucket this endpoint has always used, so the limit, the window and the existing counters are
     preserved - but it counts the request and answers 429 in ONE statement. The read-then-write block
     this replaces read the bucket, decided in JavaScript and then upserted from that stale read, so a
     burst of concurrent requests all saw the same "below the limit" state and all got through. */
  await rateLimit(request, "service", SERVICE_REQUEST_LIMIT, SERVICE_REQUEST_WINDOW_MS);
  const id = crypto.randomUUID();
  const requestNumber = `ET-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}`;
  await db.insert(serviceRequests).values({ id, requestNumber, idempotencyKey: key, ...parsed.data, phone: parsed.data.phone ?? "", email: parsed.data.email ?? "" });
  return Response.json({ ok: true, requestNumber }, { status: 201 });
}
export const POST=publicRoute(createServiceRequest);
