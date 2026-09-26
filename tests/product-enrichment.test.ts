import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildUpdate, datasetSchema, documentSchema, enrichmentRecordSchema, galleryItemSchema, planEnrichment, PROTECTED_FIELDS, sanitizePublicDescription, specificationsSchema, summarizePlan,
  toCatalogListItem, toPublicProductDetail, toPublicSpecifications, toPublicWarranty, warrantySchema, WRITABLE_COLUMNS, type EnrichmentDataset, type PlanEntry, type ProductRow,
} from "../lib/product-enrichment.ts";
import { PRODUCT_SLUG_REDIRECTS, resolveProductIdentifier } from "../lib/product-slugs.ts";

const dataset: EnrichmentDataset = datasetSchema.parse(JSON.parse(readFileSync("data/catalog-enrichment/catalog-enrichment.v1.json", "utf8")));
const eligible = dataset.decisions.filter((d) => d.importStatus.startsWith("READY_"));
const blocked = dataset.decisions.filter((d) => d.importStatus.startsWith("BLOCKED_"));
const rows = () => new Map<string, ProductRow>(Object.entries(dataset.baseline).map(([id, row]) => [id, structuredClone(row)]));
const applicable = (plan: PlanEntry[]) => plan.filter((e): e is Extract<PlanEntry, { action: "update" | "noop" }> => e.action === "update" || e.action === "noop");
const oneEligible = () => eligible.find((d) => dataset.records[d.productId].specifications && Object.keys(dataset.records[d.productId].specifications).length > 3)!.productId;

// ---- review decisions ----------------------------------------------------------------------------------
test("87 review decisions with unique product ids: 78 eligible, 9 blocked", () => {
  assert.equal(dataset.decisions.length, 87);
  assert.equal(new Set(dataset.decisions.map((d) => d.productId)).size, 87);
  assert.equal(eligible.length, 78);
  assert.equal(blocked.length, 9);
  const by = (status: string) => dataset.decisions.filter((d) => d.importStatus === status).length;
  assert.deepEqual([by("READY_FOR_PREVIEW_IMPORT"), by("READY_WITH_LIMITED_SPECS"), by("BLOCKED_ASSET"), by("BLOCKED_CONFLICT")], [43, 35, 8, 1]);
});
test("blocked products are explicit: 8 asset blocks and the Pular conflict, each with a reason", () => {
  for (const d of blocked) assert.ok(d.reasons.length > 0, d.productId);
  assert.deepEqual(dataset.decisions.filter((d) => d.importStatus === "BLOCKED_CONFLICT").map((d) => d.productId), ["multi-duvar-tipi-pular-ic-unite-9000-btu-h"]);
});
test("enrichment records exist exactly for the eligible products: no orphans, none for blocked products", () => {
  assert.deepEqual(Object.keys(dataset.records).sort(), eligible.map((d) => d.productId).sort());
  for (const d of blocked) assert.equal(d.productId in dataset.records, false, d.productId);
  assert.equal(Object.keys(dataset.baseline).length, 87);
  for (const [id, record] of Object.entries(dataset.records)) assert.equal(record.productId, id);
});

