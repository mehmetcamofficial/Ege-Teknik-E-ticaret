import { getDb } from "@/db";
import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { idempotencyKey } from "@/lib/request-security";
import { reserveSecondHandProduct } from "@/lib/second-hand-reservation";
import { secondHandReservationDeps } from "@/lib/second-hand-reservation-db";
import { z } from "zod";

const schema = z.object({ productId: z.string().min(1).max(160), name: z.string().trim().min(2).max(100), phone: z.string().trim().min(7).max(30) });

async function reserve(request: Request) {
  await rateLimit(request, "second-hand-reservation", 5, 30 * 60_000);
  const key = idempotencyKey(request);
  if (!key) return Response.json({ error: "Güvenli istek anahtarı eksik." }, { status: 400 });
  const parsed = schema.safeParse(await readJson(request, 8_000));
  if (!parsed.success) return Response.json({ error: "Rezervasyon bilgilerini kontrol edin." }, { status: 400 });

  const db = getDb(), id = `reservation-${key}`, now = new Date(), expiresAt = new Date(now.getTime() + 30 * 60_000);
  const result = await reserveSecondHandProduct({ reservationId: id, ...parsed.data, now, expiresAt }, secondHandReservationDeps(db));
  if (!result.ok) return Response.json({ error: result.code === "IDEMPOTENCY_CONFLICT" ? "Bu istek anahtarı farklı bir rezervasyon için kullanıldı." : "Ürün rezervasyona uygun değil." }, { status: 409 });
  return Response.json({ ok: true, reservationId: result.reservationId, expiresAt: result.expiresAt }, { status: result.created ? 201 : 200 });
}

export const POST = publicRoute(reserve);
