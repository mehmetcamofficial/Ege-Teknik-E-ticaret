#!/usr/bin/env node
/**
 * Content registry EXPORTER (P0-B / P1).
 *
 *   node --experimental-strip-types scripts/export-content-registry.mjs             -> writes data/content/registry-snapshot.json (dry DB read)
 *   node --experimental-strip-types scripts/export-content-registry.mjs --check     -> exit 1 when the committed file is out of date
 *   node --experimental-strip-types scripts/export-content-registry.mjs --apply      -> reads the PREVIEW/DEV database, then writes + records the export
 *
 * DB -> committed snapshot. This is the ONLY supported way data/content/registry-snapshot.json is
 * produced, and the result is a pure function of the database content: no timestamps, no environment and
 * no iteration-order dependence, so repeated exports are byte-identical.
 *
 * The default (no --apply) mode runs fully OFFLINE against the frozen guides, so the committed snapshot
 * can be regenerated and verified on any machine with no credentials and no database — which is what
 * keeps CI credential-free.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectionGuides } from "./klima-rehberi/guides-1.mjs";
import { technologyGuides } from "./klima-rehberi/guides-2.mjs";
import { serviceGuides } from "./klima-rehberi/guides-3.mjs";
import {
  buildSnapshot, DEFAULT_GUIDE_PUBLISHED_AT, fromTableRows, importGuides, parseRegistrySnapshot,
  REGISTRY_SNAPSHOT_PATH, serializeRegistry,
} from "../lib/content-registry.ts";
import { assertRegistrySchema, createPool, readRegistry, recordExport } from "../lib/content-registry-db.ts";
import { assertPreviewTarget } from "./content-registry-guards.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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
const check = args.includes("--check");
const apply = args.includes("--apply");

/** Offline: the registry as the frozen guides define it. Used when no database is in play. */
const offlineEntries = () => importGuides(allGuides, { publishedAt: DEFAULT_GUIDE_PUBLISHED_AT, sourceRefFor: (g) => fileFor.get(g.slug) ?? "" });

let entries = offlineEntries();
let source = "offline-guides";
if (apply) {
  const url = assertPreviewTarget(process.env);
  const pool = await createPool(url);
  try {
    await assertRegistrySchema(pool);
    // DB -> rows -> entries: the exporter's canonical read path, not a re-import of the guides.
    entries = fromTableRows(await readRegistry(pool));
    source = "database";
    if (!entries.length) throw new Error("the content registry is empty; run the importer first.");
  } finally {
    await pool.end();
  }
}

const serialized = serializeRegistry(entries);
const snapshot = buildSnapshot(entries);
const target = join(ROOT, REGISTRY_SNAPSHOT_PATH);
const current = existsSync(target) ? readFileSync(target, "utf8") : null;
const upToDate = current === serialized;

if (check) {
  if (!upToDate) {
    console.error(`[content-registry] ${REGISTRY_SNAPSHOT_PATH} is out of date (source: ${source}).\nRun: node --experimental-strip-types scripts/export-content-registry.mjs`);
    process.exit(1);
  }
  console.log(`[content-registry] OK: ${REGISTRY_SNAPSHOT_PATH} is current (${snapshot.entries.length} entries, contentHash ${snapshot.contentHash}).`);
} else if (apply) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, serialized);
  const pool = await createPool(assertPreviewTarget(process.env));
  try {
    await recordExport(pool, { id: `export:${REGISTRY_SNAPSHOT_PATH}`, targetPath: REGISTRY_SNAPSHOT_PATH, contentHash: snapshot.contentHash, entryCount: snapshot.entries.length, generatedBy: "scripts/export-content-registry.mjs" });
  } finally {
    await pool.end();
  }
  console.log(`[content-registry] wrote ${REGISTRY_SNAPSHOT_PATH} from the database: ${snapshot.entries.length} entries, contentHash ${snapshot.contentHash}.`);
} else if (upToDate) {
  console.log(`[content-registry] OK: ${REGISTRY_SNAPSHOT_PATH} already matches the offline content (contentHash ${snapshot.contentHash}); nothing written.`);
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, serialized);
  console.log(`[content-registry] wrote ${REGISTRY_SNAPSHOT_PATH} (offline): ${snapshot.entries.length} entries, contentHash ${snapshot.contentHash}.`);
}

// Guard against a silently corrupt artifact: the file we just produced/verified must re-parse.
parseRegistrySnapshot(serialized);
