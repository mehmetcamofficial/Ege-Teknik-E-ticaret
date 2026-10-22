import { getAdminUser } from "@/lib/admin-auth";
import { inventory, products } from "@/db/schema";
import { auditedMutation } from "@/lib/admin-audited";
import { eq } from "drizzle-orm";
import { readJson } from "@/lib/http-security";
import { patchProductSchema } from "@/lib/admin-product-schema";


export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser("catalog:write");
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const parsed = patchProductSchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: "Güncelleme alanlarını kontrol edin." }, { status: 400 });
  const { id } = await context.params;
  const { stock, ...product } = parsed.data;
  await auditedMutation(user, { action: "update", entityType: "product", entityId: id, payload: parsed.data }, async (tx) => { if (Object.keys(product).length) await tx.update(products).set({ ...product, updatedAt: new Date() }).where(eq(products.id, id)); if (stock !== undefined) await tx.update(inventory).set({ onHand: stock, updatedAt: new Date() }).where(eq(inventory.productId, id)); });
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser("catalog:write");
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const { id } = await context.params;
  await auditedMutation(user, { action: "archive", entityType: "product", entityId: id, payload: {} }, async (tx) => { await tx.update(products).set({ status:"draft", saleMode:"out_of_stock", updatedAt:new Date() }).where(eq(products.id,id)); await tx.update(inventory).set({ onHand:0, updatedAt:new Date() }).where(eq(inventory.productId,id)); });
  return Response.json({ ok:true });
}
