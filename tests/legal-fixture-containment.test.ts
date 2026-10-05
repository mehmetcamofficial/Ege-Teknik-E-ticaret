/**
 * P2-FIXTURE-A — behavioural containment tests for the legacy legal-fixture boundary.
 *
 * These exercise the REAL boundary functions. They are behavioural, not source-regex: a fixture is placed in a
 * synthetic inventory, an environment is supplied, and the boundary's own verdict is checked. No DB is touched.
 * The inventory rows are the ones the SELECT-only Preview audit actually returned on 2026-10-04.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  LEGACY_FIXTURE_EXPECTATIONS,
  LEGACY_FIXTURE_VERSION_IDS,
  VERIFIED_PREVIEW_NEON_BRANCH_ID,
  classifyLegalVersion,
  hasVerifiedPreviewFixtureIdentity,
  inspectLegalFixtureContamination,
  isLegalFixtureContaminated,
  isLegacyLegalFixtureVersionId,
  legacyFixtureExpectationDrift,
} from "../lib/legal-fixture-registry.ts";

type Row = { id: string; slug: string; version: number; publishedBy: string | null; contentHash: string };

const PREVIEW_ENV = {
  APP_ENV: "preview",
  NEON_BRANCH_ID: VERIFIED_PREVIEW_NEON_BRANCH_ID,
  EXPECTED_NEON_PREVIEW_BRANCH_ID: VERIFIED_PREVIEW_NEON_BRANCH_ID,
};
const PRODUCTION_ENV = {
  APP_ENV: "production",
  NEON_BRANCH_ID: "br-nameless-grass-aw9qpndy",
  EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-nameless-grass-aw9qpndy",
};

/** The registry exactly as the database holds it, verbatim from the Preview audit. */
const REGISTRY_ROWS: Row[] = Object.entries(LEGACY_FIXTURE_EXPECTATIONS).map(([id, e]) => ({
  id,
  slug: e.slug,
  version: e.version,
  publishedBy: e.publishedBy,
  contentHash: `${e.contentHash}0000000000000000`,
}));

const ORDINARY_ROWS: Row[] = [
  { id: "d0514f36-6c96-405b-8fd9-48eb80ed945e", slug: "cookies", version: 4, publishedBy: null, contentHash: "845692145c3a" },
  { id: "8116eae6-f768-4ec3-aef3-803d8ab8376f", slug: "distance-sales", version: 3, publishedBy: null, contentHash: "2363ceeb0981" },
  { id: "67b51b36-cf6c-466e-bb35-dc61495983d8", slug: "pre-information", version: 3, publishedBy: null, contentHash: "ce8c71c5363e" },
  { id: "2c82acd8-22b3-4c8c-8643-310b9c6f29f0", slug: "delivery-returns", version: 1, publishedBy: null, contentHash: "58a836d12ff6" },
];
// ---- allowed only under verified Preview identity -------------------------------------------------
test("a registered fixture is allowed ONLY under the exact verified Preview identity", () => {
  assert.equal(contaminated(REGISTRY_ROWS, PREVIEW_ENV), false, "verified Preview must serve fixtures");
});

test("the same fixture inventory fails closed in Production", () => {
  assert.equal(contaminated(REGISTRY_ROWS, PRODUCTION_ENV), true);
});

test("a missing or malformed APP_ENV fails closed, with no normalisation", () => {
  const { APP_ENV: _dropped, ...withoutAppEnv } = PREVIEW_ENV;
  assert.equal(contaminated(REGISTRY_ROWS, withoutAppEnv), true);
  for (const value of ["Preview", "PREVIEW", " preview", "preview ", "", "prod"]) {
    assert.equal(contaminated(REGISTRY_ROWS, { ...PREVIEW_ENV, APP_ENV: value }), true, `APP_ENV=${JSON.stringify(value)} was accepted`);
  }
});

test("a wrong or missing NEON_BRANCH_ID fails closed", () => {
  assert.equal(contaminated(REGISTRY_ROWS, { ...PREVIEW_ENV, NEON_BRANCH_ID: "br-somewhere-else" }), true);
  assert.equal(contaminated(REGISTRY_ROWS, { ...PREVIEW_ENV, NEON_BRANCH_ID: "br-nameless-grass-aw9qpndy" }), true, "the Production branch id must never qualify");
  const { NEON_BRANCH_ID: _dropped, ...withoutBranch } = PREVIEW_ENV;
  assert.equal(contaminated(REGISTRY_ROWS, withoutBranch), true);
});