// ---- importer plan --------------------------------------------------------------------------------------
test("plan against the reviewed baseline: 78 candidates update, 9 blocked are skipped, nothing fails", () => {
  const plan = planEnrichment(dataset, rows());
  assert.equal(applicable(plan).length, 78);
  assert.equal(plan.filter((e) => e.action === "skipped-blocked").length, 9);
  assert.equal(plan.filter((e) => e.action.startsWith("fail-")).length, 0);
});
test("blocked asset and blocked conflict products can never be imported, even if a record is injected for them", () => {
  const forged = structuredClone(dataset);
  for (const d of blocked) forged.records[d.productId] = structuredClone(dataset.records[oneEligible()]);
  const plan = planEnrichment(forged, rows());
  for (const d of blocked) assert.equal(plan.find((e) => e.productId === d.productId)!.action, "skipped-blocked", d.productId);
  assert.equal(applicable(plan).length, 78);
});
test("the importer is idempotent: after applying the plan, a second run changes nothing", () => {
  const current = rows();
  const first = planEnrichment(dataset, current);
  for (const entry of applicable(first)) { const row = current.get(entry.productId) as Record<string, unknown>; for (const field of entry.changes) row[field] = structuredClone((entry.record as Record<string, unknown>)[field]); }
  const second = planEnrichment(dataset, current);
  assert.equal(second.filter((e) => e.action === "update").length, 0);
  assert.equal(applicable(second).length, 78);
  assert.equal(summarizePlan(dataset, second).SPECIFICATIONS_TO_SET, 0);
});
test("a product missing from the database fails closed and is never created", () => {
  const current = rows(); const id = oneEligible(); current.delete(id);
  const entry = planEnrichment(dataset, current).find((e) => e.productId === id)!;
  assert.equal(entry.action, "fail-missing-product");
});
test("drift in any protected field (price, VAT, sale mode, publish state, slug, id) fails closed", () => {
  const id = oneEligible();
  const mutate: Record<string, (row: ProductRow) => void> = { price: (r) => { r.price += 1; }, vatRateBps: (r) => { r.vatRateBps = 1000; }, saleMode: (r) => { r.saleMode = "quote"; }, status: (r) => { r.status = "draft"; }, slug: (r) => { r.slug += "-x"; }, id: (r) => { r.id += "-x"; } };
  assert.deepEqual(Object.keys(mutate).sort(), [...PROTECTED_FIELDS].sort());
  for (const [field, change] of Object.entries(mutate)) {
    const current = rows(); change(current.get(id)!);
    const entry = planEnrichment(dataset, current).find((e) => e.productId === id)!;
    assert.equal(entry.action, "fail-protected-drift", field);
    assert.ok(entry.action === "fail-protected-drift" && entry.fields.includes(field), field);
  }
});
test("edited or conflicting content is never silently overwritten (description, model code, image, existing enrichment)", () => {
  const id = oneEligible(); const record = dataset.records[id];
  const cases: [string, (row: ProductRow) => void][] = [
    ["description", (r) => { r.description = "elle düzenlenmiş açıklama"; }],
    ["sku", (r) => { r.sku = "BASKA-MODEL"; }],
    ["imageUrl", (r) => { r.imageUrl = "https://www.gree.com.tr/baska.png"; }],
    ["gallery", (r) => { r.gallery = [{ url: "https://www.gree.com.tr/x.png" }]; }],
    ["specifications", (r) => { r.specifications = { capacity_btu: { value: "1" } }; }],
  ];
  for (const [field, change] of cases) {
    const current = rows(); change(current.get(id)!);
    const entry = planEnrichment(dataset, current).find((e) => e.productId === id)!;
    assert.equal(entry.action, "fail-content-drift", field);
    assert.ok(entry.action === "fail-content-drift" && entry.fields.includes(field), field);
  }
  assert.ok(record);
});

// ---- commercial / identity / inventory safety -----------------------------------------------------------
test("price, VAT, inventory, sale mode, publish state, id and slug are not writable columns", () => {
  const writable = Object.values(WRITABLE_COLUMNS) as string[];
  for (const forbidden of ["id", "slug", "price", "vat_rate_bps", "sale_mode", "status", "name", "brand_id", "category_id", "category", "series", "capacity", "created_at"]) assert.equal(writable.includes(forbidden), false, forbidden);
  assert.equal(Object.keys(WRITABLE_COLUMNS).some((k) => (PROTECTED_FIELDS as readonly string[]).includes(k)), false);
});
test("every generated UPDATE sets only whitelisted columns, guards the protected values in WHERE, and never touches inventory", () => {
  const plan = applicable(planEnrichment(dataset, rows())).filter((e) => e.action === "update");
  assert.equal(plan.length, 78);
  const allowed = new Set([...(Object.values(WRITABLE_COLUMNS) as string[]), "updated_at"]);
  for (const entry of plan) {
    const { text, values } = buildUpdate(entry);
    assert.match(text, /^UPDATE products SET /);
    const [setPart, wherePart] = text.slice("UPDATE products SET ".length).split(" WHERE ");
    const columns = setPart.split(", ").map((assignment) => assignment.split(" = ")[0]);
    for (const column of columns) assert.ok(allowed.has(column), `${entry.productId}: ${column}`);
    assert.equal(wherePart, "id = $1 AND price = $2 AND vat_rate_bps = $3 AND sale_mode = $4 AND status = $5");
    assert.equal(values[0], entry.productId);
    assert.doesNotMatch(text, /inventory|INSERT|DELETE|DROP|TRUNCATE/i);
  }
});
test("dry-run summary: 78 candidates, protected commercial fields report zero changes", () => {
  const s = summarizePlan(dataset, planEnrichment(dataset, rows()));
  assert.deepEqual([s.TOTAL_REVIEWED, s.ELIGIBLE_FOR_IMPORT, s.BLOCKED_ASSET, s.BLOCKED_CONFLICT, s.FAILED_CLOSED], [87, 78, 8, 1, 0]);
  assert.deepEqual([s.PRICE_CHANGES, s.VAT_CHANGES, s.INVENTORY_CHANGES, s.SALE_MODE_CHANGES, s.PUBLISH_STATE_CHANGES, s.PRODUCT_ID_CHANGES], [0, 0, 0, 0, 0, 0]);
  assert.equal(s.PRIMARY_IMAGES_TO_SET, 78); assert.equal(s.GALLERIES_TO_SET, 78); assert.equal(s.DESCRIPTIONS_TO_SET, 78); assert.equal(s.WARRANTY_RECORDS_TO_SET, 78);
  assert.equal(s.SPECIFICATIONS_TO_SET, Object.values(dataset.records).filter((r) => Object.keys(r.specifications).length).length);
  assert.equal(s.DOCUMENTS_TO_SET, Object.values(dataset.records).filter((r) => r.documents.length).length);
});
test("the importer script is dry-run by default, Preview-guarded when applying, and has no create/delete path", () => {
  const src = readFileSync("scripts/import-product-enrichment.mjs", "utf8");
  assert.match(src, /apply = args\.includes\("--apply"\)/);
  assert.match(src, /target !== "preview" \|\| branch !== expected/);
  assert.match(src, /Refusing to run against the Production branch/);
  assert.match(src, /ENRICHMENT_IMPORT_CONFIRM !== "I_UNDERSTAND_PREVIEW_ONLY"/);
  assert.match(src, /Migration 0007 .* is not applied/);
  assert.doesNotMatch(src, /INSERT INTO|DELETE FROM|DROP |TRUNCATE|UPDATE inventory|UPDATE orders/i);
});

