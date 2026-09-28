import { getDb } from "@/db";
import { secondHandProducts, secondHandReservations } from "@/db/schema";
import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { idempotencyKey } from "@/lib/request-security";
import { reserveSecondHandProduct } from "@/lib/second-hand-reservation";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({ productId: z.string().min(1).max(160), name: z.string().trim().min(2).max(100), phone: z.string().trim().min(7).max(30) });

async function reserve(request: Request) {
  await rateLimit(request, "second-hand-reservation", 5, 30 * 60_000);
  const key = idempotencyKey(request);
  if (!key) return Response.json({ error: "Güvenli istek anahtarı eksik." }, { status: 400 });
  const parsed = schema.safeParse(await readJson(request, 8_000));
  if (!parsed.success) return Response.json({ error: "Rezervasyon bilgilerini kontrol edin." }, { status: 400 });

  const db = getDb(), id = `reservation-${key}`, now = new Date(), expiresAt = new Date(now.getTime() + 30 * 60_000);
  const result = await reserveSecondHandProduct({ reservationId: id, ...parsed.data, now, expiresAt }, {
    transactionProductExclusive: (productId, work) => db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1164674122, hashtext(${productId}))`);
      return work({
        findReservation: async (reservationId) => {
          const [row] = await tx.select({ id: secondHandReservations.id, productId: secondHandReservations.productId, expiresAt: secondHandReservations.expiresAt })
            .from(secondHandReservations).where(eq(secondHandReservations.id, reservationId)).limit(1);
          return row ?? null;
        },
        deleteReservation: async (reservationId) => { await tx.delete(secondHandReservations).where(eq(secondHandReservations.id, reservationId)); },
        lockPublishedProduct: async (productIdToLock) => {
          const [row] = await tx.select({ id: secondHandProducts.id, stock: secondHandProducts.stock }).from(secondHandProducts)
            .where(and(eq(secondHandProducts.id, productIdToLock), eq(secondHandProducts.status, "published"), gt(secondHandProducts.stock, 0))).for("update").limit(1);
          return row ?? null;
        },
        countActiveReservations: async (productIdToCount, at) => {
          const [row] = await tx.select({ value: count() }).from(secondHandReservations)
            .where(and(eq(secondHandReservations.productId, productIdToCount), gt(secondHandReservations.expiresAt, at)));
          return row.value;
        },
        insertReservation: async (values) => { await tx.insert(secondHandReservations).values(values); },
      });
    }),
  });
  if (!result.ok) return Response.json({ error: result.code === "IDEMPOTENCY_CONFLICT" ? "Bu istek anahtarı farklı bir rezervasyon için kullanıldı." : "Ürün rezervasyona uygun değil." }, { status: 409 });
  return Response.json({ ok: true, reservationId: result.reservationId, expiresAt: result.expiresAt }, { status: result.created ? 201 : 200 });
}

export const POST = publicRoute(reserve);
