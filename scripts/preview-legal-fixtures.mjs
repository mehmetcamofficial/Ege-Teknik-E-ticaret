// PREVIEW-ONLY test fixtures for the checkout legal flow (Phase 3B.2).
// Inserts clearly labelled placeholder documents; NOT legal text. Idempotent (ON CONFLICT DO NOTHING).
// Hard guards: refuses anything but the Preview target and never runs against the Production branch.
import pg from "pg";
import { hashLegalDocument } from "../lib/legal.ts";

const url = process.env.DATABASE_URL_UNPOOLED, target = process.env.MIGRATION_TARGET_ENV, branch = process.env.NEON_BRANCH_ID;
const expected = process.env.EXPECTED_NEON_PREVIEW_BRANCH_ID, production = process.env.EXPECTED_NEON_PRODUCTION_BRANCH_ID;
if (!url || !target || !branch || !expected) throw new Error("DATABASE_URL_UNPOOLED, MIGRATION_TARGET_ENV, NEON_BRANCH_ID and EXPECTED_NEON_PREVIEW_BRANCH_ID are required.");
if (target !== "preview") throw new Error("Preview fixtures may only be created with MIGRATION_TARGET_ENV=preview.");
if (branch !== expected) throw new Error("NEON_BRANCH_ID does not match the expected Preview branch.");
if (production && branch === production) throw new Error("Refusing to run against the Production branch.");
if (process.env.APP_ENV && process.env.APP_ENV !== "preview") throw new Error("APP_ENV must be preview.");

// Version 2 is used because a first run created version 1 with a future effective date (a script bug).
// Published versions are never updated or deleted, so the fix is a new, already-effective version.
const effectiveAt = new Date("2026-09-01T00:00:00Z");
const docs = ["distance-sales", "pre-information"].map((slug) => ({
  docId: `preview-test-doc-${slug}`, versionId: `preview-test-ver-${slug}-2`, slug,
  title: `PREVIEW TEST — ${slug}`, body: "TEST FIXTURE — NOT LEGAL TEXT — PREVIEW ONLY",
}));
const pool = new pg.Pool({ connectionString: url, max: 1, ssl: { rejectUnauthorized: true } });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const d of docs) {
      await client.query('INSERT INTO legal_documents (id, slug) VALUES ($1, $2) ON CONFLICT DO NOTHING', [d.docId, d.slug]);
      await client.query(
        'INSERT INTO legal_document_versions (id, document_id, version, title, body, content_hash, effective_at, published_at, published_by) VALUES ($1,$2,2,$3,$4,$5,$6,$6,$7) ON CONFLICT DO NOTHING',
        [d.versionId, d.docId, d.title, d.body, hashLegalDocument({ title: d.title, body: d.body }), effectiveAt, "preview-fixture-script"],
      );
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  console.log(`Preview legal fixtures ensured: ${docs.map((d) => d.versionId).join(", ")}`);
} finally { await pool.end(); }