// ---- images ---------------------------------------------------------------------------------------------
test("only approved images: primary is gallery[0], every image is a clean, official, >=800 px asset, none excluded by the review", () => {
  const excluded = new Set(dataset.excludedImageUrls);
  assert.ok(excluded.size > 0);
  for (const record of Object.values(dataset.records)) {
    assert.equal(record.gallery[0].url, record.imageUrl);
    for (const image of record.gallery) { assert.equal(excluded.has(image.url), false, image.url); assert.ok(Math.max(image.width, image.height) >= 800, image.url); }
  }
});
test("no product is imported with a promotional/warranty-badge primary, and no blocked-asset product is imported as ready", () => {
  const excluded = new Set(dataset.excludedImageUrls);
  for (const record of Object.values(dataset.records)) assert.equal(excluded.has(record.imageUrl), false, record.productId);
  for (const d of dataset.decisions.filter((x) => x.importStatus === "BLOCKED_ASSET")) assert.equal(d.productId in dataset.records, false);
});

// ---- warranty / specifications / documents visibility ----------------------------------------------------
test("unresolved warranty never becomes a fixed-duration promise", () => {
  const conflict = { classification: "CONFLICT_REVIEW_REQUIRED", displayText: "6 yıl garanti", pageValue: "6 Yıl", conditions: null, sourceUrl: "https://www.gree.com.tr/urun/x", generalTermsUrl: "https://www.gree.com.tr/sayfa/garanti-sartlari", retrievedAt: "2026-09-24" };
  assert.equal(warrantySchema.safeParse(conflict).success, false);
  assert.equal(warrantySchema.safeParse({ ...conflict, classification: "GENERAL_TERMS_ONLY" }).success, false);
  assert.equal(warrantySchema.safeParse({ ...conflict, displayText: "Garanti bilgisi için Ege Teknik ile iletişime geçebilirsiniz." }).success, true);
  for (const record of Object.values(dataset.records)) {
    const w = record.manufacturerWarranty;
    if (w.classification !== "VERIFIED_PRODUCT_SPECIFIC") assert.doesNotMatch(w.displayText, /\d|yıl|yil/i, record.productId);
    const pub = toPublicWarranty(w)!;
    if (w.classification !== "VERIFIED_PRODUCT_SPECIFIC") assert.equal(JSON.stringify(pub).includes(String(w.pageValue ?? "\u0000")), false);
  }
  const kinds = new Set(Object.values(dataset.records).map((r) => r.manufacturerWarranty.classification));
  assert.deepEqual([...kinds].sort(), ["CONFLICT_REVIEW_REQUIRED", "GENERAL_TERMS_ONLY", "VERIFIED_PRODUCT_SPECIFIC"]);
});
test("REVIEW_REQUIRED specification values cannot be stored or shown; partial values are stored but hidden", () => {
  const entry = { label: "Kapasite", value: "12000", unit: "BTU/h", status: "verified", source: { kind: "product_page", url: "https://www.gree.com.tr/urun/x" } };
  assert.equal(specificationsSchema.safeParse({ capacity_btu: entry }).success, true);
  assert.equal(specificationsSchema.safeParse({ capacity_btu: { ...entry, status: "review_required" } }).success, false);
  assert.equal(specificationsSchema.safeParse({ REJECTED_power_input_cooling: entry }).success, false, "unknown/rejected keys are refused");
  const shown = toPublicSpecifications({ capacity_btu: entry, indoor_dimensions: { ...entry, label: "Ölçü", value: "907×292×200", unit: null, status: "partial" } });
  assert.deepEqual(shown.map((s) => s.key), ["capacity_btu"]);
  for (const record of Object.values(dataset.records)) for (const e of Object.values(record.specifications)) assert.ok(["verified", "partial"].includes(e.status));
});
test("only approved documents are stored: no review-only interactive pages or system-configuration labels", () => {
  assert.equal(documentSchema.safeParse({ type: "catalog", label: "x", url: "https://evil.example/x.pdf" }).success, false);
  let count = 0;
  for (const record of Object.values(dataset.records)) for (const d of record.documents) {
    count++; assert.doesNotMatch(d.url, /interaktif-kumanda/); assert.doesNotMatch(d.url, /multi(18|24|28|36)\.png/);
  }
  assert.ok(count > 0);
});

