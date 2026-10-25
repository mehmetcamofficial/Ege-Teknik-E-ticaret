/**
 * The operator SQL for the dedicated notification-worker identity (docs/ops/notification-worker-grants-20261024.sql), textually
 * substituted for a DISPOSABLE test database. Shared by the real-HTTP suites that need a worker (scripts/test-pr37-worker-http.mjs,
 * scripts/test-h5-notifications-http.mjs) so they all test the SAME least-privilege grants the operator would run - never a hand-written
 * copy that could drift or quietly be more generous. The file has no psql meta-commands, so a plain replace is enough; identifiers are
 * validated and the password is escaped as a string literal. Nothing is executed or printed here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const GRANTS_FILE = "docs/ops/notification-worker-grants-20261024.sql";
const ident = (value) => { assert.match(value, /^[a-z][a-z0-9_]{2,62}$/, "invalid SQL identifier"); return `"${value}"`; };

/** @param {{ database: string, group: string, login: string, password: string }} names */
export function workerOperatorSql({ database, group, login, password }) {
  const sql = readFileSync(GRANTS_FILE, "utf8")
    .replaceAll(':"dbname"', ident(database)).replaceAll(':"worker_role"', ident(group)).replaceAll(':"worker_login"', ident(login))
    .replaceAll(":'worker_password'", `'${password.replaceAll("'", "''")}'`);
  assert.doesNotMatch(sql, /:"[a-z_]+"|:'[a-z_]+'/, "all operator SQL placeholders were substituted");
  return sql;
}
