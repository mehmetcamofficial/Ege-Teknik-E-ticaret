#!/usr/bin/env node
/**
 * Content registry IMPORTER (P0-B / P1).
 *
 *   node --experimental-strip-types scripts/import-content-registry.mjs              -> DRY RUN (default): offline, writes NOTHING
 *   node --experimental-strip-types scripts/import-content-registry.mjs --apply      -> writes to the PREVIEW/DEV database only
 *   node --experimental-strip-types scripts/import-content-registry.mjs --report <f> -> dry run, also writes the JSON report
 *
 * Reads the FROZEN sources scripts/klima-rehberi/guides-{1,2,3}.mjs (never modified by this tool) and
 * loads all 16 guides into the content registry losslessly: text verbatim, section/FAQ/related/link
 * ordering preserved, published_at preserved, image metadata preserved.
 *
 * Guarantees: dry run is the default; --apply is refused unless the target is an explicitly-confirmed
 * Preview/dev database (Production is refused outright); the 16 slugs are frozen and a slug change aborts
 * the import; the run is idempotent.
 */
import { writeFileSync } from "node:fs";
import { selectionGuides } from "./klima-rehberi/guides-1.mjs";
import { technologyGuides } from "./klima-rehberi/guides-2.mjs";
import { serviceGuides } from "./klima-rehberi/guides-3.mjs";
import { buildSnapshot, countEntries, DEFAULT_GUIDE_PUBLISHED_AT, importGuides, serializeRegistry, toTableRows } from "../lib/content-registry.ts";
import { assertRegistrySchema, createPool, readEntrySlugs, writeRegistry } from "../lib/content-registry-db.ts";
import { assertPreviewWrite } from "./content-registry-guards.mjs";

/** @type {{ file: string, guides: any[] }[]} */
const SOURCES = [
  { file: "scripts/klima-rehberi/guides-1.mjs", guides: selectionGuides },
  { file: "scripts/klima-rehberi/guides-2.mjs", guides: technologyGuides },
  { file: "scripts/klima-rehberi/guides-3.mjs", guides: serviceGuides },
];

/** @type {Map<string, string>} */
const fileFor = new Map();
/** @type {any[]} */
const allGuides = [];
for (const source of SOURCES) for (const guide of source.guides) { fileFor.set(guide.slug, source.file); allGuides.push(guide); }

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const reportPath = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;

const entries = importGuides(allGuides, { publishedAt: DEFAULT_GUIDE_PUBLISHED_AT, sourceRefFor: (g) => fileFor.get(g.slug) ?? "" });
const tables = toTableRows(entries);
const snapshot = buildSnapshot(entries);
const counts = countEntries(entries);

const slugs = entries.map((e) => e.slug);
const duplicateSlugs = slugs.filter((s, i) => slugs.indexOf(s) !== i);

const report = {
  mode: apply ? "APPLY" : "DRY_RUN",
  databaseWritten: apply,
  sources: SOURCES.map((s) => ({ file: s.file, guides: s.guides.length })),
  counts,
  contentHash: snapshot.contentHash,
  snapshotPath: "data/content/registry-snapshot.json",
  entries: entries.map((e) => ({
    id: e.id, slug: e.slug, category: e.category, publishedAt: e.publishedAt, sourceRef: e.sourceRef, contentHash: e.contentHash,
    sections: e.sections.length, faq: e.faq.length, relatedEntries: e.relatedEntries.length, links: e.links.length,
    relatedProducts: e.relatedProducts.length, relatedServices: e.relatedServices.length,
  })),
  problems: [
    ...duplicateSlugs.map((s) => `duplicate slug: ${s}`),
    ...(allGuides.length === 16 ? [] : [`expected 16 guides, found ${allGuides.length}`]),
  ],
};

if (duplicateSlugs.length) {
  console.error(JSON.stringify({ ...report, problems: report.problems }, null, 1));
  console.error("STOP: duplicate slugs would violate content_entries_slug_uq.");
  process.exit(1);
}

if (apply) {
  const url = assertPreviewWrite(process.env);
  const pool = await createPool(url);
  try {
    await assertRegistrySchema(pool);
    const existingSlugs = await readEntrySlugs(pool);
    const { counts: written } = await writeRegistry(pool, entries, tables, { existingSlugsById: existingSlugs });
    console.log(JSON.stringify({ ...report, written }, null, 1));
  } finally {
    await pool.end();
  }
} else {
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 1) + "\n");
  console.log(JSON.stringify(report, null, 1));
}

// The importer never writes the snapshot: that is the exporter's job (DB -> file), so the committed
// artifact always reflects what the database actually holds.
if (!apply) {
  const preview = serializeRegistry(entries);
  process.stderr.write(`[content-registry] dry run: ${entries.length} guides, snapshot would be ${preview.length} bytes (contentHash ${snapshot.contentHash}). No database was contacted.\n`);
}