// ---- payload validation ---------------------------------------------------------------------------------
test("JSON payload validation rejects malformed enrichment records", () => {
  const good = structuredClone(dataset.records[oneEligible()]);
  assert.equal(enrichmentRecordSchema.safeParse(good).success, true);
  const bad = (patch: Record<string, unknown>) => enrichmentRecordSchema.safeParse({ ...good, ...patch }).success;
  assert.equal(bad({ imageUrl: "http://www.gree.com.tr/a.png" }), false, "http");
  assert.equal(bad({ sourceUrl: "https://evil.example/urun" }), false, "foreign host");
  assert.equal(bad({ gallery: [] }), false, "empty gallery");
  assert.equal(bad({ imageUrl: good.gallery.length > 1 ? good.gallery[1].url : "https://www.gree.com.tr/other.png" }), false, "primary must be gallery[0]");
  assert.equal(bad({ description: "x".repeat(3001) }), false, "oversize");
  assert.equal(bad({ extra: 1 }), false, "unknown key");
  assert.equal(bad({ manufacturerWarranty: { ...good.manufacturerWarranty, retrievedAt: "yesterday" } }), false, "date");
  assert.equal(galleryItemSchema.safeParse({ url: "https://www.gree.com.tr/a.png", alt: "", width: 10, height: 10 }).success, false);
});

