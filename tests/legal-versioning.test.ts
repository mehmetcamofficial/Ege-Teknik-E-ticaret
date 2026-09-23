import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { canonicalizeLegalDocument, canonicalizeLegalText, hashLegalDocument } from "../lib/legal.ts";

const migration = readFileSync("drizzle-pg/0003_legal_document_versioning.sql", "utf8");
const schema = readFileSync("db/schema.ts", "utf8");
const doc = { title: "Mesafeli Satış Sözleşmesi", body: "Madde 1\nMadde 2" };

test("hash is deterministic SHA-256 hex", () => {
  assert.equal(hashLegalDocument(doc), hashLegalDocument({ ...doc }));
  assert.match(hashLegalDocument(doc), /^[0-9a-f]{64}$/);
});

test("canonicalization ignores line-ending style, trailing whitespace and outer blank lines", () => {
  const variant = { title: "Mesafeli Satış Sözleşmesi  ", body: "\r\nMadde 1 \r\nMadde 2\r\n\r\n" };
  assert.equal(canonicalizeLegalDocument(variant), canonicalizeLegalDocument(doc));
  assert.equal(hashLegalDocument(variant), hashLegalDocument(doc));
});

test("canonicalization normalizes Unicode to NFC", () => {
  assert.equal(canonicalizeLegalText("İ"), canonicalizeLegalText("İ".normalize("NFD")));
  assert.equal(canonicalizeLegalText("é"), "é");
});

test("meaningful content changes change the hash", () => {
  const base = hashLegalDocument(doc);
  assert.notEqual(hashLegalDocument({ ...doc, body: "Madde 1\nMadde 3" }), base);
  assert.notEqual(hashLegalDocument({ ...doc, title: "Ön Bilgilendirme Formu" }), base);
  assert.notEqual(hashLegalDocument({ ...doc, body: "Madde 1\n\nMadde 2" }), base);
});

test("schema and migration enforce slug uniqueness", () => {
  assert.match(schema, /uniqueIndex\("legal_documents_slug_uq"\)\.on\(t\.slug\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "legal_documents_slug_uq" ON "legal_documents" USING btree \("slug"\)/);
});

test("schema and migration enforce unique (document_id, version)", () => {
  assert.match(schema, /uniqueIndex\("legal_document_versions_doc_version_uq"\)\.on\(t\.documentId,t\.version\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "legal_document_versions_doc_version_uq" ON "legal_document_versions" USING btree \("document_id","version"\)/);
});

test("schema and migration enforce unique (order_id, document_version_id)", () => {
  assert.match(schema, /uniqueIndex\("order_legal_acceptances_order_version_uq"\)\.on\(t\.orderId,t\.documentVersionId\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "order_legal_acceptances_order_version_uq" ON "order_legal_acceptances" USING btree \("order_id","document_version_id"\)/);
});

test("legal tables carry no IP or user-agent columns", () => {
  const legalSchema = schema.split("\n").filter((line) => /legal/i.test(line)).join("\n");
  assert.doesNotMatch(legalSchema, /ip|user_?agent/i);
});

test("no application code mutates published legal versions", () => {
  const files = ["app", "lib", "components"].flatMap((dir) => {
    try {
      return (readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => `${dir}/${f}`);
    } catch {
      return [];
    }
  });
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!/legalDocumentVersions/.test(source)) continue;
    assert.doesNotMatch(source, /\.(update|delete)\(\s*legalDocumentVersions\s*\)/, `${file} must not update/delete legal versions`);
  }
});

test("migration is additive: no destructive or data-writing SQL", () => {
  const withoutFkActions = migration.replace(/ON DELETE no action ON UPDATE no action/g, "");
  for (const keyword of ["DROP", "TRUNCATE", "DELETE", "UPDATE", "INSERT", "ALTER COLUMN", "RENAME"]) {
    assert.doesNotMatch(withoutFkActions, new RegExp(`\\b${keyword}\\b`, "i"), `migration must not contain ${keyword}`);
  }
});
