import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";
import { hashLegalDocument } from "../lib/legal.ts";
import { deriveLegalStatus, legalDraftPatchSchema, legalDraftSchema, legalPublishSchema, validateEffectiveAt, LEGAL_DOCUMENT_SLUGS, type AdminLegalVersionRow } from "../lib/legal-admin.ts";
import { adminRoles, roleHasPermission } from "../lib/security-policy.ts";

const schema = readFileSync("db/schema.ts", "utf8");
const migration = readFileSync("drizzle-pg/0005_legal_drafts_and_immutability.sql", "utf8");
const adminDb = readFileSync("lib/legal-admin-db.ts", "utf8");
const legalRouteFiles = globSync("app/api/admin/legal/**/route.ts");
const now = new Date("2026-09-24T12:00:00Z");
const d = (s: string) => new Date(s);
const row = (version: number, published: string | null, effective: string | null): AdminLegalVersionRow => ({ id: `v${version}`, version, title: "t", contentHash: "h", publishedAt: published ? d(published) : null, effectiveAt: effective ? d(effective) : null, publishedBy: published ? "admin" : null });

// ---- schema / migration -------------------------------------------------------------------------
test("draft schema: publication columns are nullable and there is no status column", () => {
  const line = schema.split("\n").find((l) => l.startsWith("export const legalDocumentVersions"))!;
  for (const col of ["effective_at", "published_at", "published_by"]) assert.doesNotMatch(line.match(new RegExp(`"${col}"[^,]*,?[^,]*`))![0], /notNull/, `${col} must be nullable`);
  assert.doesNotMatch(line, /"status"/);
  assert.match(line, /legal_document_versions_publication_ck/);
});
test("migration 0005 relaxes the three columns and adds the consistency CHECK", () => {
  for (const col of ["effective_at", "published_at", "published_by"]) assert.match(migration, new RegExp(`ALTER COLUMN "${col}" DROP NOT NULL`));
  assert.match(migration, /"published_at" IS NULL AND "legal_document_versions"\."published_by" IS NULL/);
  assert.match(migration, /"published_at" IS NOT NULL AND "legal_document_versions"\."published_by" IS NOT NULL AND "legal_document_versions"\."effective_at" IS NOT NULL/);
});
test("migration 0005 contains no destructive or data-writing SQL", () => {
  for (const kw of ["DROP TABLE", "DROP COLUMN", "TRUNCATE", "INSERT", "RENAME"]) assert.doesNotMatch(migration, new RegExp(`\\b${kw}\\b`, "i"), kw);
  assert.doesNotMatch(migration.replace(/BEFORE UPDATE OR DELETE|TG_OP = 'UPDATE'|TG_OP = 'DELETE'|IS DISTINCT/g, ""), /^\s*(UPDATE|DELETE FROM)\b/im);
  assert.doesNotMatch(migration, /order_legal_acceptances/, "acceptance history is never touched");
  assert.doesNotMatch(migration, /DROP TRIGGER|DROP FUNCTION/i);
});
test("the immutability trigger blocks UPDATE/DELETE of published rows only, so draft->published is allowed", () => {
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "legal_document_versions" FOR EACH ROW/);
  assert.match(migration, /IF OLD\."published_at" IS NOT NULL THEN\s+RAISE EXCEPTION/); // keyed on the OLD row: a draft (OLD.published_at NULL) passes
  assert.doesNotMatch(migration, /NEW\."published_at"/, "must not inspect NEW.published_at, which would block the publish transition");
  assert.match(migration, /RETURN NEW;/);
});

