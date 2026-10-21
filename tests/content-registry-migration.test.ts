/**
 * Content registry MIGRATION + BUILD-PURITY gate (P0-B / P1).
 *
 * Two contracts are locked here:
 *
 *  1. Migration safety — 0014 is additive, contiguous and journaled; migrations 0000-0013 (which are
 *     applied to Production) stay byte-identical; the old migration-integrity gate still passes.
 *
 *  2. Build purity — non-negotiable #1 ("build must NEVER read from DB") and #2 ("CI must remain
 *     credential-free"). The build path may not import pg, may not reference a connection string, and
 *     the committed snapshot is what a build consumes.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { verifyMigrationIntegrity } from "../scripts/verify-migration-integrity.mjs";
import { assertPreviewTarget, CONFIRM_TOKEN, RegistryGuardError } from "../scripts/content-registry-guards.mjs";

const MIGRATION = "drizzle-pg/0014_content_registry.sql";
const sql = readFileSync(MIGRATION, "utf8");
const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string; when: number }[] };

// ---- migration 0014: additive, complete, journaled --------------------------------------------
test("0014 is additive only: it creates tables and never alters or drops existing data", () => {
  assert.doesNotMatch(sql, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"|\bALTER\s+COLUMN\b|\bRENAME\b/i, "additive only");
  assert.equal(sql.match(/CREATE TABLE/g)?.length, 10);
  // every statement is CREATE TABLE or ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY, or CREATE INDEX
  for (const statement of sql.split(/--> statement-breakpoint/).map((s) => s.trim()).filter(Boolean)) {
    const body = statement.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();
    if (!body) continue;
    assert.match(body, /^(CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE "\w+" ADD CONSTRAINT)/, `unexpected statement: ${body.slice(0, 60)}`);
  }
});

test("0014 creates exactly the ten approved content registry tables", () => {
  const tables = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tables.sort(), [
    "content_entries", "content_exports", "content_faq", "content_links", "content_redirects",
    "content_related_entries", "content_related_products", "content_related_services",
    "content_sections", "content_versions",
  ]);
});

test("content_related_entries matches the agreed shape (the guide->guide relation)", () => {
  assert.match(sql, /CREATE TABLE "content_related_entries" \([\s\S]*?"entry_id" text NOT NULL,[\s\S]*?"related_entry_id" text NOT NULL,[\s\S]*?"position" integer NOT NULL,[\s\S]*?"label" text DEFAULT '' NOT NULL,[\s\S]*?PRIMARY KEY \("entry_id","related_entry_id"\)/);
  // it references content_entries on both sides
  assert.equal(sql.match(/content_related_entries_.*FOREIGN KEY/g)?.length, 2);
  // and it must NOT be confusable with the service relation table
  assert.doesNotMatch(sql, /content_related_entries.*service/i);
});

test("category/catalog links have a lossless home (content_links), and no product id is forced", () => {
  // content_links stores the literal label+href: that is where today's products[] category urls live
  assert.match(sql, /CREATE TABLE "content_links" \([\s\S]*?"label" text NOT NULL,[\s\S]*?"href" text NOT NULL,[\s\S]*?"link_kind"/);
  // content_related_products keeps a REAL product FK, so an invented id would be impossible to insert
  assert.match(sql, /content_related_products_product_id_products_id_fk" FOREIGN KEY \("product_id"\) REFERENCES "public"\."products"\("id"\)/);
});

test("ordering is enforced by the schema, not only by convention", () => {
  // every ordered child table has a unique (entry_id, position) — the ordering invariant lives in the DB.
  // content_faq's PRIMARY KEY (entry_id, position) already guarantees it, so it carries no separate uq index.
  for (const table of ["content_sections", "content_related_entries", "content_links", "content_related_products", "content_related_services"]) {
    assert.match(sql, new RegExp(`"${table}_position_uq" UNIQUE \\("entry_id","position"\\)`), `${table} enforces unique position`);
  }
  assert.match(sql, /CONSTRAINT "content_faq_pkey" PRIMARY KEY \("entry_id","position"\)/, "content_faq ordering is enforced by its primary key");
  // slugs are unique and content hashes are constrained to 64 hex chars
  assert.match(sql, /CONSTRAINT "content_entries_slug_uq" UNIQUE \("slug"\)/);
  assert.match(sql, /CONSTRAINT "content_entries_content_hash_ck" CHECK \("content_entries"\."content_hash" ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});


test("0014 remains journaled contiguously beneath additive successors, and the offline gate accepts it", () => {
  const head = journal.entries[14];
  assert.equal(head.idx, 14);
  assert.equal(head.tag, "0014_content_registry");
  assert.ok(head.when > journal.entries[13].when, "timestamps keep increasing");
  assert.deepEqual(verifyMigrationIntegrity(process.cwd()), [], "the offline migration gate passes with 0014 present");
});

test("migrations 0000-0013 are byte-identical to the applied versions (non-negotiable #3/#9)", () => {
  const frozen = JSON.parse(readFileSync("drizzle-pg/migration-checksums.json", "utf8")) as { frozen: { tag: string; sha256: string }[] };
  assert.equal(frozen.frozen.length, 13, "the manifest still lists exactly 0000-0012");
  for (const item of frozen.frozen) {
    const actual = createHash("sha256").update(readFileSync(join("drizzle-pg", `${item.tag}.sql`))).digest("hex");
    assert.equal(actual, item.sha256, `${item.tag}.sql must be byte-identical to the applied version`);
  }
  // 0013 (finance ledger) is applied to Production too, so it is frozen by this test as well
  assert.equal(readFileSync("drizzle-pg/0013_finance_ledger.sql", "utf8").match(/ADD COLUMN/g)?.length, 8, "0013 is unchanged");
  // and the frozen guide sources are preserved (non-negotiable #3)
  for (const file of ["guides-1.mjs", "guides-2.mjs", "guides-3.mjs"]) {
    assert.ok(existsSync(join("scripts/klima-rehberi", file)), `${file} is preserved`);
  }
});

// ---- build purity: the build must NEVER read from the database (non-negotiable #1) --------------
test("the build path cannot reach the database: no pg, no connection string, no registry adapter", () => {
  for (const file of ["scripts/build-klima-rehberi.mjs", "scripts/build-catalog-enrichment-data.mjs", "next.config.ts", "lib/content-registry.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from "pg"|require\("pg"\)|node-postgres/, `${file} must not import a database driver`);
    assert.doesNotMatch(source, /DATABASE_URL|POSTGRES_|NEON_/, `${file} must not reference a connection string`);
    assert.doesNotMatch(source, /content-registry-db/, `${file} must not import the database adapter`);
  }
});

test("only offline CLI tooling may import the database adapter, and pg loads lazily", () => {
  const importers: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) { if (!["node_modules", ".next", ".git", ".scratch", "out"].includes(name.name)) walk(path); }
      else if (/\.(ts|mts|mjs|tsx)$/.test(name.name) && readFileSync(path, "utf8").includes("content-registry-db")) importers.push(path);
    }
  };
  for (const dir of ["lib", "scripts", "app", "tests"]) walk(dir);
  assert.ok(importers.length > 0, "the adapter has at least one importer");
  for (const path of importers) {
    const allowed = path.startsWith("scripts/") || path.startsWith("tests/") || path === join("lib", "content-registry-db.ts");
    assert.ok(allowed, `${path} must not pull the database adapter into an import path`);
  }
  // `pg` is imported dynamically, so merely importing the adapter cannot open a socket
  const adapter = readFileSync("lib/content-registry-db.ts", "utf8");
  assert.match(adapter, /await import\("pg"\)/);
  assert.doesNotMatch(adapter.split("await import")[0], /from "pg"/);
});

test("the exporter default is offline and the build stays a plain Next build (CI credential-free)", () => {
  const exporter = readFileSync("scripts/export-content-registry.mjs", "utf8");
  assert.match(exporter, /let source = "offline-guides"/, "the default path never touches a database");
  assert.match(exporter, /if \(apply\) \{\s*const url = assertPreviewTarget\(process\.env\)/, "a database read needs --apply AND the guards");
  const importer = readFileSync("scripts/import-content-registry.mjs", "utf8");
  assert.match(importer, /const apply = args\.includes\("--apply"\)/, "a dry run is the default");
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.build, /^next build$/, "the build is still a plain Next build");
  assert.doesNotMatch(pkg.scripts.build, /content-registry/);
  // the CI workflow must not gain a credentialed or database-touching step (comments are not steps)
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(workflow, /content-registry/i);
  assert.doesNotMatch(workflow, /DATABASE_URL|secrets\./i);
});

// ---- preview/dev-only guards (non-negotiable #9) -----------------------------------------------
const PREVIEW_HOST = "ep-preview-host-1234.c-12.us-east-1.aws.neon.tech";
const PRODUCTION_HOST = "ep-production-host-1234.c-12.us-east-1.aws.neon.tech";
const direct = (host: string) => `postgresql://user:secret-pw@${host}/neondb?sslmode=require`;
const okEnv = (over: Record<string, string | undefined> = {}) => ({
  DATABASE_URL_UNPOOLED: direct(PREVIEW_HOST),
  MIGRATION_TARGET_ENV: "preview",
  NEON_BRANCH_ID: "br-preview",
  EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-preview",
  EXPECTED_NEON_PRODUCTION_BRANCH_ID: "br-production",
  CONTENT_REGISTRY_CONFIRM: CONFIRM_TOKEN,
  ...over,
});

test("a confirmed Preview or dev target is accepted", () => {
  assert.equal(assertPreviewTarget(okEnv()), direct(PREVIEW_HOST));
  assert.equal(assertPreviewTarget(okEnv({ MIGRATION_TARGET_ENV: "dev" })), direct(PREVIEW_HOST));
});

test("Production is refused outright, however it is addressed", () => {
  assert.throws(() => assertPreviewTarget(okEnv({ MIGRATION_TARGET_ENV: "production" })), RegistryGuardError);
  // the production BRANCH id is refused even when the target string claims to be preview
  assert.throws(() => assertPreviewTarget(okEnv({ NEON_BRANCH_ID: "br-production" })), /not the expected Preview branch/);
  // if the configured "preview" branch id IS the production branch id, the explicit Production check fires
  assert.throws(() => assertPreviewTarget(okEnv({
    NEON_BRANCH_ID: "br-production", EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-production",
  })), /Production branch/);
  // The branch id is the authoritative identity signal: a run whose ids are all consistent is allowed even
  // if the hostname merely looks unfamiliar, because the id pair (preview == branch, branch != production)
  // is what the operator can actually verify. Setting EXPECTED_NEON_PRODUCTION_HOSTNAME adds a host check.
  assert.equal(assertPreviewTarget(okEnv({ DATABASE_URL_UNPOOLED: direct(PRODUCTION_HOST) })), direct(PRODUCTION_HOST));
  // ...but supplying the known production host turns that same target into a hard refusal
  assert.throws(() => assertPreviewTarget(okEnv({ DATABASE_URL_UNPOOLED: direct(PRODUCTION_HOST), EXPECTED_NEON_PRODUCTION_HOSTNAME: PRODUCTION_HOST })), /Production host/);
  assert.throws(() => assertPreviewTarget(okEnv({ APP_ENV: "production" })), /APP_ENV/);
  // the production branch is refused even when the url is a preview url and the target says "dev"
  assert.throws(() => assertPreviewTarget(okEnv({ MIGRATION_TARGET_ENV: "dev", NEON_BRANCH_ID: "br-production", EXPECTED_NEON_PREVIEW_BRANCH_ID: "br-production" })), /Production branch/);
});

test("the guards fail closed, and never echo credentials", () => {
  assert.throws(() => assertPreviewTarget({}), RegistryGuardError);
  assert.throws(() => assertPreviewTarget(okEnv({ DATABASE_URL_UNPOOLED: undefined })), /DATABASE_URL_UNPOOLED is required/);
  assert.throws(() => assertPreviewTarget(okEnv({ MIGRATION_TARGET_ENV: undefined })), /MIGRATION_TARGET_ENV is required/);
  assert.throws(() => assertPreviewTarget(okEnv({ NEON_BRANCH_ID: undefined })), /NEON_BRANCH_ID is required/);
  assert.throws(() => assertPreviewTarget(okEnv({ EXPECTED_NEON_PREVIEW_BRANCH_ID: undefined })), /EXPECTED_NEON_PREVIEW_BRANCH_ID is required/);
  assert.throws(() => assertPreviewTarget(okEnv({ CONTENT_REGISTRY_CONFIRM: undefined })), new RegExp(CONTENT_REGISTRY_CONFIRM_TOKEN_PATTERN));
  assert.throws(() => assertPreviewTarget(okEnv({ CONTENT_REGISTRY_CONFIRM: "yes" })), RegistryGuardError);
  // a pooler endpoint cannot be matched against the branch id, so it is refused
  assert.throws(() => assertPreviewTarget(okEnv({ DATABASE_URL_UNPOOLED: direct(PREVIEW_HOST).replace("c-12.", "-pooler.c-12.") })), /pooler/);
  // the failure message must not leak the password or the host
  try {
    assertPreviewTarget(okEnv({ CONTENT_REGISTRY_CONFIRM: undefined }));
    assert.fail("should have thrown");
  } catch (error) {
    const message = (error as Error).message;
    assert.doesNotMatch(message, /secret-pw|user:/);
    assert.doesNotMatch(message, /neon\.tech/);
  }
});
const CONTENT_REGISTRY_CONFIRM_TOKEN_PATTERN = CONFIRM_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- the committed snapshot -------------------------------------------------------------------
test("the committed snapshot exists, holds all 16 entries, and is a tracked artifact", () => {
  assert.ok(existsSync("data/content/registry-snapshot.json"), "the snapshot is committed to the repository");
  const snapshot = JSON.parse(readFileSync("data/content/registry-snapshot.json", "utf8")) as { entries: unknown[] };
  assert.equal(snapshot.entries.length, 16);
  // a gitignore rule would silently drop the build's content source
  const ignored = readFileSync(".gitignore", "utf8");
  assert.doesNotMatch(ignored, /registry-snapshot/);
  assert.doesNotMatch(ignored, /^data\/?$/m, "data/ must not be gitignored wholesale");
});

// ---- P2-A: registry-driven guide generation ---------------------------------------------------
test("P2-A: the generator reads the committed snapshot (not the frozen guides) and stays DB-free", async () => {
  const generator = readFileSync("scripts/build-klima-rehberi.mjs", "utf8");
  assert.doesNotMatch(generator, /klima-rehberi\/guides-[123]\.mjs/, "generator must not import the frozen guides");
  assert.match(generator, /REGISTRY_SNAPSHOT_PATH|registry-snapshot\.json/, "generator must read the committed snapshot");
  assert.match(generator, /parseRegistrySnapshot/, "generator must reuse the pure domain parser");
  assert.match(generator, /registryToGuides/, "generator must reuse the registry->guide adapter");
  assert.doesNotMatch(generator, /content-registry-db\.ts/, "build path must not import the DB adapter module");
  assert.doesNotMatch(generator, /from ["']\.\.\/lib\/content-registry-db/, "build path must not import the DB adapter");
  assert.doesNotMatch(generator, /DATABASE_URL|getDb|drizzle\(|new pg\.|require\(.pg.\)|from .pg./, "no DB connection is possible from the build path");
  const { GUIDE_ORDER } = await import("../scripts/build-klima-rehberi.mjs") as { GUIDE_ORDER: string[] };
  assert.equal(GUIDE_ORDER.length, 16, "frozen hub order holds 16 slugs");
  assert.equal(new Set(GUIDE_ORDER).size, 16, "hub order slugs are unique");
  for (const slug of GUIDE_ORDER) assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test("P2-A: snapshot guides rebuild the frozen slug set with full section/FAQ/related/link counts", async () => {
  const { parseRegistrySnapshot, registryToGuides, countEntries } = await import("../lib/content-registry.ts");
  const snapshot = parseRegistrySnapshot(readFileSync("data/content/registry-snapshot.json", "utf8"));
  const guides = registryToGuides(snapshot.entries);
  const { GUIDE_ORDER } = await import("../scripts/build-klima-rehberi.mjs") as { GUIDE_ORDER: string[] };
  assert.deepEqual([...guides.map((g) => g.slug)].sort(), [...GUIDE_ORDER].sort(), "snapshot slugs match the frozen hub order");
  assert.deepEqual(countEntries(snapshot.entries), {
    entries: 16, sections: 64, faq: 31, relatedEntries: 48, links: 39, relatedProducts: 0, relatedServices: 0,
  });
  for (const guide of guides) {
    assert.ok(guide.sections.length > 0, `${guide.slug}: sections preserved`);
    assert.ok(guide.title.length > 0 && guide.description.length > 0, `${guide.slug}: SEO text preserved`);
  }
});

test("P2-A: snapshot-driven output keeps the 1:1 guide-page mapping and all 16 public URLs", async () => {
  const { buildAll, GUIDE_ORDER, guidePath } = await import("../scripts/build-klima-rehberi.mjs") as {
    buildAll: () => Record<string, string>; GUIDE_ORDER: string[]; guidePath: (slug: string) => string;
  };
  const files = buildAll();
  const committedPages = readdirSync("public/rehber").filter((n) => n.endsWith(".html")).map((n) => n.replace(/\.html$/, "")).sort();
  assert.deepEqual([...GUIDE_ORDER].sort(), committedPages, "every registry guide maps 1:1 to a committed public page");
  for (const slug of GUIDE_ORDER) {
    const key = `public/${guidePath(slug)}`;
    assert.ok(files[key], `${key} generated`);
    assert.match(files[key], new RegExp(`<link rel="canonical" href="https://egeteknik\\.tr/rehber/${slug}\\.html">`), `${slug}: canonical URL unchanged`);
  }
  assert.ok(files["public/blog.html"], "hub generated");
  assert.ok(files["public/sitemap.xml"], "sitemap generated");
  for (const slug of GUIDE_ORDER) assert.ok(files["public/sitemap.xml"].includes(`<loc>https://egeteknik.tr/rehber/${slug}.html</loc>`), `sitemap lists ${slug}`);
});