// ---- public API exposure --------------------------------------------------------------------------------
test("the catalog list never carries enrichment columns or the source URL", () => {
  const item = toCatalogListItem({ id: "p", name: "n", price: 1, gallery: [1], specifications: { a: 1 }, documents: [1], manufacturerWarranty: { x: 1 }, sourceUrl: "https://www.gree.com.tr/urun/p", shortDescription: "kısa" }, 3);
  for (const key of ["gallery", "specifications", "documents", "manufacturerWarranty", "sourceUrl"]) assert.equal(key in item, false, key);
  assert.equal(item.stock, 3); assert.equal(item.shortDescription, "kısa");
  const route = readFileSync("app/api/products/route.ts", "utf8");
  assert.match(route, /toCatalogListItem\(product, stock\)/);
  assert.doesNotMatch(route, /\.\.\.product/);
});
test("the public detail exposes only approved display data: no confidence, partial values, raw warranty, source URL or review metadata", () => {
  const id = oneEligible(); const record = dataset.records[id]; const base = dataset.baseline[id];
  const row = { ...base, description: record.description, gallery: record.gallery, specifications: record.specifications, documents: record.documents, manufacturerWarranty: record.manufacturerWarranty, sourceUrl: record.sourceUrl, shortDescription: record.shortDescription, category: "c", series: "s", capacity: "x", reviewerNotes: "internal", reviewFlags: ["x"], createdAt: "t" };
  const detail = toPublicProductDetail({ ...row, deliveryClass: "installed_delivery" }, 5); // deliveryClass (Phase 3.4) is the one deliberately added, non-secret field
  assert.deepEqual(Object.keys(detail).sort(), ["capacity", "category", "deliveryClass", "description", "documents", "energyClass", "gallery", "id", "imageUrl", "name", "price", "saleMode", "series", "shortDescription", "sku", "slug", "specifications", "stock", "vatRateBps", "warranty", "wifi"]);
  const json = JSON.stringify(detail);
  for (const leak of ["confidence", "\"status\"", "sourceUrl", "pageValue", "retrievedAt", "generalTermsUrl", "reviewerNotes", "reviewFlags", "manufacturerWarranty", "\"source\"", record.sourceUrl]) assert.equal(json.includes(leak), false, leak);
  for (const spec of detail.specifications) assert.deepEqual(Object.keys(spec).sort(), ["key", "label", "unit", "value"]);
  const partial = Object.entries(record.specifications).filter(([, e]) => e.status === "partial").map(([k]) => k);
  for (const k of partial) assert.equal(detail.specifications.some((s) => s.key === k), false, k);
  const routeSrc = readFileSync("app/api/products/[id]/route.ts", "utf8");
  assert.match(routeSrc, /eq\(products\.status, "published"\)/);
  assert.match(routeSrc, /toPublicProductDetail\(row\.product, row\.stock\)/);
  assert.doesNotMatch(routeSrc, /export async function (POST|PUT|PATCH|DELETE)/);
});
test("the new descriptions carry no source URL, installation, free-shipping or fixed-warranty wording (the old boilerplate did)", () => {
  for (const record of Object.values(dataset.records)) for (const text of [record.description, record.shortDescription]) assert.doesNotMatch(text, /Kaynak:|https?:\/\/|montaj|ücretsiz|kargo|garanti|yıl|kurulum/i, record.productId);
  assert.ok(Object.values(dataset.baseline).some((b) => /Kaynak: https:/.test(b.description)), "baseline confirms the old boilerplate exposed the source URL");
});
test("the public detail shows a safe warranty presentation only", () => {
  for (const record of Object.values(dataset.records)) {
    const w = toPublicWarranty(record.manufacturerWarranty)!;
    assert.deepEqual(Object.keys(w).sort(), ["conditions", "kind", "text"]);
    assert.ok(["product", "general", "contact"].includes(w.kind));
    if (w.kind !== "product") {
      assert.equal(w.conditions, null);
      assert.doesNotMatch(w.text, /\d|yıl|yil|year/i);
    }
  }
});
test("legacy GREE source footers are removed at presentation time without deleting surrounding prose", () => {
  const prose = "İlk paragraf.\n\nİkinci paragraf.\nKaynak: https://www.gree.com.tr/urun/ornek";
  assert.equal(sanitizePublicDescription(prose), "İlk paragraf.\n\nİkinci paragraf.");
  assert.equal(sanitizePublicDescription("Kaynak bilgisi metnin içindedir."), "Kaynak bilgisi metnin içindedir.");
  assert.equal(sanitizePublicDescription("Kaynak: https://example.com/x"), "Kaynak: https://example.com/x");
});

