import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_IMAGE_BYTES,
  buildImageObjectKey,
  detectImageSignature,
  sanitizeIdentifierSegment,
  validateImageUpload,
} from "../lib/product-image.ts";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const AVIF_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
const SVG_BYTES = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");

test("detects jpeg/png/webp/avif signatures", () => {
  assert.equal(detectImageSignature(JPEG_BYTES), "jpeg");
  assert.equal(detectImageSignature(PNG_BYTES), "png");
  assert.equal(detectImageSignature(WEBP_BYTES), "webp");
  assert.equal(detectImageSignature(AVIF_BYTES), "avif");
});

test("does not recognize SVG or arbitrary bytes as any supported image type", () => {
  assert.equal(detectImageSignature(SVG_BYTES), null);
  assert.equal(detectImageSignature(new Uint8Array([0, 1, 2, 3])), null);
  assert.equal(detectImageSignature(new Uint8Array()), null);
});

test("accepts a file whose declared MIME matches its real signature", () => {
  const result = validateImageUpload({ declaredMimeType: "image/jpeg", size: JPEG_BYTES.length, bytes: JPEG_BYTES });
  assert.deepEqual(result, { ok: true, type: "jpeg" });
});

test("rejects SVG outright (never in the allowed MIME set, regardless of bytes)", () => {
  const result = validateImageUpload({ declaredMimeType: "image/svg+xml", size: SVG_BYTES.length, bytes: SVG_BYTES });
  assert.equal(result.ok, false);
});

test("rejects a MIME type outside the allowlist", () => {
  const result = validateImageUpload({ declaredMimeType: "image/gif", size: 10, bytes: new Uint8Array(10) });
  assert.equal(result.ok, false);
});

test("rejects when the declared MIME disagrees with the sniffed signature", () => {
  // Declares PNG but the bytes are really a JPEG.
  const result = validateImageUpload({ declaredMimeType: "image/png", size: JPEG_BYTES.length, bytes: JPEG_BYTES });
  assert.equal(result.ok, false);
});

test("rejects a file whose bytes match no known signature even with an allowed declared MIME", () => {
  const bogus = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const result = validateImageUpload({ declaredMimeType: "image/jpeg", size: bogus.length, bytes: bogus });
  assert.equal(result.ok, false);
});

test("rejects an empty file", () => {
  const result = validateImageUpload({ declaredMimeType: "image/jpeg", size: 0, bytes: new Uint8Array() });
  assert.equal(result.ok, false);
});

test("rejects a file over the 4 MB limit", () => {
  const result = validateImageUpload({ declaredMimeType: "image/jpeg", size: MAX_IMAGE_BYTES + 1, bytes: JPEG_BYTES });
  assert.equal(result.ok, false);
});

test("accepts a file exactly at the 4 MB limit", () => {
  const result = validateImageUpload({ declaredMimeType: "image/jpeg", size: MAX_IMAGE_BYTES, bytes: JPEG_BYTES });
  assert.equal(result.ok, true);
});

test("sanitizeIdentifierSegment strips path separators and collapses traversal tokens", () => {
  assert.ok(!sanitizeIdentifierSegment("../../etc/passwd").includes("/"));
  assert.ok(!sanitizeIdentifierSegment("../../etc/passwd").includes(".."));
  assert.ok(!sanitizeIdentifierSegment("a/../b").includes(".."));
  assert.ok(!sanitizeIdentifierSegment("a/../b").includes("/"));
});

test("sanitizeIdentifierSegment passes an already-clean SKU/slug through unchanged", () => {
  assert.equal(sanitizeIdentifierSegment("GWH09ALAXB-K6DNA2B"), "GWH09ALAXB-K6DNA2B");
  assert.equal(sanitizeIdentifierSegment("aphro-inverter-duvar-tipi-split-klima-r32-9000-btu-h-1"), "aphro-inverter-duvar-tipi-split-klima-r32-9000-btu-h-1");
});

test("buildImageObjectKey prefers SKU over slug and never contains a traversal token", () => {
  const key = buildImageObjectKey({ sku: "GWH09ALAXB-K6DNA2B", slug: "aphro-9000" }, "jpeg");
  assert.equal(key, "products/GWH09ALAXB-K6DNA2B/primary.jpg");
});

test("buildImageObjectKey falls back to the slug when no SKU is set", () => {
  const key = buildImageObjectKey({ sku: "", slug: "aphro-9000" }, "png");
  assert.equal(key, "products/by-slug/aphro-9000/primary.png");
});

test("buildImageObjectKey normalizes jpeg to a .jpg extension and keeps others as-is", () => {
  assert.equal(buildImageObjectKey({ sku: "s1", slug: "x" }, "jpeg"), "products/s1/primary.jpg");
  assert.equal(buildImageObjectKey({ sku: "s1", slug: "x" }, "webp"), "products/s1/primary.webp");
  assert.equal(buildImageObjectKey({ sku: "s1", slug: "x" }, "avif"), "products/s1/primary.avif");
});

test("buildImageObjectKey is safe even with a maliciously crafted SKU", () => {
  const key = buildImageObjectKey({ sku: "../../../etc/passwd", slug: "fallback" }, "png");
  assert.ok(!key.includes(".."));
  assert.ok(key.startsWith("products/"));
  assert.equal(key.split("/").filter((segment) => segment === "..").length, 0);
});
