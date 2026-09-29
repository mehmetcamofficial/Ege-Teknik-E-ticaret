// Production image-enrichment promotion (controlled data release, Phase 3-5).
//
//   node scripts/promote-product-enrichment-production.mjs
//     -> DRY RUN (default): connects to Production READ-ONLY, builds the exact plan, writes NOTHING.
//
//   node scripts/promote-product-enrichment-production.mjs --apply
//     -> Writes to PRODUCTION. Requires every guard below, one row at a time inside its own transaction,
//        and aborts entirely (no retries) if the affected row count for any statement is not exactly 1.
//
// This is a SEPARATE, narrower mechanism from scripts/import-product-enrichment.mjs, which remains
// hard-guarded to Preview only and is not touched by this file.
//
// Guarantees:
//  - only ever writes image_url, gallery, source_url (see IMAGE_COLUMNS in the lib module) - price, VAT,
//    stock, sale mode, publish state, name, slug, category, brand, orders, payments and refunds are never
//    read for writing and never appear in any UPDATE this script can build;
//  - matches products by immutable id only, never creates or deletes a product;
//  - reuses lib/product-enrichment.ts's fail-closed planEnrichment/buildUpdate verbatim: any drift in a
//    protected commercial/identity field, or any existing conflicting content, skips that product entirely;
//  - refuses a pooler endpoint, refuses the Preview branch, refuses any branch that isn't the exact known
//    Production branch id, refuses to apply without the one-time confirmation token;
//  - requires an operator-supplied RECOVERY_CHECKPOINT_LABEL naming the fresh Neon branch created before
//    the write (Phase 4) - this script does not create that branch itself;
//  - the default run is read-only end-to-end (`default_transaction_read_only=on`); --apply is the only
//    path that can write, and every write is inside `BEGIN`/`COMMIT` with the row count checked;
//  - logs only fixed phase names, counts and Postgres error codes - never a URL, host, user or password.
import { readFileSync } from "node:fs";
import { datasetSchema } from "../lib/product-enrichment.ts";
import {
  assertApplyAuthorized, assertProductionPromotionEnvironment, buildPromotionPlan, CLEANUP_TIMEOUT_MS,
  closePoolBounded, CONNECTION_TIMEOUT_MS, IMAGE_COLUMNS, OVERALL_TIMEOUT_MS, safeErrorSummary,
  SESSION_SETTINGS_SQL, summarizePromotionPlan,
} from "./promote-product-enrichment-production-lib.mjs";

const apply = process.argv.slice(2).includes("--apply");
const phase = (name) => console.log(`[promote-product-enrichment-production] ${name}`);

phase("validate-environment");
const { url, branch, recoveryCheckpointLabel } = assertProductionPromotionEnvironment(process.env);
if (apply) assertApplyAuthorized(process.env);
console.log(`INFO mode=${apply ? "APPLY" : "DRY_RUN"} branch=${branch} recoveryCheckpointLabel=${recoveryCheckpointLabel} columns=${IMAGE_COLUMNS.join(",")}`);

phase("parse-dataset");
const dataset = datasetSchema.parse(JSON.parse(readFileSync(new URL("../data/catalog-enrichment/catalog-enrichment.v1.json", import.meta.url), "utf8")));

const { default: pg } = await import("pg");
phase("create-pool");
const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  ssl: { rejectUnauthorized: true },
  // A dry run is enforced read-only at the session level, not just by "we didn't call UPDATE": even a bug
  // in this script cannot write during a dry run. --apply removes it so the per-row BEGIN/UPDATE/COMMIT can run.
  options: apply
    ? `-c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000`
    : `-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000`,
});
pool.on?.("error", () => {});

const overall = (() => { let id; const p = new Promise((_, rej) => { id = setTimeout(() => rej(new Error("overall timeout")), OVERALL_TIMEOUT_MS); }); return { promise: p, cancel: () => clearTimeout(id) }; })();

try {
  phase("connect-and-verify-session");
  const session = (await Promise.race([pool.query("select current_setting('transaction_read_only') ro, current_database() db"), overall.promise])).rows[0];
  console.log(`INFO transaction_read_only=${session.ro} database=${session.db}`);
  if (!apply && session.ro !== "on") throw new Error("dry run session is not read-only; refusing to proceed");

  phase("read-current-rows");
  const ids = dataset.decisions.map((d) => d.productId);
  const { rows } = await Promise.race([
    pool.query(
      `select id, slug, name, price, vat_rate_bps as "vatRateBps", sale_mode as "saleMode", status, sku, description,
              image_url as "imageUrl", energy_class as "energyClass", wifi, short_description as "shortDescription",
              gallery, specifications, documents, manufacturer_warranty as "manufacturerWarranty", source_url as "sourceUrl"
       from products where id = any($1)`,
      [ids],
    ),
    overall.promise,
  ]);
  const current = new Map(rows.map((r) => [r.id, r]));
  console.log(`INFO products_found=${current.size} products_expected=${ids.length}`);

  phase("build-plan");
  const plan = buildPromotionPlan(dataset, current);
  const summary = summarizePromotionPlan(plan);
  console.log("SUMMARY " + JSON.stringify(summary));
  const toWrite = plan.filter((e) => e.imageUpdate);
  console.log("PLANNED_UPDATES " + JSON.stringify(toWrite.map((e) => ({ productId: e.productId, columns: e.imageUpdate.columns }))));
  const failed = plan.filter((e) => e.action.startsWith("fail-"));
  if (failed.length) console.log("FAILED_CLOSED " + JSON.stringify(failed.map((e) => ({ productId: e.productId, action: e.action, fields: e.fields ?? null }))));

  if (!apply) {
    console.log(`RESULT DRY_RUN rows_planned=${toWrite.length}`);
    process.exit(0);
  }

  phase("apply");
  let committed = 0;
  const results = [];
  for (const entry of toWrite) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(SESSION_SETTINGS_SQL);
      const { text, values } = entry.imageUpdate;
      const result = await client.query(text, values);
      if (result.rowCount !== 1) {
        await client.query("ROLLBACK");
        results.push({ productId: entry.productId, outcome: "rolled-back-row-count-mismatch", rowCount: result.rowCount });
        continue;
      }
      await client.query("COMMIT");
      committed++;
      results.push({ productId: entry.productId, outcome: "committed" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      results.push({ productId: entry.productId, outcome: "error", error: safeErrorSummary(error) });
    } finally {
      client.release();
    }
  }
  console.log("APPLY_RESULTS " + JSON.stringify(results));
  console.log(`RESULT ${committed === toWrite.length ? "OK" : "PARTIAL"} rows_planned=${toWrite.length} rows_committed=${committed}`);
  if (committed !== toWrite.length) process.exitCode = 1;
} catch (error) {
  phase(`failed (${safeErrorSummary(error)})`);
  process.exitCode = 1;
} finally {
  overall.cancel();
  phase("cleanup");
  await closePoolBounded(pool, CLEANUP_TIMEOUT_MS, (message) => phase(message));
}
