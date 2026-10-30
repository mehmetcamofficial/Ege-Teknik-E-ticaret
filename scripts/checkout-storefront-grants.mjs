/**
 * TEST-ONLY helper: the checkout storefront grants of docs/ops/checkout-storefront-grants-20261029.sql, applied to a role on a DISPOSABLE database.
 * The SQL file is the single source; every disposable gate (HTTP E2E, H4, H5, PR37, ACL matrix) reads it through here instead of keeping its own copy.
 * It only builds statements. Connecting is the caller's business, and the caller is responsible for the database being disposable.
 */
import { readFileSync } from "node:fs";

export const STOREFRONT_GRANTS_FILE = new URL("../docs/ops/checkout-storefront-grants-20261029.sql", import.meta.url);
const ROLE_NAME = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const PLACEHOLDER = ':"storefront_role"';

/** The grant statements for `role`, in file order, comments removed. Throws on an unusable role name or a file that has drifted from the expected shape. */
export function storefrontGrantStatements(role, source = readFileSync(STOREFRONT_GRANTS_FILE, "utf8")) {
  if (typeof role !== "string" || !ROLE_NAME.test(role)) throw new Error("invalid storefront role name");
  const statements = source.split("\n").filter((line) => !/^\s*--/.test(line) && line.trim()).join("\n")
    .split(/;[ \t]*(?:\n|$)/).map((statement) => statement.trim()).filter(Boolean);
  if (!statements.length) throw new Error("no storefront grants found");
  for (const statement of statements) {
    if (!/^GRANT /.test(statement) || !statement.includes(PLACEHOLDER) || statement.includes(";")) throw new Error("unexpected statement in the storefront grants file");
  }
  return statements.map((statement) => statement.replaceAll(PLACEHOLDER, `"${role}"`));
}

/** Applies the canonical storefront grants through `query` (an owner/admin connection to the disposable database). */
export async function applyStorefrontGrants(query, role) {
  for (const statement of storefrontGrantStatements(role)) await query(statement);
}
