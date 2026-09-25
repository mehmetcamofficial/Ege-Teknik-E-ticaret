import { getDb } from "@/db";
import { auditLogs, brands, categories, products } from "@/db/schema";
import { getAdminUser } from "@/lib/admin-auth";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { readJson } from "@/lib/http-security";

const schema=z.object({type:z.enum(["brand","category"]),name:z.string().trim().min(2).max(100),slug:z.string().min(2).max(100).regex(/^[a-z0-9-]+$/)});
export async function GET(){if(!await getAdminUser())return Response.json({error:"Yetkisiz erişim"},{status:403});const db=getDb();const [brandRows,categoryRows]=await Promise.all([db.select().from(brands),db.select().from(categories)]);return Response.json({brands:brandRows,categories:categoryRows})}
export async function POST(request:Request){const user=await getAdminUser("catalog:write");if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});const parsed=schema.safeParse(await readJson(request));if(!parsed.success)return Response.json({error:"Marka/kategori alanlarını kontrol edin."},{status:400});const id=crypto.randomUUID(),db=getDb();if(parsed.data.type==="brand")await db.insert(brands).values({id,name:parsed.data.name,slug:parsed.data.slug});else await db.insert(categories).values({id,name:parsed.data.name,slug:parsed.data.slug});await db.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:user.userId,actorEmail:user.email,action:"create",entityType:parsed.data.type,entityId:id,payload:parsed.data});return Response.json({ok:true,id},{status:201})}
const patchSchema=z.object({type:z.enum(["brand","category"]),id:z.string().min(1).max(160),active:z.boolean()});
export async function PATCH(request:Request){const user=await getAdminUser("catalog:write");if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});const parsed=patchSchema.safeParse(await readJson(request));if(!parsed.success)return Response.json({error:"Güncelleme alanlarını kontrol edin."},{status:400});const db=getDb(),table=parsed.data.type==="brand"?brands:categories;await db.update(table).set({active:parsed.data.active,updatedAt:new Date()}).where(eq(table.id,parsed.data.id));await db.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:user.userId,actorEmail:user.email,action:"status",entityType:parsed.data.type,entityId:parsed.data.id,payload:{active:parsed.data.active}});return Response.json({ok:true})}

const deleteSchema = z.object({ type: z.enum(["brand", "category"]), id: z.string().min(1).max(160) });
export async function DELETE(request: Request) {
  const user = await getAdminUser("catalog:write");
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const parsed = deleteSchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: "Silinecek kayıt bilgisi eksik." }, { status: 400 });

  const db = getDb();
  if (parsed.data.type === "brand") {
    const [linked] = await db.select({ id: products.id }).from(products).where(eq(products.brandId, parsed.data.id)).limit(1);
    if (linked) return Response.json({ error: "Bu markaya bağlı ürünler bulunduğu için silinemez. Önce ürünlerin markasını değiştirin veya markayı pasifleştirin." }, { status: 409 });
    await db.delete(brands).where(eq(brands.id, parsed.data.id));
  } else {
    const [linked] = await db.select({ id: products.id }).from(products).where(eq(products.categoryId, parsed.data.id)).limit(1);
    if (linked) return Response.json({ error: "Bu kategoriye bağlı ürünler bulunduğu için silinemez. Önce ürünlerin kategorisini değiştirin veya kategoriyi pasifleştirin." }, { status: 409 });
    await db.delete(categories).where(eq(categories.id, parsed.data.id));
  }

  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: user.userId, actorEmail: user.email, action: "delete", entityType: parsed.data.type, entityId: parsed.data.id, payload: {} });
  return Response.json({ ok: true });
}