// ---- derived status / publishing rules -----------------------------------------------------------
test("status is derived: draft / scheduled / effective / superseded", () => {
  const rows = [row(1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"), row(2, "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z"), row(3, "2026-09-01T00:00:00Z", "2027-01-01T00:00:00Z"), row(4, null, null)];
  assert.deepEqual(rows.map((r) => deriveLegalStatus(r, rows, now)), ["superseded", "effective", "scheduled", "draft"]);
});
test("a future-effective version does not supersede the current one until it takes effect", () => {
  const rows = [row(1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"), row(2, "2026-09-01T00:00:00Z", "2027-01-01T00:00:00Z")];
  assert.equal(deriveLegalStatus(rows[0], rows, now), "effective");
  assert.equal(deriveLegalStatus(rows[0], rows, d("2027-01-02T00:00:00Z")), "superseded");
});
test("effective_at must be explicit, not retroactive and not absurdly far ahead", () => {
  assert.equal(validateEffectiveAt(d("2026-10-01T00:00:00Z"), now).ok, true);
  assert.equal(validateEffectiveAt(new Date(now.getTime() - 60_000), now).ok, true);
  assert.equal(validateEffectiveAt(d("2026-01-01T00:00:00Z"), now).ok, false);
  assert.equal(validateEffectiveAt(d("2099-01-01T00:00:00Z"), now).ok, false);
  assert.equal(legalPublishSchema.safeParse({}).success, false);
  assert.equal(legalPublishSchema.safeParse({ effectiveAt: "tomorrow" }).success, false);
  assert.equal(legalPublishSchema.safeParse({ effectiveAt: "2026-10-01T00:00:00+03:00" }).success, true);
});
test("client cannot supply hash, publisher, timestamps or version: schemas strip them", () => {
  const parsed = legalDraftSchema.parse({ title: "Başlık", body: "Metin gövdesi burada", contentHash: "x", publishedBy: "evil", publishedAt: "2020-01-01", version: 99, id: "z" });
  assert.deepEqual(Object.keys(parsed).sort(), ["body", "title"]);
  assert.deepEqual(Object.keys(legalPublishSchema.parse({ effectiveAt: "2026-10-01T00:00:00Z", publishedBy: "evil", contentHash: "x" })), ["effectiveAt"]);
  assert.equal(legalDraftPatchSchema.safeParse({}).success, false);
});
test("startable slugs cover the two checkout documents", () => {
  for (const slug of ["distance-sales", "pre-information"]) assert.ok((LEGAL_DOCUMENT_SLUGS as readonly string[]).includes(slug));
});

// ---- server-side write path ----------------------------------------------------------------------
test("publish computes the hash from stored content and takes publisher/time from the server", () => {
  const publish = adminDb.slice(adminDb.indexOf("export async function publishLegalDraft"));
  assert.match(publish, /hashLegalDocument\(\{ title: row\.title, body: row\.body \}\)/);
  assert.match(publish, /publishedAt: now, publishedBy: actor\.userId/);
  assert.match(publish, /isNull\(legalDocumentVersions\.publishedAt\)/);
  assert.match(publish, /\.for\("update"\)/);
  assert.match(publish, /"LEGAL_VERSION_PUBLISHED"/);
  assert.match(publish, /getDb\(\)\.transaction/);
});
test("hash is canonical SHA-256 and changes with content", () => {
  assert.match(hashLegalDocument({ title: "a", body: "b" }), /^[0-9a-f]{64}$/);
  assert.notEqual(hashLegalDocument({ title: "a", body: "b" }), hashLegalDocument({ title: "a", body: "c" }));
});
test("every UPDATE/DELETE of legal versions is restricted to drafts", () => {
  const writes = adminDb.match(/\.(update|delete)\(legalDocumentVersions\)[\s\S]*?\.returning/g) ?? [];
  assert.equal(writes.length, 3); // update draft, delete draft, publish
  for (const w of writes) assert.match(w, /isNull\(legalDocumentVersions\.publishedAt\)/);
});
test("draft creation is serialized (row lock) with the unique version index as backstop, and audited", () => {
  const create = adminDb.slice(adminDb.indexOf("export async function createLegalDraft"), adminDb.indexOf("export async function updateLegalDraft"));
  assert.match(create, /\.for\("update"\)/);
  assert.match(create, /coalesce\(max\(/);
  assert.match(create, /"LEGAL_VERSION_CREATED"/);
  assert.match(schema, /legal_document_versions_doc_version_uq/);
});
test("audit payloads carry safe identifiers only, never the body", () => {
  const audits = adminDb.match(/audit\(tx,[^\n]*\n/g) ?? [];
  assert.ok(audits.length >= 4);
  for (const a of audits) assert.doesNotMatch(a, /\bbody\b/);
  assert.match(adminDb, /entityType: "legal_document_version"/);
});

// ---- RBAC ----------------------------------------------------------------------------------------
test("legal:write belongs to super_admin and the frozen legacy owner only - never to admin", () => {
  assert.equal(roleHasPermission("super_admin", "legal:write"), true);
  assert.equal(roleHasPermission("owner", "legal:write"), true, "the frozen legacy row keeps its pre-6D.1 permission");
  assert.equal(roleHasPermission("admin", "legal:write"), false, "admin is operational and must never publish legal documents");
  for (const role of adminRoles.filter((r) => r !== "owner" && r !== "super_admin")) assert.equal(roleHasPermission(role, "legal:write"), false, role);
  assert.equal(roleHasPermission("catalog_manager", "content:write"), true, "content:write is not repurposed");
});
test("every admin legal endpoint is wrapped by the legal:write guard (no session => 403)", () => {
  assert.ok(legalRouteFiles.length >= 5);
  for (const f of legalRouteFiles) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/export (?:const|async function) (GET|POST|PATCH|PUT|DELETE)\b([^\n]*)/g)) assert.match(m[2], /legalAdminRoute/, `${f} ${m[1]} must use legalAdminRoute`);
  }
  const guard = readFileSync("lib/legal-admin-http.ts", "utf8");
  assert.match(guard, /getAdminUser\("legal:write"\)/);
  assert.match(guard, /if \(!admin\) return Response\.json\(\{ error: "Yetkisiz erişim" \}, \{ status: 403 \}\)/);
  assert.ok(guard.indexOf("getAdminUser") < guard.indexOf("await handler"), "authorization precedes the handler");
});
test("no route can update or delete a published version, or set publication fields directly", () => {
  const verbs = legalRouteFiles.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => `${f.replace("app/api/admin/legal/", "")}:${m[1]}`)).sort();
  assert.deepEqual(verbs, ["documents/[slug]/versions/route.ts:GET", "documents/[slug]/versions/route.ts:POST", "documents/route.ts:GET", "versions/[id]/preview/route.ts:GET", "versions/[id]/publish/route.ts:POST", "versions/[id]/route.ts:DELETE", "versions/[id]/route.ts:GET", "versions/[id]/route.ts:PATCH"]);
  for (const f of legalRouteFiles) assert.doesNotMatch(readFileSync(f, "utf8"), /legalDocumentVersions|getDb/, `${f} must go through lib/legal-admin-db.ts`);
});
test("admin UI section is rendered only for legal:write holders and published versions are read-only", () => {
  // Admin Panel V2: the legal module is its own route, and the page refuses to render (server-side,
  // before LegalAdmin) without legal:write - stronger than the old client-side prop toggle.
  const page = readFileSync("app/admin/(panel)/legal/page.tsx", "utf8");
  assert.match(page, /await requireAdminPage\("legal:write"\)/);
  assert.ok(page.indexOf('requireAdminPage("legal:write")') < page.indexOf("<LegalAdmin"), "authorization precedes rendering");
  assert.match(readFileSync("lib/admin-ui.ts", "utf8"), /href: "\/admin\/legal", label: "Hukuki Belgeler", icon: "legal", permission: "legal:write"/, "nav entry is hidden from non-owners");
  const renderers = globSync("app/admin/**/*.tsx").filter((f) => readFileSync(f, "utf8").includes("<LegalAdmin")).sort();
  assert.deepEqual(renderers, ["app/admin/(panel)/legal/page.tsx"], "no other admin screen renders the legal module");
  const ui = readFileSync("app/admin/legal-admin.tsx", "utf8");
  assert.match(ui, /readOnly=\{!isDraft\}/);
  assert.match(ui, /\{isDraft && </);
});

// ---- public side ---------------------------------------------------------------------------------
test("public loaders exclude drafts in SQL and preview is auth-only", () => {
  const db = readFileSync("lib/legal-db.ts", "utf8");
  assert.equal((db.match(/isNotNull\(legalDocumentVersions\.publishedAt\)/g) ?? []).length, 3);
  assert.doesNotMatch(readFileSync("app/legal/[slug]/route.ts", "utf8"), /renderLegalDraftPreview/);
});
test("checkout is unchanged: still resolves required versions server-side and links exact versions", () => {
  const orders = readFileSync("app/api/orders/route.ts", "utf8");
  assert.match(orders, /loadRequiredCheckoutLegalVersions/);
  assert.match(orders, /acceptedAt = new Date\(\)/);
  assert.match(readFileSync("public/store.js", "utf8"), /function legalVersionHref\(d\)/);
});
