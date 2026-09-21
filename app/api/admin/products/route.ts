import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { auditLogs, products } from "@/db/schema";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(2).max(160), slug: z.string().min(2).max(160).regex(/^[a-z0-9-]+$/), category: z.string().min(2).max(80),
  series: z.string().max(80).default(""), sku: z.string().max(80).default(""), capacity: z.string().max(80).default(""),
  energyClass: z.string().max(30).default(""), wifi: z.string().max(30).default(""), price: z.coerce.number().int().min(0), stock: z.coerce.number().int().min(0),
  saleMode: z.enum(["online", "quote", "discovery", "whatsapp", "out_of_stock"]), status: z.enum(["draft", "published"]), description: z.string().max(4000).default(""),
});

export async function POST(request: Request) {
  const user = await getAdminUser();
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ürün alanlarını kontrol edin.", details: parsed.error.flatten() }, { status: 400 });
  const id = crypto.randomUUID(); const db = getDb();
  await db.insert(products).values({ id, ...parsed.data });
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: user.userId, actorEmail: user.email, action: "create", entityType: "product", entityId: id, payload: JSON.stringify(parsed.data) });
  return Response.json({ ok: true, id }, { status: 201 });
}
