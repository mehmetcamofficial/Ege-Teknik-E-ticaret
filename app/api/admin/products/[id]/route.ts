import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { auditLogs, products } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({ stock: z.coerce.number().int().min(0).optional(), price: z.coerce.number().int().min(0).optional(), status: z.enum(["draft", "published"]).optional(), saleMode: z.enum(["online", "quote", "discovery", "whatsapp", "out_of_stock"]).optional() }).refine((v) => Object.keys(v).length > 0);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser();
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Güncelleme alanlarını kontrol edin." }, { status: 400 });
  const { id } = await context.params; const db = getDb();
  await db.update(products).set({ ...parsed.data, updatedAt: new Date().toISOString() }).where(eq(products.id, id));
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: user.userId, actorEmail: user.email, action: "update", entityType: "product", entityId: id, payload: JSON.stringify(parsed.data) });
  return Response.json({ ok: true });
}