test("EXPECTED_NEON_PREVIEW_BRANCH_ID missing, mismatched or spoofed fails closed", () => {
  const { EXPECTED_NEON_PREVIEW_BRANCH_ID: _dropped, ...withoutExpected } = PREVIEW_ENV;
  assert.equal(contaminated(REGISTRY_ROWS, withoutExpected), true);
  assert.equal(contaminated(REGISTRY_ROWS, { ...PREVIEW_ENV, EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-other" }), true);
  assert.equal(contaminated(REGISTRY_ROWS, { ...PRODUCTION_ENV, EXPECTED_NEON_PREVIEW_BRANCH_ID: VERIFIED_PREVIEW_NEON_BRANCH_ID }), true);
});

// ---- the registry itself ------------------------------------------------------------------------
test("EVERY registry id is recognised individually, and each alone trips the boundary outside Preview", () => {
  assert.equal(LEGACY_FIXTURE_VERSION_IDS.length, 9, "the verified inventory holds exactly nine fixtures");
  for (const id of LEGACY_FIXTURE_VERSION_IDS) {
    assert.equal(classifyLegalVersion({ id }), "legacy_fixture", `not classified: ${id}`);
    assert.equal(isLegacyLegalFixtureVersionId(id), true, id);
    const row = REGISTRY_ROWS.find((r) => r.id === id)!;
    assert.ok(row, `no inventory row for ${id}`);
    assert.equal(contaminated([row], PRODUCTION_ENV), true, `${id} did not trip the boundary`);
    assert.equal(contaminated([row], PREVIEW_ENV), false, `${id} blocked valid Preview`);
  }
});

test("all nine together fail closed in Production and with no identity at all", () => {
  assert.equal(contaminated(REGISTRY_ROWS, PRODUCTION_ENV), true);
  assert.equal(contaminated(REGISTRY_ROWS, {}), true);
});

test("the two V1 checkout fixtures are recognised - the ids the old (title, publisher) model lost", () => {
  for (const id of ["preview-test-ver-distance-sales-1", "preview-test-ver-pre-information-1"]) {
    assert.equal(isLegacyLegalFixtureVersionId(id), true, id);
    assert.ok(LEGACY_FIXTURE_VERSION_IDS.includes(id));
  }
});

test("the registry is sorted and free of duplicates", () => {
  assert.deepEqual([...LEGACY_FIXTURE_VERSION_IDS], [...LEGACY_FIXTURE_VERSION_IDS].sort(), "registry must be deterministically sorted");
  assert.equal(new Set(LEGACY_FIXTURE_VERSION_IDS).size, LEGACY_FIXTURE_VERSION_IDS.length);
});

// ---- authority can never be manufactured ---------------------------------------------------------
test("title markers and fixture publishers alone grant NO fixture authority", () => {
  const impostors: Row[] = [
    { id: "impostor-1", slug: "distance-sales", version: 9, publishedBy: "preview-fixture-script", contentHash: "aaa" },
    { id: "impostor-2", slug: "cookies", version: 9, publishedBy: "pg-test-3b3-script", contentHash: "bbb" },
    { id: "impostor-3", slug: "terms", version: 9, publishedBy: "e7c9a5ef-adf0-4d65-84a6-6dc92c4fe72c", contentHash: "ccc" },
  ];
  assert.equal(contaminated(impostors, PRODUCTION_ENV), false, "an unregistered id is ordinary whatever its text claims");
  assert.equal(contaminated(impostors, PREVIEW_ENV), false);
  for (const row of impostors) assert.equal(classifyLegalVersion(row), "ordinary", row.id);
});

test("an entirely empty environment fails closed", () => {
  assert.equal(contaminated(REGISTRY_ROWS, {}), true);
  assert.equal(hasVerifiedPreviewFixtureIdentity({}), false);
});
// ---- no fallback, whatever the shape of the contamination ----------------------------------------
test("a fixture on a NON-checkout slug still fails Production closed", () => {
  assert.equal(contaminated([{ ...REGISTRY_ROWS[0], slug: "some-future-slug" }], PRODUCTION_ENV), true);
  assert.equal(contaminated([{ ...REGISTRY_ROWS[0], slug: "kvkk" }], PRODUCTION_ENV), true);
});

test("a superseded fixture beside a selectable ordinary version gets NO fallback", () => {
  const report = inspectLegalFixtureContamination([...REGISTRY_ROWS, ...ORDINARY_ROWS], PRODUCTION_ENV);
  assert.equal(isLegalFixtureContaminated(report), true, "an ordinary version must never mask a fixture");
  assert.equal(report.offendingVersionIds.length, 9, "every fixture is reported, not just the highest one");
});

test("a future-effective fixture still fails Production closed", () => {
  assert.equal(contaminated([{ ...REGISTRY_ROWS[0], version: 99 }], PRODUCTION_ENV), true);
});

test("a clean, ordinary Production inventory remains fully selectable", () => {
  assert.equal(contaminated(ORDINARY_ROWS, PRODUCTION_ENV), false);
  assert.equal(contaminated(ORDINARY_ROWS, {}), false, "a clean inventory needs no fixture identity at all");
  for (const row of ORDINARY_ROWS) assert.equal(classifyLegalVersion(row), "ordinary", row.id);
});

// ---- registry drift -----------------------------------------------------------------------------
test("a registered fixture whose recorded identity changed fails closed instead of being downgraded", () => {
  for (const drift of [{ slug: "hijacked" }, { version: 42 }, { publishedBy: "someone-else" }, { contentHash: "deadbeefdeadbeef" }]) {
    const row = { ...REGISTRY_ROWS[0], ...drift };
    assert.ok(legacyFixtureExpectationDrift(row), `drift not detected: ${JSON.stringify(drift)}`);
    assert.equal(contaminated([row], PREVIEW_ENV), true, "drift must fail closed even in Preview");
    assert.equal(contaminated([row], PRODUCTION_ENV), true);
  }
  assert.equal(legacyFixtureExpectationDrift(REGISTRY_ROWS[0]), null, "the audited rows must not look like drift");
  assert.equal(legacyFixtureExpectationDrift({ id: "unregistered" }), null, "an unknown id has no expectations");
});

// ---- the report never leaks internals -------------------------------------------------------------
test("the contamination report carries ids only - no environment values or secrets", () => {
  const report = inspectLegalFixtureContamination(REGISTRY_ROWS, { ...PRODUCTION_ENV, SIGNING_SECRET: "s3cret-value" });
  const serialised = JSON.stringify(report);
  assert.doesNotMatch(serialised, /s3cret-value/);
  assert.doesNotMatch(serialised, /SIGNING_SECRET/);
  assert.equal(report.driftedVersionIds.length, 0);
  assert.equal(report.offendingVersionIds.length, 9);
});

// ---- the loaders are guarded, and the guard runs BEFORE selection ---------------------------------
test("every legal-authority loader is guarded, and the guard precedes any selection", () => {
  const db = readFileSync("lib/legal-db.ts", "utf8");
  for (const loader of ["loadRequiredCheckoutLegalVersions", "loadRequiredCheckoutLegalDocuments", "loadPublicLegalVersion", "loadCurrentLegalIndex"]) {
    const start = db.indexOf(`export async function ${loader}`);
    assert.ok(start > 0, `loader missing: ${loader}`);
    const guard = db.indexOf("legalFixtureContaminated()", start);
    assert.ok(guard > start, `${loader} has no containment guard`);
    // The guard must come before the first row-selection query in that loader.
    const firstQuery = db.indexOf(".from(legalDocumentVersions)", start);
    assert.ok(guard < firstQuery, `${loader} selects rows before the containment guard runs`);
  }
});

test("containment inspects the COMPLETE inventory - no slug, published or effective filter", () => {
  const db = readFileSync("lib/legal-db.ts", "utf8");
  const start = db.indexOf("async function loadCompleteLegalVersionInventory");
  assert.ok(start > 0, "the complete-inventory loader must exist");
  // Bound the slice by the function's own closing brace, not by the next function name, so the assertion really
  // covers this function's body instead of whatever follows it.
  const end = db.indexOf("\n}", start);
  const body = db.slice(start, end);
  assert.ok(body.includes("legalDocumentVersions.id"), "it must still read the immutable id");
  for (const forbidden of ["inArray", "isNotNull", "publishedAt", "effectiveAt", "CHECKOUT_LEGAL_SLUGS", "where\\("]) {
    assert.doesNotMatch(body, new RegExp(forbidden), `the inventory must not filter on ${forbidden}`);
  }
  assert.match(body, /legalDocumentVersions\.id/, "it must still read the immutable id");
});

const contaminated = (rows: Row[], env: Record<string, string | undefined>) => isLegalFixtureContaminated(inspectLegalFixtureContamination(rows, env));