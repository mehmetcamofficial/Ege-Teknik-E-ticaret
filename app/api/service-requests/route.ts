import { getDb } from "@/db";
import { rateLimitBuckets, serviceRequests } from "@/db/schema";
import { idempotencyKey, hashClientIp } from "@/lib/request-security";
import { eq, sql } from "drizzle-orm";
import { publicRoute, readJson } from "@/lib/http-security";
import { z } from "zod";

const requestSchema = z.object({
  type: z.string().min(1).max(40), name: z.string().min(2).max(100), phone: z.string().min(7).max(30),
  email: z.string().email().max(150).optional().or(z.literal("")), city: z.string().min(2).max(100), message: z.string().min(3).max(3000),
});

async function createServiceRequest(request: Request) {
  const key = idempotencyKey(request); if (!key) return Response.json({ error: "Güvenli istek anahtarı eksik." }, { status: 400 });
  const parsed = requestSchema.safeParse(await readJson(request,16_000));
  if (!parsed.success) return Response.json({ error: "Lütfen form alanlarını kontrol edin." }, { status: 400 });
  const db = getDb();
  const [existing] = await db.select({ requestNumber: serviceRequests.requestNumber }).from(serviceRequests).where(eq(serviceRequests.idempotencyKey, key)).limit(1);
  if (existing) return Response.json({ ok: true, requestNumber: existing.requestNumber });
  const bucketKey = `service:${await hashClientIp(request)}`, now = new Date(), expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  const [bucket] = await db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.key, bucketKey)).limit(1);
  if (bucket && bucket.expiresAt > now && bucket.count >= 10) return Response.json({ error: "Çok fazla talep gönderildi. Lütfen daha sonra tekrar deneyin." }, { status: 429 });
  await db.insert(rateLimitBuckets).values({ key: bucketKey, count: 1, windowStartedAt: now, expiresAt }).onConflictDoUpdate({ target: rateLimitBuckets.key, set: bucket && bucket.expiresAt > now ? { count: sql`${rateLimitBuckets.count} + 1` } : { count: 1, windowStartedAt: now, expiresAt } });
  const id = crypto.randomUUID();
  const requestNumber = `ET-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}`;
  await db.insert(serviceRequests).values({ id, requestNumber, idempotencyKey: key, ...parsed.data });
  return Response.json({ ok: true, requestNumber }, { status: 201 });
}
export const POST=publicRoute(createServiceRequest);
