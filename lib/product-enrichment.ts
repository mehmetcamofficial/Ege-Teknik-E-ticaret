import { z } from "zod";

/**
 * Product enrichment (Phase 3): validated, customer-safe product data reviewed in Product Data Review
 * (see data/catalog-enrichment). Pure module: no I/O, so the importer plan, the SQL builder and the public
 * projections are all unit-testable.
 *
 * Trust model (fail closed): only records the review approved are importable; only fields the review marked
 * VERIFIED are ever shown to customers; the importer never writes a commercial or identity column.
 */

export const OFFICIAL_HOSTS = ["gree.com.tr", "www.gree.com.tr", "tlcklima.com", "www.tlcklima.com"] as const;
const officialHttps = z.string().max(600).refine((value) => {
  try { const url = new URL(value); return url.protocol === "https:" && (OFFICIAL_HOSTS as readonly string[]).includes(url.hostname); } catch { return false; }
}, "must be an https URL on an official GREE/TLC host");

// ---- import decisions (one per reviewed product) --------------------------------------------------------
export const importStatuses = ["READY_FOR_PREVIEW_IMPORT", "READY_WITH_LIMITED_SPECS", "BLOCKED_ASSET", "BLOCKED_CONFLICT", "BLOCKED_DATA_QUALITY"] as const;
export type ImportStatus = typeof importStatuses[number];
export const ELIGIBLE_STATUSES: readonly ImportStatus[] = ["READY_FOR_PREVIEW_IMPORT", "READY_WITH_LIMITED_SPECS"];
export const isEligible = (status: ImportStatus) => ELIGIBLE_STATUSES.includes(status);
export const decisionSchema = z.object({ productId: z.string().min(1), importStatus: z.enum(importStatuses), reasons: z.array(z.string().max(300)).max(6) });

// ---- stored JSON shapes ---------------------------------------------------------------------------------
export const galleryItemSchema = z.object({ url: officialHttps, alt: z.string().min(1).max(200), width: z.number().int().positive(), height: z.number().int().positive() }).strict();

export const SPEC_KEYS = [
  "capacity_btu", "product_type", "colour", "refrigerant", "power_supply",
  "cooling_capacity_btuh", "heating_capacity_btuh", "cooling_capacity_kw", "heating_capacity_kw",
  "power_input_cooling_w", "power_input_heating_w", "power_input_cooling_kw", "power_input_heating_kw", "operating_current",
  "energy_class", "energy_class_seer", "seer", "scop", "wifi", "multi_function_filter",
  "indoor_dimensions", "indoor_weight", "outdoor_dimensions", "outdoor_weight",
  "indoor_airflow", "outdoor_airflow", "indoor_sound_pressure", "outdoor_sound_pressure",
  "indoor_sound_db", "outdoor_sound_db", "operating_temperature_cooling", "operating_temperature_heating", "connectable_indoor_units",
] as const;
export const specEntrySchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(120),
  unit: z.string().max(20).nullable(),
  /** `verified` = shown to customers; `partial` = stored for review only, never shown. REVIEW_REQUIRED values are never stored. */
  status: z.enum(["verified", "partial"]),
  source: z.object({ kind: z.enum(["product_page", "catalog", "energy_label"]), url: officialHttps, page: z.number().int().positive().optional() }).strict(),
}).strict();
export const specificationsSchema = z.record(z.string(), specEntrySchema).refine((all) => Object.keys(all).every((key) => (SPEC_KEYS as readonly string[]).includes(key)), "unknown specification key");

export const documentTypes = ["catalog", "manual", "energy_label", "wifi_guide", "erp"] as const;
export const documentSchema = z.object({ type: z.enum(documentTypes), label: z.string().min(1).max(80), url: officialHttps }).strict();

