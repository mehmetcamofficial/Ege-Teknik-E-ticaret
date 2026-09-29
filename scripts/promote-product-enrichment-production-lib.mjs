/**
 * Production image-enrichment promotion (Phase 3 of the controlled data release): pure, testable guards and
 * planning logic, split out from scripts/promote-product-enrichment-production.mjs the same way
 * scripts/migrate-lib.mjs was split from scripts/migrate.mjs - so every guard runs against fakes, no database,
 * no network.
 *
 * Scope: this promotes ONLY the three already-reviewed image columns (image_url, gallery, source_url) from the
 * reviewed dataset (data/catalog-enrichment/catalog-enrichment.v1.json) into Production. It reuses
 * lib/product-enrichment.ts's planEnrichment/buildUpdate verbatim (the same fail-closed logic the Preview
 * importer uses: protected commercial/identity fields are only ever compared, never written; any drift or
 * existing conflicting content fails that product closed) and then narrows every "update" entry's write set
 * down to the image columns before a single UPDATE is built. Nothing outside that column set can ever appear
 * in a generated statement - see IMAGE_COLUMNS and narrowToImageColumns below.
 *
 * This is a SEPARATE mechanism from scripts/import-product-enrichment.mjs. That importer remains hard-guarded
 * to Preview only and is not touched or weakened by this file.
 */
import { buildUpdate, planEnrichment, WRITABLE_COLUMNS } from "../lib/product-enrichment.ts";

export const CONNECTION_TIMEOUT_MS = 15_000;
export const OVERALL_TIMEOUT_MS = 300_000;
export const CLEANUP_TIMEOUT_MS = 5_000;
export const SESSION_SETTINGS_SQL = "SET lock_timeout = '10s'; SET statement_timeout = '120s'; SET idle_in_transaction_session_timeout = '60s'";
export const EXPECTED_SETTINGS = { lock_timeout: "10s", statement_timeout: "2min", idle_in_transaction_session_timeout: "1min" };

// Defence in depth: hardcoded, not read from any env var, so a misconfigured "expected" value can never widen it.
export const KNOWN_PRODUCTION_BRANCH_ID = "br-nameless-grass-aw9qpndy";
export const KNOWN_PREVIEW_BRANCH_ID = "br-nameless-mountain-awib28a9";

/** The only product columns this script may ever write. Anything else appearing in a plan entry is dropped before SQL is built. */
export const IMAGE_FIELDS = /** @type {const} */ (["imageUrl", "gallery", "sourceUrl"]);
export const IMAGE_COLUMNS = IMAGE_FIELDS.map((f) => WRITABLE_COLUMNS[f]);

export class PromotionGuardError extends Error { constructor(message) { super(message); this.name = "PromotionGuardError"; } }

/** Validates the environment and returns the connection string. Throws fixed messages that never contain a value. */
export function assertProductionPromotionEnvironment(env) {
  const url = env.DATABASE_URL_UNPOOLED, target = env.MIGRATION_TARGET_ENV, branch = env.NEON_BRANCH_ID;
  const expectedProduction = env.EXPECTED_NEON_PRODUCTION_BRANCH_ID, expectedPreview = env.EXPECTED_NEON_PREVIEW_BRANCH_ID;
  if (!url || !target || !branch || !expectedProduction) throw new PromotionGuardError("DATABASE_URL_UNPOOLED, MIGRATION_TARGET_ENV, NEON_BRANCH_ID and EXPECTED_NEON_PRODUCTION_BRANCH_ID are required.");
  if (target !== "production") throw new PromotionGuardError("This script only ever targets production; MIGRATION_TARGET_ENV must be exactly \"production\".");
  if (expectedProduction !== KNOWN_PRODUCTION_BRANCH_ID) throw new PromotionGuardError("EXPECTED_NEON_PRODUCTION_BRANCH_ID does not match the known Production branch id.");
  if (branch !== expectedProduction) throw new PromotionGuardError("NEON_BRANCH_ID does not match EXPECTED_NEON_PRODUCTION_BRANCH_ID.");
  if (branch === KNOWN_PREVIEW_BRANCH_ID || (expectedPreview && branch === expectedPreview)) throw new PromotionGuardError("Refusing to run against the Preview branch.");
  if (env.APP_ENV && env.APP_ENV !== "production") throw new PromotionGuardError("APP_ENV must be production.");
  let hostname;
  try { hostname = new URL(url).hostname; } catch { throw new PromotionGuardError("DATABASE_URL_UNPOOLED is not a valid connection URL."); } // never rethrow the URL error: it echoes the input
  if (!hostname) throw new PromotionGuardError("DATABASE_URL_UNPOOLED is not a valid connection URL.");
  if (hostname.toLowerCase().includes("-pooler")) throw new PromotionGuardError("DATABASE_URL_UNPOOLED points to a pooler endpoint; this script requires the direct endpoint.");
  if (!env.RECOVERY_CHECKPOINT_LABEL) throw new PromotionGuardError("RECOVERY_CHECKPOINT_LABEL is required: name the fresh Neon recovery branch created for this run before proceeding.");
  return { url, branch, recoveryCheckpointLabel: env.RECOVERY_CHECKPOINT_LABEL };
}

