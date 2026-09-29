import assert from "node:assert/strict";
import test from "node:test";
import { createProductSchema, patchProductSchema } from "../lib/admin-product-schema.ts";

/**
 * P0-A #4: gallery/specifications/documents/manufacturerWarranty reuse lib/product-enrichment.ts's schemas
 * verbatim, so admin-saved data is exactly what the storefront's toPublic* projections can actually surface
 * (those projections silently drop anything that fails these same schemas). These tests exercise that reuse
 * directly against createProductSchema/patchProductSchema, not against product-enrichment.ts itself (which has
 * no test file of its own).
 */
const baseProduct = { name: "Test Klima", slug: "test-klima", category: "Klima", price: 10000, stock: 5, saleMode: "quote", status: "draft" };

const validGalleryItem = { url: "https://gree.com.tr/urun/gorsel.jpg", alt: "Ürün görseli", width: 800, height: 600 };
const validSpecifications = { wifi: { label: "Wi-Fi", value: "Var", unit: null, status: "verified", source: { kind: "product_page", url: "https://gree.com.tr/urun" } } };
const validDocument = { type: "manual", label: "Kullanım kılavuzu", url: "https://gree.com.tr/kilavuz.pdf" };
const validWarranty = { classification: "VERIFIED_PRODUCT_SPECIFIC", displayText: "Bu ürün 2 yıl garantilidir.", pageValue: "2 yıl", conditions: null, sourceUrl: "https://gree.com.tr/garanti", generalTermsUrl: "https://gree.com.tr/genel-sartlar", retrievedAt: "2026-01-15" };

test("createProductSchema: the 6 new fields default to empty/neutral values when omitted", () => {
  const parsed = createProductSchema.parse(baseProduct);
  assert.equal(parsed.shortDescription, "");
  assert.equal(parsed.sourceUrl, "");
  assert.deepEqual(parsed.gallery, []);
  assert.deepEqual(parsed.specifications, {});
  assert.deepEqual(parsed.documents, []);
  assert.equal(parsed.manufacturerWarranty, null);
});

test("createProductSchema: accepts a fully populated, valid set of the 6 new fields", () => {
  const parsed = createProductSchema.parse({
    ...baseProduct,
    shortDescription: "Kısa özet",
    sourceUrl: "https://gree.com.tr/urun",
    gallery: [validGalleryItem],
    specifications: validSpecifications,
    documents: [validDocument],
    manufacturerWarranty: validWarranty,
  });
  assert.deepEqual(parsed.gallery, [validGalleryItem]);
  assert.deepEqual(parsed.specifications, validSpecifications);
  assert.deepEqual(parsed.documents, [validDocument]);
  assert.deepEqual(parsed.manufacturerWarranty, validWarranty);
});

test("createProductSchema: rejects a gallery item whose url is not an official GREE/TLC host", () => {
  const result = createProductSchema.safeParse({ ...baseProduct, gallery: [{ ...validGalleryItem, url: "https://example.com/gorsel.jpg" }] });
  assert.equal(result.success, false);
});

test("createProductSchema: rejects a specification key outside the SPEC_KEYS whitelist", () => {
  const result = createProductSchema.safeParse({ ...baseProduct, specifications: { not_a_real_spec_key: validSpecifications.wifi } });
  assert.equal(result.success, false);
});

test("createProductSchema: rejects a document with an unknown type", () => {
  const result = createProductSchema.safeParse({ ...baseProduct, documents: [{ ...validDocument, type: "brochure" }] });
  assert.equal(result.success, false);
});

test("createProductSchema: rejects a VERIFIED_PRODUCT_SPECIFIC warranty with no pageValue (matches product-enrichment.ts's rule)", () => {
  const result = createProductSchema.safeParse({ ...baseProduct, manufacturerWarranty: { ...validWarranty, pageValue: null } });
  assert.equal(result.success, false);
});

test("createProductSchema: rejects an unresolved warranty whose display text still carries a duration", () => {
  const result = createProductSchema.safeParse({
    ...baseProduct,
    manufacturerWarranty: { ...validWarranty, classification: "GENERAL_TERMS_ONLY", displayText: "2 yıl garantilidir.", pageValue: null },
  });
  assert.equal(result.success, false);
});

test("patchProductSchema: shortDescription/sourceUrl accept plain strings, unrestricted by the official-host rule", () => {
  const parsed = patchProductSchema.parse({ shortDescription: "Güncel özet", sourceUrl: "https://example.com/herhangi-bir-sayfa" });
  assert.equal(parsed.shortDescription, "Güncel özet");
  assert.equal(parsed.sourceUrl, "https://example.com/herhangi-bir-sayfa");
});

test("patchProductSchema: manufacturerWarranty can be explicitly cleared with null", () => {
  const parsed = patchProductSchema.parse({ manufacturerWarranty: null });
  assert.equal(parsed.manufacturerWarranty, null);
});

test("patchProductSchema: a partial update touching only one of the new fields still validates", () => {
  const parsed = patchProductSchema.parse({ documents: [validDocument] });
  assert.deepEqual(parsed.documents, [validDocument]);
});