export const warrantyClassifications = ["VERIFIED_PRODUCT_SPECIFIC", "GENERAL_TERMS_ONLY", "CONFLICT_REVIEW_REQUIRED"] as const;
const NEUTRAL_WARRANTY_TEXT = "Garanti bilgisi için Ege Teknik ile iletişime geçebilirsiniz.";
export const warrantySchema = z.object({
  classification: z.enum(warrantyClassifications),
  /** Customer-safe text. Unresolved warranties must never carry a duration. */
  displayText: z.string().min(1).max(400),
  /** Raw product-page value, kept internally; never shown for unresolved warranties. */
  pageValue: z.string().max(30).nullable(),
  conditions: z.string().max(300).nullable(),
  sourceUrl: officialHttps,
  generalTermsUrl: officialHttps,
  retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict().superRefine((w, ctx) => {
  const durationLike = /\d|yıl|yil|year/i.test(w.displayText);
  if (w.classification !== "VERIFIED_PRODUCT_SPECIFIC" && durationLike) ctx.addIssue({ code: "custom", message: "unresolved/general warranty text must not contain a duration" });
  if (w.classification === "VERIFIED_PRODUCT_SPECIFIC" && !w.pageValue) ctx.addIssue({ code: "custom", message: "verified warranty needs the product-page value" });
});
export { NEUTRAL_WARRANTY_TEXT };

export const enrichmentRecordSchema = z.object({
  productId: z.string().min(1),
  shortDescription: z.string().min(1).max(300),
  description: z.string().min(1).max(3000),
  sku: z.string().min(1).max(60),
  imageUrl: officialHttps,
  gallery: z.array(galleryItemSchema).min(1).max(12),
  specifications: specificationsSchema,
  documents: z.array(documentSchema).max(12),
  manufacturerWarranty: warrantySchema,
  sourceUrl: officialHttps,
  energyClass: z.string().max(30).nullable(),
  wifi: z.string().max(30).nullable(),
}).strict().refine((r) => r.gallery[0]?.url === r.imageUrl, { message: "primary image must be the first gallery entry" });
export type EnrichmentRecord = z.infer<typeof enrichmentRecordSchema>;

/** Columns of `products` as read for comparison: protected commercial/identity fields plus the fields the importer may fill. */
export const baselineRowSchema = z.object({
  id: z.string(), slug: z.string(), name: z.string(), price: z.number().int(), vatRateBps: z.number().int(), saleMode: z.string(), status: z.string(),
  sku: z.string(), description: z.string(), imageUrl: z.string(), energyClass: z.string(), wifi: z.string(),
  shortDescription: z.string().nullable().optional(), gallery: z.array(z.unknown()).optional(), specifications: z.record(z.string(), z.unknown()).optional(),
  documents: z.array(z.unknown()).optional(), manufacturerWarranty: z.unknown().nullable().optional(), sourceUrl: z.string().nullable().optional(),
}).strict();
export type ProductRow = z.infer<typeof baselineRowSchema>;

export const slugRedirectSchema = z.object({ oldId: z.string(), newSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) });
export const datasetSchema = z.object({
  version: z.literal(1),
  decisions: z.array(decisionSchema),
  records: z.record(z.string(), enrichmentRecordSchema),
  baseline: z.record(z.string(), baselineRowSchema),
  slugRedirects: z.array(slugRedirectSchema),
  /** Internal: official image URLs the review rejected (promotional artwork, low resolution, off-model). Never importable, never exposed. */
  excludedImageUrls: z.array(officialHttps),
}).strict();
export type EnrichmentDataset = z.infer<typeof datasetSchema>;

// ---- import planning (pure) -----------------------------------------------------------------------------
export const PROTECTED_FIELDS = ["id", "slug", "price", "vatRateBps", "saleMode", "status"] as const;
/** Columns the importer may write, mapped to their SQL names. Anything else can never appear in an UPDATE. */
export const WRITABLE_COLUMNS = {
  shortDescription: "short_description", description: "description", sku: "sku", imageUrl: "image_url", energyClass: "energy_class", wifi: "wifi",
  gallery: "gallery", specifications: "specifications", documents: "documents", manufacturerWarranty: "manufacturer_warranty", sourceUrl: "source_url",
} as const;
type WritableField = keyof typeof WRITABLE_COLUMNS;
const JSON_FIELDS: readonly WritableField[] = ["gallery", "specifications", "documents", "manufacturerWarranty"];
const FILL_IF_EMPTY: readonly WritableField[] = ["sku", "imageUrl", "energyClass", "wifi"];

export type PlanEntry =
  | { productId: string; action: "skipped-blocked"; importStatus: ImportStatus; reasons: string[] }
  | { productId: string; action: "fail-missing-product" }
  | { productId: string; action: "fail-protected-drift"; fields: string[] }
  | { productId: string; action: "fail-content-drift"; fields: string[] }
  | { productId: string; action: "noop" | "update"; changes: WritableField[]; record: EnrichmentRecord; expected: Pick<ProductRow, "price" | "vatRateBps" | "saleMode" | "status"> };

// canonical form: jsonb does not preserve object key order, so compare with sorted keys (array order stays significant)
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, canonical(v)])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const isEmptyValue = (value: unknown) => value == null || value === "" || (Array.isArray(value) && value.length === 0) || (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0);
const currentOf = (row: ProductRow, field: WritableField): unknown => (row as Record<string, unknown>)[field];

/**
 * Decides, per reviewed product, what the importer may do. Never reads or writes price/VAT/sale mode/status/id/slug/inventory:
 * those are only compared. Any unexpected difference fails closed for that product; nothing is silently overwritten.
 */
