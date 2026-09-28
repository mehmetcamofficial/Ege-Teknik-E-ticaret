#!/usr/bin/env node
/**
 * Migration integrity gate (offline: reads files only, never opens a database connection).
 *
 * Frozen migrations 0000-0012 are applied to Production; their SQL must never change. The frozen list in
 * drizzle-pg/migration-checksums.json is compared against the files, the drizzle journal and the well-known
 * 0011 / 0012 hashes. Migrations after 0012 are allowed, but the numbering must stay contiguous, the journal must
 * list exactly the SQL files present, and journal timestamps must keep increasing.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const MIGRATION_0011_SHA256 = "f740bd31ff771742ed335aa2c2f1c3f4c44d03d30dcc9c4488c612a2c95d7626";
export const MIGRATION_0012_SHA256 = "70f1d12ff909a8377dac4bad436fee1155456c82f433bc9259c64b2b4a03c3cb";
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** @returns {string[]} human-readable problems; empty = OK */
export function verifyMigrationIntegrity(root = process.cwd()) {
  const dir = join(root, "drizzle-pg");
  const problems = [];
  const manifestPath = join(dir, "migration-checksums.json");
  const journalPath = join(dir, "meta", "_journal.json");
  if (!existsSync(manifestPath)) return ["drizzle-pg/migration-checksums.json is missing"];
  if (!existsSync(journalPath)) return ["drizzle-pg/meta/_journal.json is missing"];
  const { frozen } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { entries } = JSON.parse(readFileSync(journalPath, "utf8"));

  if (frozen.length !== 13) problems.push(`the frozen manifest must list migrations 0000-0012 (found ${frozen.length})`);
  frozen.forEach((item, i) => {
    const name = `${String(i).padStart(4, "0")}`;
    if (item.idx !== i || !item.tag.startsWith(`${name}_`)) problems.push(`frozen entry ${i} is out of order (${item.tag})`);
    const file = join(dir, `${item.tag}.sql`);
    if (!existsSync(file)) return problems.push(`frozen migration ${item.tag}.sql is missing`);
    if (sha256(readFileSync(file)) !== item.sha256) problems.push(`frozen migration ${item.tag}.sql was MODIFIED (hash differs from the applied version)`);
    const entry = entries[i];
    if (!entry || entry.tag !== item.tag || entry.when !== item.when) problems.push(`journal entry ${i} no longer matches the frozen ${item.tag}`);
  });
  const by = Object.fromEntries(frozen.map((f) => [f.idx, f.sha256]));
  if (by[11] !== MIGRATION_0011_SHA256) problems.push("the manifest's 0011 hash differs from the reviewed constant");
  if (by[12] !== MIGRATION_0012_SHA256) problems.push("the manifest's 0012 hash differs from the reviewed constant");

  const files = readdirSync(dir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  if (files.length !== entries.length) problems.push(`journal lists ${entries.length} migrations but ${files.length} SQL files exist`);
  entries.forEach((entry, i) => {
    if (entry.idx !== i) problems.push(`journal idx ${entry.idx} is not contiguous at position ${i}`);
    if (files[i] !== `${entry.tag}.sql`) problems.push(`journal entry ${entry.tag} does not match SQL file ${files[i] ?? "(none)"}`);
    if (i > 0 && !(entry.when > entries[i - 1].when)) problems.push(`journal timestamp for ${entry.tag} does not increase`);
    if (i >= 13 && !existsSync(join(dir, `${entry.tag}.sql`))) problems.push(`new migration ${entry.tag}.sql is missing`);
  });
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = verifyMigrationIntegrity();
  if (problems.length) {
    console.error("[migration-integrity] FAIL:\n - " + problems.join("\n - "));
    process.exit(1);
  }
  console.log("[migration-integrity] OK: migrations 0000-0012 are byte-identical to the applied versions; journal is consistent.");
}
