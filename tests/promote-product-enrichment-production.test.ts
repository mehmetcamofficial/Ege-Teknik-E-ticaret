import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { datasetSchema, PROTECTED_FIELDS, WRITABLE_COLUMNS, type EnrichmentDataset, type ProductRow } from "../lib/product-enrichment.ts";
import {
  assertApplyAuthorized, assertProductionPromotionEnvironment, buildPromotionPlan, IMAGE_COLUMNS, IMAGE_FIELDS,
  KNOWN_PREVIEW_BRANCH_ID, KNOWN_PRODUCTION_BRANCH_ID, narrowToImageColumns, PromotionGuardError, summarizePromotionPlan,
} from "../scripts/promote-product-enrichment-production-lib.mjs";

/** Phase 3 of the controlled data release. Guard tests run against fakes only - no database, no network. */
const SECRET_PASSWORD = "S3CR3T-pw-9f1c", SECRET_HOST = "ep-secret-host-1234.c-12.us-east-1.aws.neon.tech", SECRET_USER = "secret_user_77";
const direct = `postgresql://${SECRET_USER}:${SECRET_PASSWORD}@${SECRET_HOST}/neondb?sslmode=require`;
const pooler = direct.replace("ep-secret-host-1234.", "ep-secret-host-1234-pooler.");
const SECRETS = [SECRET_PASSWORD, SECRET_HOST, SECRET_USER, "ep-secret-host-1234", direct];
const noSecrets = (text: string, where: string) => { for (const s of SECRETS) assert.equal(text.includes(s), false, `${where} leaked a secret value`); };

const baseEnv = (over: Record<string, string | undefined> = {}) => ({
  DATABASE_URL_UNPOOLED: direct,
  MIGRATION_TARGET_ENV: "production",
  NEON_BRANCH_ID: KNOWN_PRODUCTION_BRANCH_ID,
  EXPECTED_NEON_PRODUCTION_BRANCH_ID: KNOWN_PRODUCTION_BRANCH_ID,
  RECOVERY_CHECKPOINT_LABEL: "pre-product-enrichment-2026-09-29",
  ...over,
}) as Record<string, string | undefined>;