export function planEnrichment(dataset: EnrichmentDataset, current: ReadonlyMap<string, ProductRow>): PlanEntry[] {
  return dataset.decisions.map((decision): PlanEntry => {
    const id = decision.productId;
    if (!isEligible(decision.importStatus)) return { productId: id, action: "skipped-blocked", importStatus: decision.importStatus, reasons: decision.reasons };
    const record = dataset.records[id], base = dataset.baseline[id], row = current.get(id);
    if (!record || !base || !row) return { productId: id, action: "fail-missing-product" };
    const drift = PROTECTED_FIELDS.filter((field) => !same(row[field], base[field]));
    if (drift.length) return { productId: id, action: "fail-protected-drift", fields: [...drift] };
    const conflicts: string[] = [], changes: WritableField[] = [];
    for (const field of Object.keys(WRITABLE_COLUMNS) as WritableField[]) {
      const target = (record as Record<string, unknown>)[field];
      const value = currentOf(row, field);
      if (isEmptyValue(target) || same(value, target)) continue; // nothing to write (no energy class, no specs, no documents) or already applied
      const allowed =
        field === "description" ? value === base.description :
        FILL_IF_EMPTY.includes(field) || JSON_FIELDS.includes(field) || field === "shortDescription" || field === "sourceUrl" ? isEmptyValue(value) :
        false;
      if (allowed) changes.push(field); else conflicts.push(field);
    }
    if (conflicts.length) return { productId: id, action: "fail-content-drift", fields: conflicts };
    return { productId: id, action: changes.length ? "update" : "noop", changes, record, expected: { price: row.price, vatRateBps: row.vatRateBps, saleMode: row.saleMode, status: row.status } };
  });
}

/**
 * One UPDATE per product. Only whitelisted enrichment columns are SET; the protected values are repeated in the WHERE clause,
 * so a concurrent change to price/VAT/sale mode/status makes the statement match zero rows (fail closed) instead of overwriting.
 */
export type ApplicableEntry = Extract<PlanEntry, { action: "noop" | "update" }>;
export function buildUpdate(entry: ApplicableEntry): { text: string; values: unknown[] } {
  if (entry.action !== "update" || !entry.changes.length) throw new Error("buildUpdate requires an entry with changes");
  const values: unknown[] = [entry.productId, entry.expected.price, entry.expected.vatRateBps, entry.expected.saleMode, entry.expected.status];
  const sets = entry.changes.map((field) => {
    values.push(JSON_FIELDS.includes(field) ? JSON.stringify((entry.record as Record<string, unknown>)[field]) : (entry.record as Record<string, unknown>)[field]);
    return `${WRITABLE_COLUMNS[field]} = $${values.length}${JSON_FIELDS.includes(field) ? "::jsonb" : ""}`;
  });
  return { text: `UPDATE products SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND price = $2 AND vat_rate_bps = $3 AND sale_mode = $4 AND status = $5`, values };
}

// ---- dry-run summary ------------------------------------------------------------------------------------
export function summarizePlan(dataset: EnrichmentDataset, plan: readonly PlanEntry[]) {
  const updates = plan.filter((e): e is ApplicableEntry => e.action === "update" || e.action === "noop");
  const set = (field: WritableField) => updates.filter((e) => e.changes.includes(field)).length;
  const count = (status: ImportStatus) => dataset.decisions.filter((d) => d.importStatus === status).length;
  return {
    TOTAL_REVIEWED: dataset.decisions.length,
    ELIGIBLE_FOR_IMPORT: dataset.decisions.filter((d) => isEligible(d.importStatus)).length,
    READY_FOR_PREVIEW_IMPORT: count("READY_FOR_PREVIEW_IMPORT"), READY_WITH_LIMITED_SPECS: count("READY_WITH_LIMITED_SPECS"),
    BLOCKED_ASSET: count("BLOCKED_ASSET"), BLOCKED_CONFLICT: count("BLOCKED_CONFLICT"), BLOCKED_DATA_QUALITY: count("BLOCKED_DATA_QUALITY"),
    FAILED_CLOSED: plan.filter((e) => e.action.startsWith("fail-")).length,
    PRIMARY_IMAGES_TO_SET: set("imageUrl"), GALLERIES_TO_SET: set("gallery"), DESCRIPTIONS_TO_SET: set("description"), SHORT_DESCRIPTIONS_TO_SET: set("shortDescription"),
    MODEL_CODES_TO_SET: set("sku"), SPECIFICATIONS_TO_SET: set("specifications"), DOCUMENTS_TO_SET: set("documents"), WARRANTY_RECORDS_TO_SET: set("manufacturerWarranty"),
    SOURCE_URLS_TO_SET: set("sourceUrl"), ENERGY_CLASSES_TO_SET: set("energyClass"), WIFI_VALUES_TO_SET: set("wifi"),
    // The importer has no code path that writes these; they are asserted from the plan (never from a write).
    PRICE_CHANGES: 0, VAT_CHANGES: 0, INVENTORY_CHANGES: 0, SALE_MODE_CHANGES: 0, PUBLISH_STATE_CHANGES: 0, PRODUCT_ID_CHANGES: 0,
  };
}