// ---- slug plan ------------------------------------------------------------------------------------------
test("12 required slug redirects: matches the reviewed proposal, zero collisions, ids untouched", () => {
  assert.equal(dataset.slugRedirects.length, 12);
  assert.deepEqual(Object.fromEntries(dataset.slugRedirects.map((r) => [r.oldId, r.newSlug])), PRODUCT_SLUG_REDIRECTS);
  const ids = new Set(Object.keys(dataset.baseline));
  const slugs = Object.values(PRODUCT_SLUG_REDIRECTS);
  assert.equal(new Set(slugs).size, 12);
  for (const [oldId, newSlug] of Object.entries(PRODUCT_SLUG_REDIRECTS)) { assert.ok(ids.has(oldId), oldId); assert.equal(ids.has(newSlug), false, `${newSlug} collides with an existing id`); assert.doesNotMatch(newSlug, /montaj/); }
});
test("every old identifier and every new slug resolves to exactly one product; ids always win", () => {
  const ids = new Set(Object.keys(dataset.baseline));
  for (const [oldId, newSlug] of Object.entries(PRODUCT_SLUG_REDIRECTS)) {
    const byId = resolveProductIdentifier(oldId, ids); const bySlug = resolveProductIdentifier(newSlug, ids);
    assert.deepEqual([byId.status, bySlug.status], ["product", "product"]);
    assert.ok(byId.status === "product" && byId.productId === oldId && !byId.viaAlias);
    assert.ok(bySlug.status === "product" && bySlug.productId === oldId && bySlug.viaAlias);
  }
  for (const id of ids) { const r = resolveProductIdentifier(id, ids); assert.ok(r.status === "product" && r.productId === id); }
  assert.equal(resolveProductIdentifier("bilinmeyen-urun", ids).status, "not-found");
  // an alias can never shadow an existing id
  const shadow = resolveProductIdentifier("aphro-18000-btu", new Set([...ids, "aphro-18000-btu"]));
  assert.ok(shadow.status === "product" && shadow.productId === "aphro-18000-btu" && !shadow.viaAlias);
});
test("slug support is not wired into any route, changes no id or slug column, and applies no redirect yet", () => {
  assert.doesNotMatch(readFileSync("next.config.ts", "utf8"), /aphro-18000-btu|fairy-9000-btu/);
  assert.equal((WRITABLE_COLUMNS as Record<string, string>).slug, undefined);
  for (const file of ["app/api/products/route.ts", "app/api/products/[id]/route.ts", "app/api/orders/route.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /product-slugs|PRODUCT_SLUG_REDIRECTS/, file);
  // carts and orders keep referencing the immutable id: the cart stores productId and the order route reads products by id
  assert.match(readFileSync("public/store.js", "utf8"), /productId/);
});

test("idempotency survives jsonb key reordering (Postgres does not preserve object key order)", () => {
  const current = rows();
  const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as object).reverse().map(([k, x]) => [k, reorder(x)])) : v;
  for (const entry of applicable(planEnrichment(dataset, current))) { const row = current.get(entry.productId) as Record<string, unknown>; for (const field of entry.changes) row[field] = reorder((entry.record as Record<string, unknown>)[field]); }
  const second = planEnrichment(dataset, current);
  assert.equal(second.filter((e) => e.action.startsWith("fail-")).length, 0);
  assert.equal(second.filter((e) => e.action === "update").length, 0);
});

test("canonical JSON comparison ignores only key order: changed primitives, arrays, missing keys and extra keys still fail closed", () => {
  const id = oneEligible();
  const applied = () => { const current = rows(); for (const entry of applicable(planEnrichment(dataset, current)).filter((e) => e.productId === id)) { const row = current.get(id) as Record<string, unknown>; for (const field of entry.changes) row[field] = structuredClone((entry.record as Record<string, unknown>)[field]); } return current; };
  const outcome = (mutate: (row: Record<string, unknown>) => void) => { const current = applied(); mutate(current.get(id) as unknown as Record<string, unknown>); return planEnrichment(dataset, current).find((e) => e.productId === id)!; };
  const firstSpec = (row: Record<string, unknown>) => { const specs = row.specifications as Record<string, Record<string, unknown>>; return specs[Object.keys(specs)[0]]; };
  assert.equal(outcome(() => {}).action, "noop");
  assert.equal(outcome((row) => { row.specifications = Object.fromEntries(Object.entries(row.specifications as object).reverse()); firstSpec(row); }).action, "noop", "key order is not drift");
  assert.equal(outcome((row) => { firstSpec(row).value = "999999"; }).action, "fail-content-drift", "different primitive");
  assert.equal(outcome((row) => { firstSpec(row).status = firstSpec(row).status === "verified" ? "partial" : "verified"; }).action, "fail-content-drift", "different status primitive");
  assert.equal(outcome((row) => { (row.gallery as unknown[]).pop(); }).action, "fail-content-drift", "shorter array");
  assert.equal(outcome((row) => { (row.gallery as unknown[]).push((row.gallery as unknown[])[0]); }).action, "fail-content-drift", "longer array");
  assert.equal(outcome((row) => { row.gallery = [{ url: "https://www.gree.com.tr/x.png", alt: "x", width: 1, height: 1 }]; }).action, "fail-content-drift", "different array contents");
  assert.equal(outcome((row) => { delete (firstSpec(row) as Record<string, unknown>).source; }).action, "fail-content-drift", "missing key");
  assert.equal(outcome((row) => { firstSpec(row).extra = "x"; }).action, "fail-content-drift", "extra key");
  assert.equal(outcome((row) => { (row.manufacturerWarranty as Record<string, unknown>).extra = 1; }).action, "fail-content-drift", "extra key in warranty");
});
