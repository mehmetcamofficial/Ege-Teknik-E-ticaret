import { del, put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, products } from "@/db/schema";
import { getAdminUser } from "@/lib/admin-auth";
import { ALLOWED_IMAGE_MIME, MAX_IMAGE_BYTES } from "@/lib/product-image";
import { uploadProductImage, type ProductImageDeps } from "@/lib/product-image-service";

const ALLOWED_MIME_VALUES = new Set(Object.values(ALLOWED_IMAGE_MIME));

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let file: File;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) return Response.json({ error: "Görsel dosyası eksik." }, { status: 400 });
    file = value;
  } catch {
    return Response.json({ error: "Geçersiz form verisi." }, { status: 400 });
  }

  if (!file.size) return Response.json({ error: "Görsel dosyası eksik." }, { status: 400 });
  // Cheap rejection before buffering into memory; the byte-accurate size/signature/SVG checks run inside uploadProductImage.
  if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "Dosya 4 MB sınırını aşıyor." }, { status: 400 });
  if (!ALLOWED_MIME_VALUES.has(file.type)) return Response.json({ error: "Desteklenmeyen dosya türü." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());

  const deps: ProductImageDeps = {
    getAdmin: () => getAdminUser("catalog:write"),
    findProduct: async (productId) => {
      const [row] = await getDb().select({ id: products.id, sku: products.sku, slug: products.slug }).from(products).where(eq(products.id, productId)).limit(1);
      return row ?? null;
    },
    updateProductImage: async (productId, url) =>
      getDb().update(products).set({ imageUrl: url, updatedAt: new Date() }).where(eq(products.id, productId)).returning({ id: products.id }),
    insertAuditLog: async (entry) => {
      await getDb().insert(auditLogs).values({
        id: crypto.randomUUID(),
        actorUserId: entry.actorUserId,
        actorEmail: entry.actorEmail,
        action: "image_upload",
        entityType: "product",
        entityId: entry.entityId,
        payload: entry.payload,
      });
    },
    blobPut: async (pathname, body, contentType) => put(pathname, Buffer.from(body), { access: "public", contentType, addRandomSuffix: false, allowOverwrite: true }),
    blobDelete: async (url) => {
      await del(url);
    },
  };

  const outcome = await uploadProductImage(deps, { productId: id, declaredMimeType: file.type, size: file.size, bytes });
  if (outcome.status !== 200) return Response.json({ error: outcome.error }, { status: outcome.status });
  return Response.json({ ok: true, imageUrl: outcome.imageUrl, auditLogged: outcome.auditLogged });
}