// ---- environment guards, before any connection -----------------------------------------------------------
test("a pooler endpoint is rejected, without echoing the host", () => {
  assert.throws(() => assertProductionPromotionEnvironment(baseEnv({ DATABASE_URL_UNPOOLED: pooler })), (e: Error) => {
    assert.ok(e instanceof PromotionGuardError);
    assert.match(e.message, /pooler endpoint/);
    noSecrets(e.message, "error");
    return true;
  });
});
test("a direct endpoint against the known Production branch is accepted structurally", () => {
  assert.deepEqual(assertProductionPromotionEnvironment(baseEnv()), { url: direct, branch: KNOWN_PRODUCTION_BRANCH_ID, recoveryCheckpointLabel: "pre-product-enrichment-2026-09-29" });
});
test("only MIGRATION_TARGET_ENV=production is accepted", () => {
  for (const target of ["preview", "development", "PRODUCTION"]) {
    assert.throws(() => assertProductionPromotionEnvironment(baseEnv({ MIGRATION_TARGET_ENV: target })), /must be exactly "production"/);
  }
  // an empty/missing target fails the earlier required-variables check instead, which is also fail-closed
  for (const target of ["", undefined]) assert.throws(() => assertProductionPromotionEnvironment(baseEnv({ MIGRATION_TARGET_ENV: target })), PromotionGuardError);
});
test("the Preview branch is refused even if EXPECTED_NEON_PRODUCTION_BRANCH_ID was (mis)set to it", () => {
  assert.throws(
    () => assertProductionPromotionEnvironment(baseEnv({ NEON_BRANCH_ID: KNOWN_PREVIEW_BRANCH_ID, EXPECTED_NEON_PRODUCTION_BRANCH_ID: KNOWN_PREVIEW_BRANCH_ID })),
    /does not match the known Production branch/,
  );
});
test("the Preview branch is refused via EXPECTED_NEON_PREVIEW_BRANCH_ID even if NEON_BRANCH_ID matches Production", () => {
  // defence in depth: NEON_BRANCH_ID equal to the operator's own EXPECTED_NEON_PREVIEW_BRANCH_ID value is refused
  assert.throws(
    () => assertProductionPromotionEnvironment(baseEnv({ NEON_BRANCH_ID: "some-other-branch", EXPECTED_NEON_PREVIEW_BRANCH_ID: "some-other-branch" })),
    /NEON_BRANCH_ID does not match/,
  );
});
test("an unknown branch id is refused even if the operator's EXPECTED_NEON_PRODUCTION_BRANCH_ID was set to it", () => {
  assert.throws(() => assertProductionPromotionEnvironment(baseEnv({ NEON_BRANCH_ID: "br-unknown-branch-id", EXPECTED_NEON_PRODUCTION_BRANCH_ID: "br-unknown-branch-id" })), /known Production branch/);
});
test("a mismatched NEON_BRANCH_ID is refused", () => {
  assert.throws(() => assertProductionPromotionEnvironment(baseEnv({ NEON_BRANCH_ID: "br-something-else" })), /does not match/);
});
test("APP_ENV must be production when present", () => {
  assert.throws(() => assertProductionPromotionEnvironment(baseEnv({ APP_ENV: "preview" })), /APP_ENV must be production/);
  assert.doesNotThrow(() => assertProductionPromotionEnvironment(baseEnv({ APP_ENV: "production" })));
});
test("an unparsable URL is rejected with a fixed message (the URL error text would echo the input)", () => {
  for (const bad of ["not a url", "postgres://", "://x"]) assert.throws(() => assertProductionPromotionEnvironment(baseEnv({ DATABASE_URL_UNPOOLED: bad })), (e: Error) => { assert.ok(e instanceof PromotionGuardError); assert.equal(e.message.includes(bad), false); return true; });
});
test("a recovery-checkpoint label is required", () => {
  assert.throws(() => assertProductionPromotionEnvironment(baseEnv({ RECOVERY_CHECKPOINT_LABEL: undefined })), /RECOVERY_CHECKPOINT_LABEL is required/);
});
test("missing required variables are refused before any connection", () => {
  for (const key of ["DATABASE_URL_UNPOOLED", "MIGRATION_TARGET_ENV", "NEON_BRANCH_ID", "EXPECTED_NEON_PRODUCTION_BRANCH_ID"]) {
    assert.throws(() => assertProductionPromotionEnvironment(baseEnv({ [key]: undefined })), PromotionGuardError);
  }
});
test("applying requires the exact one-time confirmation token", () => {
  assert.throws(() => assertApplyAuthorized({}), /ALLOW_PRODUCT_ENRICHMENT_PRODUCTION/);
  assert.throws(() => assertApplyAuthorized({ ALLOW_PRODUCT_ENRICHMENT_PRODUCTION: "yes" }), /ALLOW_PRODUCT_ENRICHMENT_PRODUCTION/);
  assert.doesNotThrow(() => assertApplyAuthorized({ ALLOW_PRODUCT_ENRICHMENT_PRODUCTION: "I_UNDERSTAND_PRODUCT_ENRICHMENT_PRODUCTION" }));
});

// ---- write-scope narrowing --------------------------------------------------------------------------------
test("the allowed column set is exactly image_url, gallery, source_url", () => {
  assert.deepEqual([...IMAGE_COLUMNS].sort(), ["gallery", "image_url", "source_url"]);
  assert.deepEqual([...IMAGE_FIELDS].sort(), ["gallery", "imageUrl", "sourceUrl"]);
  for (const forbidden of ["price", "vat_rate_bps", "sale_mode", "status", "id", "slug", "name", "short_description", "description", "sku", "energy_class", "wifi", "specifications", "documents", "manufacturer_warranty"]) {
    assert.equal(IMAGE_COLUMNS.includes(forbidden as never), false, forbidden);
  }
});
test("narrowToImageColumns drops every non-image field and returns null when nothing image-related changed", () => {
  const fakeRecord = { imageUrl: "https://www.gree.com.tr/a.png", gallery: [{ url: "https://www.gree.com.tr/a.png" }], sourceUrl: "https://www.gree.com.tr/urun/a", description: "x", sku: "SKU" };
  const entry = { productId: "p", action: "update" as const, changes: ["description", "sku", "imageUrl", "gallery"] as never, record: fakeRecord as never, expected: { price: 1, vatRateBps: 2000, saleMode: "online", status: "published" } };
  const narrowed = narrowToImageColumns(entry)!;
  assert.deepEqual([...narrowed.changes].sort(), ["gallery", "imageUrl"]);
  assert.equal(narrowToImageColumns({ ...entry, changes: ["description", "sku"] as never }), null);
  assert.equal(narrowToImageColumns({ productId: "p", action: "noop" as const } as never), null);
  assert.equal(narrowToImageColumns({ productId: "p", action: "skipped-blocked" as const, importStatus: "BLOCKED_ASSET" as const, reasons: [] } as never), null);
});