// ---- customer-facing projections (allow-lists, never spreads) --------------------------------------------
export type CatalogRow = ProductRow & { brandId?: string | null; categoryId?: string | null; category: string; series: string; capacity: string; vatRateBps: number; createdAt?: unknown; updatedAt?: unknown };

/** Catalog list item: everything the storefront list already used, minus the heavy/internal enrichment columns. */
export function toCatalogListItem<T extends Record<string, unknown>>(product: T, stock: number | null): Omit<T, "gallery" | "specifications" | "documents" | "manufacturerWarranty" | "sourceUrl"> & { stock: number } {
  const rest: Record<string, unknown> = { ...product };
  for (const key of ["gallery", "specifications", "documents", "manufacturerWarranty", "sourceUrl"]) delete rest[key];
  if (typeof rest.description === "string") rest.description = sanitizePublicDescription(rest.description);
  return { ...rest, stock: stock ?? 0 } as Omit<T, "gallery" | "specifications" | "documents" | "manufacturerWarranty" | "sourceUrl"> & { stock: number };
}

const SPEC_ORDER = SPEC_KEYS as readonly string[];
export function toPublicSpecifications(specifications: unknown) {
  const parsed = specificationsSchema.safeParse(specifications);
  if (!parsed.success) return [];
  return Object.entries(parsed.data).filter(([, entry]) => entry.status === "verified")
    .sort(([a], [b]) => SPEC_ORDER.indexOf(a) - SPEC_ORDER.indexOf(b))
    .map(([key, entry]) => ({ key, label: entry.label, value: entry.value, unit: entry.unit }));
}
export function toPublicDocuments(documents: unknown) {
  const parsed = z.array(documentSchema).safeParse(documents);
  return parsed.success ? parsed.data.map(({ type, label, url }) => ({ type, label, url })) : [];
}
export function toPublicGallery(gallery: unknown) {
  const parsed = z.array(galleryItemSchema).safeParse(gallery);
  return parsed.success ? parsed.data.map(({ url, alt, width, height }) => ({ url, alt, width, height })) : [];
}
/** Safe warranty presentation. Unresolved warranties expose only neutral text; the raw page value stays internal. */
export function toPublicWarranty(warranty: unknown) {
  const parsed = warrantySchema.safeParse(warranty);
  if (!parsed.success) return null;
  const w = parsed.data;
  if (w.classification === "VERIFIED_PRODUCT_SPECIFIC") return { kind: "product", text: w.displayText, conditions: w.conditions };
  return { kind: w.classification === "GENERAL_TERMS_ONLY" ? "general" : "contact", text: NEUTRAL_WARRANTY_TEXT, conditions: null };
}

/**
 * Legacy blocked records can contain a customer-facing official-source footer. Keep the
 * surrounding prose intact while removing only a standalone GREE source line. The stored
 * record is deliberately left untouched; this is a public-presentation boundary.
 */
export function sanitizePublicDescription(description: unknown): string {
  return String(description ?? "")
    .replace(/\s*Kaynak:\s*https?:\/\/(?:www\.)?gree\.com\.tr(?:\/\S*)?\s*$/i, "")
    .trim();
}

export function toPublicProductDetail(product: Record<string, unknown> & { id: string }, stock: number | null) {
  const pick = (key: string) => product[key];
  return {
    id: product.id, slug: pick("slug"), name: pick("name"), category: pick("category"), series: pick("series"), sku: pick("sku"), capacity: pick("capacity"),
    energyClass: pick("energyClass"), wifi: pick("wifi"), price: pick("price"), vatRateBps: pick("vatRateBps"), saleMode: pick("saleMode"), stock: stock ?? 0,
    imageUrl: pick("imageUrl"), shortDescription: pick("shortDescription") ?? null, description: sanitizePublicDescription(pick("description")),
    gallery: toPublicGallery(pick("gallery")), specifications: toPublicSpecifications(pick("specifications")),
    documents: toPublicDocuments(pick("documents")), warranty: toPublicWarranty(pick("manufacturerWarranty")),
  };
}