/** The explicit one-time write authorization. Dry run is the default; this is the only way to unlock a write. */
export function assertApplyAuthorized(env) {
  if (env.ALLOW_PRODUCT_ENRICHMENT_PRODUCTION !== "I_UNDERSTAND_PRODUCT_ENRICHMENT_PRODUCTION") {
    throw new PromotionGuardError("Set ALLOW_PRODUCT_ENRICHMENT_PRODUCTION=I_UNDERSTAND_PRODUCT_ENRICHMENT_PRODUCTION to apply.");
  }
}

/**
 * Narrows a full planEnrichment() "update" entry down to only the image columns this script may write.
 * Returns null when there is nothing left to write for this product (already set, or the dataset has no
 * image-field change for it) - the caller must then skip it, never fall back to writing other fields.
 */
export function narrowToImageColumns(entry) {
  if (entry.action !== "update") return null;
  const changes = entry.changes.filter((field) => IMAGE_FIELDS.includes(field));
  if (!changes.length) return null;
  return { ...entry, changes };
}

/**
 * Builds the full promotion plan from the dataset and a snapshot of current Production rows.
 * Every entry keeps its original planEnrichment() action/reason so failures and blocked products are visible;
 * `imageUpdate` is set only for entries that actually have an image-column write, already narrowed and with
 * its UPDATE statement pre-built (never touching a column outside IMAGE_COLUMNS).
 */
export function buildPromotionPlan(dataset, current) {
  const plan = planEnrichment(dataset, current);
  return plan.map((entry) => {
    const narrowed = narrowToImageColumns(entry);
    if (!narrowed) return { ...entry, imageUpdate: null };
    const { text, values } = buildUpdate(narrowed);
    const columns = narrowed.changes.map((f) => WRITABLE_COLUMNS[f]);
    if (columns.some((c) => !IMAGE_COLUMNS.includes(c))) throw new PromotionGuardError("internal error: a non-image column reached the promotion plan");
    return { ...entry, imageUpdate: { text, values, columns } };
  });
}

export function summarizePromotionPlan(plan) {
  const toWrite = plan.filter((e) => e.imageUpdate);
  return {
    TOTAL_DECISIONS: plan.length,
    ELIGIBLE: plan.filter((e) => e.action !== "skipped-blocked").length,
    BLOCKED: plan.filter((e) => e.action === "skipped-blocked").length,
    FAILED_CLOSED: plan.filter((e) => e.action.startsWith("fail-")).length,
    NOOP_ALREADY_SET: plan.filter((e) => e.action === "noop").length,
    IMAGE_ROWS_TO_UPDATE: toWrite.length,
    COLUMNS_TOUCHED: [...new Set(toWrite.flatMap((e) => e.imageUpdate.columns))].sort(),
  };
}

const timer = (ms, message) => { let id; const promise = new Promise((_, reject) => { id = setTimeout(() => reject(new PromotionGuardError(message)), ms); }); return { promise, cancel: () => clearTimeout(id) }; };

export async function closePoolBounded(pool, ms = CLEANUP_TIMEOUT_MS, log = () => {}) {
  const deadline = timer(ms, "cleanup timeout");
  try { await Promise.race([Promise.resolve().then(() => pool.end()), deadline.promise]); log("pool closed"); }
  catch { log("pool shutdown did not finish in time; continuing"); }
  finally { deadline.cancel(); }
}

export function safeErrorSummary(error) {
  if (error instanceof PromotionGuardError) return error.message;
  const code = typeof error?.code === "string" ? error.code : error?.name ?? "Error";
  if (typeof error?.severity === "string" && typeof error?.message === "string") return `${code}: ${error.message.slice(0, 200)}`;
  return String(code);
}