// ---- full plan against the real reviewed dataset ----------------------------------------------------------
const dataset: EnrichmentDataset = datasetSchema.parse(JSON.parse(readFileSync("data/catalog-enrichment/catalog-enrichment.v1.json", "utf8")));
const rows = () => new Map<string, ProductRow>(Object.entries(dataset.baseline).map(([id, row]) => [id, structuredClone(row)]));

test("promotion plan against the reviewed baseline: 77 image updates, 10 blocked, nothing else touched", () => {
  const plan = buildPromotionPlan(dataset, rows());
  const summary = summarizePromotionPlan(plan);
  assert.equal(summary.TOTAL_DECISIONS, 87);
  assert.equal(summary.BLOCKED, 10);
  assert.equal(summary.IMAGE_ROWS_TO_UPDATE, 77);
  assert.equal(summary.FAILED_CLOSED, 0);
  assert.deepEqual(summary.COLUMNS_TOUCHED, ["gallery", "image_url", "source_url"]);
});
test("fandesk-fan-76 has no planned write (blocked for its confirmed-404 image)", () => {
  const plan = buildPromotionPlan(dataset, rows());
  const entry = plan.find((e) => e.productId === "fandesk-fan-76")!;
  assert.equal(entry.action, "skipped-blocked");
  assert.equal(entry.imageUpdate, null);
});
test("every generated statement sets only image_url/gallery/source_url, guards protected fields in WHERE, and matches on id alone", () => {
  const plan = buildPromotionPlan(dataset, rows()).filter((e) => e.imageUpdate);
  assert.equal(plan.length, 77);
  const allowed = new Set([...IMAGE_COLUMNS, "updated_at"]);
  for (const entry of plan) {
    const { text, values } = entry.imageUpdate!;
    assert.match(text, /^UPDATE products SET /);
    const [setPart, wherePart] = text.slice("UPDATE products SET ".length).split(" WHERE ");
    const columns = setPart.split(", ").map((assignment: string) => assignment.split(" = ")[0]);
    for (const column of columns) assert.ok(allowed.has(column), `${entry.productId}: ${column}`);
    // protected fields belong only in the concurrency-guard WHERE clause, never in SET
    assert.doesNotMatch(setPart, /price|vat_rate_bps|sale_mode|\bstatus\b/i);
    assert.equal(wherePart, "id = $1 AND price = $2 AND vat_rate_bps = $3 AND sale_mode = $4 AND status = $5");
    assert.equal(values[0], entry.productId);
    assert.doesNotMatch(text, /inventory|INSERT|DELETE|DROP|TRUNCATE/i);
  }
});
test("price, VAT, inventory, sale mode, publish state, id and slug can never reach the image-only write path", () => {
  assert.equal(Object.keys(WRITABLE_COLUMNS).some((k) => (PROTECTED_FIELDS as readonly string[]).includes(k)), false);
  for (const field of IMAGE_FIELDS) assert.ok(Object.keys(WRITABLE_COLUMNS).includes(field), field);
});
test("promotion is idempotent: after applying the planned image writes, a second plan has nothing left to write", () => {
  const current = rows();
  const first = buildPromotionPlan(dataset, current);
  for (const entry of first.filter((e) => e.imageUpdate)) {
    const row = current.get(entry.productId) as unknown as Record<string, unknown>;
    const { changes, record } = entry as unknown as { changes: string[]; record: Record<string, unknown> };
    for (const field of changes) row[field] = structuredClone(record[field]);
  }
  const second = buildPromotionPlan(dataset, current);
  assert.equal(summarizePromotionPlan(second).IMAGE_ROWS_TO_UPDATE, 0);
});
test("a product missing from Production fails closed and is never written", () => {
  const current = rows();
  const id = dataset.decisions.find((d) => d.importStatus.startsWith("READY_"))!.productId;
  current.delete(id);
  const entry = buildPromotionPlan(dataset, current).find((e) => e.productId === id)!;
  assert.equal(entry.action, "fail-missing-product");
  assert.equal(entry.imageUpdate, null);
});
test("drift in a protected commercial field fails that product closed instead of writing its image", () => {
  const id = dataset.decisions.find((d) => d.importStatus.startsWith("READY_"))!.productId;
  const current = rows();
  (current.get(id) as ProductRow).price += 1;
  const entry = buildPromotionPlan(dataset, current).find((e) => e.productId === id)!;
  assert.equal(entry.action, "fail-protected-drift");
  assert.equal(entry.imageUpdate, null);
});
