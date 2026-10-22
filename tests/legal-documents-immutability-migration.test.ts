import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyMigrationIntegrity } from "../scripts/verify-migration-integrity.mjs";

const migrationPath = "drizzle-pg/0016_legal_documents_immutability_guard.sql";
const migration = readFileSync(migrationPath, "utf8");

test("0016 is registered as the next migration without modifying the frozen chain", () => {
  const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8"));
  assert.equal(journal.entries[16]?.idx, 16);
  assert.equal(journal.entries[16]?.tag, "0016_legal_documents_immutability_guard");
  assert.deepEqual(verifyMigrationIntegrity(process.cwd()), []);
});

test("0016 protects legal document identity and created_at on every UPDATE", () => {
  assert.match(migration, /CREATE FUNCTION public\.legal_documents_immutable_guard\(\)/);
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /SET search_path = pg_catalog, public/);
  assert.match(migration, /ROW\(NEW\.id, NEW\.slug, NEW\.created_at\) IS DISTINCT FROM\s+ROW\(OLD\.id, OLD\.slug, OLD\.created_at\)/);
  assert.match(migration, /RAISE EXCEPTION[\s\S]*?ERRCODE = '23514'/);
  assert.match(migration, /CREATE TRIGGER legal_documents_immutable_guard_trg\s+BEFORE UPDATE ON public\.legal_documents\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.legal_documents_immutable_guard\(\)/);
});

test("0016 has no data rewrite or privilege escalation", () => {
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE|INSERT|GRANT|REVOKE)\b/i);
  assert.doesNotMatch(migration, /\bSECURITY DEFINER\b/i);
  assert.doesNotMatch(migration, /\bALTER TABLE\b|\bUPDATE\s+public\./i);
});
