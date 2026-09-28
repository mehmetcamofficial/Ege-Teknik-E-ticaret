import { getDb } from "@/db";
import { brands, categories, products } from "@/db/schema";
import { auditedMutation } from "@/lib/admin-audited";
import { getAdminUser } from "@/lib/admin-auth";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { readJson } from "@/lib/http-security";

const schema=z.object({type:z.enum(["brand","category"]),name:z.string().trim().min(2).max(100),slug:z.string().min(2).max(100).regex(/^[a-z0-9-]+$/)});
export async function GET(){if(!await getAdminUser())return Response.json({error:"Yetkisiz erişim"},{status:403});const db=getDb();const [brandRows,categoryRows]=await Promise.all([db.select().from(brands),db.select().from(categories)]);return Response.json({brands:brandRows,categories:categoryRows})}
export async function POST(request:Request){const user=await getAdminUser("catalog:write");if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});const parsed=schema.safeParse(await readJson(request));if(!parsed.success)return Response.json({error:"Marka/kategori alanlarını kontrol edin."},{status:400});const id=crypto.randomUUID();await auditedMutation(user,{action:"create",entityType:parsed.data.type,entityId:id,payload:parsed.data},async(tx)=>{if(parsed.data.type==="brand")await tx.insert(brands).values({id,name:parsed.data.name,slug:parsed.data.slug});else await tx.insert(categories).values({id,name:parsed.data.name,slug:parsed.data.slug})});return Response.json({ok:true,id},{status:201})}
const patchSchema=z.object({type:z.enum(["brand","category"]),id:z.string().min(1).max(160),active:z.boolean()});
export async function PATCH(request:Request){const user=await getAdminUser("catalog:write");if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});const parsed=patchSchema.safeParse(await readJson(request));if(!parsed.success)return Response.json({error:"Güncelleme alanlarını kontrol edin."},{status:400});const table=parsed.data.type==="brand"?brands:categories;await auditedMutation(user,{action:"status",entityType:parsed.data.type,entityId:parsed.data.id,payload:{active:parsed.data.active}},async(tx)=>{await tx.update(table).set({active:parsed.data.active,updatedAt:new Date()}).where(eq(table.id,parsed.data.id))});return Response.json({ok:true})}

class StillInUse extends Error { constructor(readonly kind: "brand" | "category") { super("in use"); } }
const deleteSchema = z.object({ type: z.enum(["brand", "category"]), id: z.string().min(1).max(160) });
export async function DELETE(request: Request) {
  const user = await getAdminUser("catalog:write");
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const parsed = deleteSchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: "Silinecek kayıt bilgisi eksik." }, { status: 400 });

  try {
    // The linked-products check, the delete and the audit row are one transaction: a refusal writes nothing.
    await auditedMutation(user, { action: "delete", entityType: parsed.data.type, entityId: parsed.data.id, payload: {} }, async (tx) => {
      if (parsed.data.type === "brand") {
        const [linked] = await tx.select({ id: products.id }).from(products).where(eq(products.brandId, parsed.data.id)).limit(1);
        if (linked) throw new StillInUse("brand");
        await tx.delete(brands).where(eq(brands.id, parsed.data.id));
      } else {
        const [linked] = await tx.select({ id: products.id }).from(products).where(eq(products.categoryId, parsed.data.id)).limit(1);
        if (linked) throw new StillInUse("category");
        await tx.delete(categories).where(eq(categories.id, parsed.data.id));
      }
    });
  } catch (error) {
    if (error instanceof StillInUse) return Response.json({ error: error.kind === "brand" ? "Bu markaya bağlı ürünler bulunduğu için silinemez. Önce ürünlerin markasını değiştirin veya markayı pasifleştirin." : "Bu kategoriye bağlı ürünler bulunduğu için silinemez. Önce ürünlerin kategorisini değiştirin veya kategoriyi pasifleştirin." }, { status: 409 });
    throw error;
  }
  return Response.json({ ok: true });
}

