import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { auditLogs, products } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  name:z.string().min(2).max(160).optional(), slug:z.string().min(2).max(160).regex(/^[a-z0-9-]+$/).optional(), category:z.string().min(2).max(80).optional(),
  series:z.string().max(80).optional(), sku:z.string().max(80).optional(), capacity:z.string().max(80).optional(), energyClass:z.string().max(30).optional(), wifi:z.string().max(30).optional(),
  stock: z.coerce.number().int().min(0).optional(), price: z.coerce.number().int().min(0).optional(), status: z.enum(["draft", "published"]).optional(),
  saleMode: z.enum(["online", "quote", "discovery", "whatsapp", "out_of_stock"]).optional(), description:z.string().max(4000).optional(), imageUrl:z.string().max(1000).optional(),
}).refine((v) => Object.keys(v).length > 0);

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

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser();
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const { id } = await context.params; const db = getDb();
  await db.update(products).set({ status:"draft", stock:0, saleMode:"out_of_stock", updatedAt:new Date().toISOString() }).where(eq(products.id,id));
  await db.insert(auditLogs).values({ id:crypto.randomUUID(), actorUserId:user.userId, actorEmail:user.email, action:"archive", entityType:"product", entityId:id, payload:"{}" });
  return Response.json({ ok:true });
}
