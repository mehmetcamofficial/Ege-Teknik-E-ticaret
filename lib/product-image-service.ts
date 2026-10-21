import { ALLOWED_IMAGE_MIME, buildImageObjectKey, validateImageUpload, type ImageType } from "./product-image.ts";

export type AdminActor = { userId: string; email: string };
export type ProductImageRecord = { id: string; sku: string; slug: string };

/**
 * Every side effect the upload flow needs, injected so the sequencing and
 * failure/consistency behavior below can be unit tested without a real
 * Postgres connection or a real Blob store.
 */
export type ProductImageDeps = {
  getAdmin: () => Promise<AdminActor | null>;
  findProduct: (productId: string) => Promise<ProductImageRecord | null>;
  updateProductImage: (productId: string, url: string) => Promise<{ id: string }[]>;
  insertAuditLog: (entry: { actorUserId: string; actorEmail: string; entityId: string; payload: Record<string, unknown> }) => Promise<void>;
  blobPut: (pathname: string, bytes: Uint8Array, contentType: string) => Promise<{ url: string }>;
  blobDelete: (url: string) => Promise<void>;
};

export type ProductImageInput = { productId: string; declaredMimeType: string; size: number; bytes: Uint8Array };

export type ProductImageOutcome =
  | { status: 403; error: string }
  | { status: 404; error: string }
  | { status: 400; error: string }
  | { status: 500; error: string }
  | { status: 502; error: string }
  | { status: 200; ok: true; imageUrl: string; auditLogged: boolean };

async function safeDelete(deps: ProductImageDeps, url: string) {
  try {
    await deps.blobDelete(url);
  } catch {
    // Best-effort cleanup only; the orphaned object is not reported back as success either way.
  }
}

/**
 * Required sequence: authenticate -> validate product -> validate image ->
 * upload Blob -> update Neon -> write audit log -> return success.
 *
 * Consistency rules:
 * - A Blob upload failure never reaches the DB step (no write attempted).
 * - A DB failure (or a 0/2+ row update) AFTER a successful Blob upload
 *   triggers a best-effort delete of the object just created, so a failed
 *   request never leaves an orphaned Blob wired to nothing.
 * - An audit-log failure after a successful DB update does not get reported
 *   as a clean success: the response still carries ok:true (the product
 *   mutation itself did succeed and must not be resubmitted), but
 *   auditLogged:false so the caller/operator can see the gap explicitly
 *   instead of it being silently swallowed.
 * - An existing previous image is never deleted in this phase.
 */
export async function uploadProductImage(deps: ProductImageDeps, input: ProductImageInput): Promise<ProductImageOutcome> {
  const actor = await deps.getAdmin();
  if (!actor) return { status: 403, error: "Yetkisiz erişim" };

  const product = await deps.findProduct(input.productId);
  if (!product) return { status: 404, error: "Ürün bulunamadı." };

  const validated = validateImageUpload({ declaredMimeType: input.declaredMimeType, size: input.size, bytes: input.bytes });
  if (!validated.ok) return { status: 400, error: validated.error };

  const pathname = buildImageObjectKey(product, validated.type);
  const contentType = mimeForType(validated.type);

  let uploaded: { url: string };
  try {
    uploaded = await deps.blobPut(pathname, input.bytes, contentType);
  } catch {
    return { status: 502, error: "Görsel depoya yüklenemedi." };
  }

  let updated: { id: string }[];
  try {
    updated = await deps.updateProductImage(product.id, uploaded.url);
  } catch {
    await safeDelete(deps, uploaded.url);
    return { status: 500, error: "Ürün güncellenemedi." };
  }
  if (updated.length !== 1) {
    await safeDelete(deps, uploaded.url);
    return { status: 500, error: "Ürün güncellenemedi." };
  }

  let auditLogged = true;
  try {
    await deps.insertAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      entityId: product.id,
      payload: { action: "image_upload", imageUrl: uploaded.url, pathname },
    });
  } catch {
    auditLogged = false;
  }

  return { status: 200, ok: true, imageUrl: uploaded.url, auditLogged };
}

function mimeForType(type: ImageType): string {
  return ALLOWED_IMAGE_MIME[type];
}
