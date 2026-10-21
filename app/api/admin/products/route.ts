import { getAdminUser } from "@/lib/admin-auth";
import { inventory, products } from "@/db/schema";
import { auditedMutation } from "@/lib/admin-audited";
import { readJson } from "@/lib/http-security";
import { createProductSchema } from "@/lib/admin-product-schema";


export async function POST(request: Request) {
  const user = await getAdminUser("catalog:write");
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const parsed = createProductSchema.safeParse(await readJson(request));
  if (!parsed.success) return Response.json({ error: "Ürün alanlarını kontrol edin.", details: parsed.error.flatten() }, { status: 400 });
  const id = crypto.randomUUID();
  const { stock, ...product } = parsed.data;
  await auditedMutation(user, { action: "create", entityType: "product", entityId: id, payload: parsed.data }, async (tx) => { await tx.insert(products).values({ id, ...product }); await tx.insert(inventory).values({ id: crypto.randomUUID(), productId: id, onHand: stock }); });
  return Response.json({ ok: true, id }, { status: 201 });
}
