// Product enrichment importer (Phase 3).
//   node scripts/import-product-enrichment.mjs                 -> DRY RUN (default): offline, compares against the reviewed baseline snapshot, writes NOTHING.
//   node scripts/import-product-enrichment.mjs --report <file> -> dry run, also writes the JSON report.
//   node scripts/import-product-enrichment.mjs --apply         -> writes to the PREVIEW database only (see guards). NOT used in Phase 3.
// Guarantees: matches products by immutable id, never creates/deletes products, never writes price/VAT/inventory/sale mode/publish state/id/slug,
// skips the 9 blocked products, fails closed per product on any drift, and is safe to run twice (already-applied values are no-ops).
import { readFileSync, writeFileSync } from "node:fs";
import { buildUpdate, datasetSchema, planEnrichment, summarizePlan } from "../lib/product-enrichment.ts";

const args = process.argv.slice(2), apply = args.includes("--apply");
const reportPath = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;
const dataset = datasetSchema.parse(JSON.parse(readFileSync(new URL("../data/catalog-enrichment/catalog-enrichment.v1.json", import.meta.url), "utf8")));

let current;
if (!apply) {
  current = new Map(Object.entries(dataset.baseline)); // offline: "current" = the reviewed catalog snapshot
} else {
  const url = process.env.DATABASE_URL_UNPOOLED, target = process.env.MIGRATION_TARGET_ENV, branch = process.env.NEON_BRANCH_ID;
  const expected = process.env.EXPECTED_NEON_PREVIEW_BRANCH_ID, production = process.env.EXPECTED_NEON_PRODUCTION_BRANCH_ID;
  if (!url || !target || !branch || !expected) throw new Error("DATABASE_URL_UNPOOLED, MIGRATION_TARGET_ENV, NEON_BRANCH_ID and EXPECTED_NEON_PREVIEW_BRANCH_ID are required.");
  if (target !== "preview" || branch !== expected) throw new Error("Enrichment may only be applied to the Preview branch.");
  if (production && branch === production) throw new Error("Refusing to run against the Production branch.");
  if (process.env.APP_ENV && process.env.APP_ENV !== "preview") throw new Error("APP_ENV must be preview.");
  if (process.env.ENRICHMENT_IMPORT_CONFIRM !== "I_UNDERSTAND_PREVIEW_ONLY") throw new Error("Set ENRICHMENT_IMPORT_CONFIRM=I_UNDERSTAND_PREVIEW_ONLY to apply.");
}

const summary = () => summarizePlan(dataset, plan);
let plan;
if (!apply) {
  plan = planEnrichment(dataset, current);
} else {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1, ssl: { rejectUnauthorized: true } });
  try {
    const columns = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name IN ('short_description','gallery','specifications','documents','manufacturer_warranty','source_url')`)).rowCount;
    if (columns !== 6) throw new Error("Migration 0007 (product enrichment columns) is not applied on this database.");
    const ids = dataset.decisions.filter((d) => d.importStatus.startsWith("READY")).map((d) => d.productId);
    const rows = (await pool.query(`SELECT id, slug, name, price, vat_rate_bps, sale_mode, status, sku, description, image_url, energy_class, wifi, short_description, gallery, specifications, documents, manufacturer_warranty, source_url FROM products WHERE id = ANY($1)`, [ids])).rows;
    current = new Map(rows.map((r) => [r.id, { id: r.id, slug: r.slug, name: r.name, price: r.price, vatRateBps: r.vat_rate_bps, saleMode: r.sale_mode, status: r.status, sku: r.sku, description: r.description, imageUrl: r.image_url, energyClass: r.energy_class, wifi: r.wifi, shortDescription: r.short_description, gallery: r.gallery, specifications: r.specifications, documents: r.documents, manufacturerWarranty: r.manufacturer_warranty, sourceUrl: r.source_url }]));
    plan = planEnrichment(dataset, current);
    for (const entry of plan.filter((e) => e.action === "update")) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { text, values } = buildUpdate(entry);
        const result = await client.query(text, values);
        if (result.rowCount !== 1) throw new Error(`guarded update matched ${result.rowCount} rows for ${entry.productId}`);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); entry.action = "fail-content-drift"; entry.fields = [String(error.message)]; } finally { client.release(); }
    }
  } finally { await pool.end(); }
}

const s = summary();
const lines = plan.filter((e) => e.action === "update" || e.action === "noop").map((e) => ({ productId: e.productId, identity: { id: e.productId, slug: dataset.baseline[e.productId].slug }, action: e.action, wouldChange: e.changes, primaryImage: "OK", galleryCount: e.record.gallery.length, specCount: Object.keys(e.record.specifications).length, documentCount: e.record.documents.length, warranty: e.record.manufacturerWarranty.classification }));
const skipped = plan.filter((e) => e.action === "skipped-blocked").map((e) => ({ productId: e.productId, importStatus: e.importStatus, reasons: e.reasons }));
const failed = plan.filter((e) => e.action.startsWith("fail-"));
const report = { mode: apply ? "APPLY" : "DRY_RUN", databaseWritten: apply, summary: s, candidates: lines, skippedBlocked: skipped, failedClosed: failed };
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify({ mode: report.mode, databaseWritten: report.databaseWritten, ...s }, null, 1));
if (failed.length || s.PRICE_CHANGES || s.VAT_CHANGES || s.INVENTORY_CHANGES || s.SALE_MODE_CHANGES || s.PUBLISH_STATE_CHANGES || s.PRODUCT_ID_CHANGES) { console.error("STOP: fail-closed entries or protected-field changes detected."); process.exitCode = 1; }
