export const ALLOWED_IMAGE_TYPES = ["jpeg", "png", "webp", "avif"] as const;
export type ImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const ALLOWED_IMAGE_MIME: Record<ImageType, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function extensionForImageType(type: ImageType): string {
  return type === "jpeg" ? "jpg" : type;
}

/**
 * Strips a SKU/slug down to a single safe pathname segment. Slashes and any
 * character outside [A-Za-z0-9._-] are removed rather than mapped, so the
 * result can never introduce a "/" or reconstruct a "../" traversal token.
 */
export function sanitizeIdentifierSegment(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return cleaned.slice(0, 160);
}

/**
 * products/{sku}/primary.{ext} when the product has a SKU, otherwise
 * products/by-slug/{slug}/primary.{ext}. Deterministic and overwritable, so
 * re-uploading always replaces the same primary-image object.
 */
export function buildImageObjectKey(product: { sku: string; slug: string }, type: ImageType): string {
  const ext = extensionForImageType(type);
  const sku = sanitizeIdentifierSegment(product.sku || "");
  if (sku) return `products/${sku}/primary.${ext}`;
  const slug = sanitizeIdentifierSegment(product.slug || "") || "unknown";
  return `products/by-slug/${slug}/primary.${ext}`;
}

/** Sniffs the real file signature; never trusts a client-declared Content-Type. */
export function detectImageSignature(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === "avif" || brand === "avis") return "avif";
  }
  return null;
}

export type ImageValidationResult = { ok: true; type: ImageType } | { ok: false; error: string };

/**
 * Rejects on size, on a declared MIME outside the allowlist (SVG included -
 * it is simply never in ALLOWED_IMAGE_MIME), on an unrecognized signature, and
 * on a signature that disagrees with the declared Content-Type.
 */
export function validateImageUpload(input: { declaredMimeType: string; size: number; bytes: Uint8Array }): ImageValidationResult {
  if (!input.size) return { ok: false, error: "Dosya boş." };
  if (input.size > MAX_IMAGE_BYTES) return { ok: false, error: "Dosya 4 MB sınırını aşıyor." };
  const declared = (Object.entries(ALLOWED_IMAGE_MIME) as [ImageType, string][]).find(([, mime]) => mime === input.declaredMimeType)?.[0] ?? null;
  if (!declared) return { ok: false, error: "Desteklenmeyen dosya türü." };
  const detected = detectImageSignature(input.bytes);
  if (!detected) return { ok: false, error: "Dosya imzası tanınmadı." };
  if (detected !== declared) return { ok: false, error: "Dosya türü ile içerik uyuşmuyor." };
  return { ok: true, type: detected };
}
