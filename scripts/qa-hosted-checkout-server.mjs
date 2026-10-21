#!/usr/bin/env node
/**
 * Ege Teknik hosted QA-only localhost Next.js process.
 * NO schema reset, migrations, fixtures, traffic generation or payment calls.
 * This runner starts the app with checkout scoped access ONLY after fail-closed
 * database endpoint + role checks. It never logs credentials.
 *
 * Required private shell env:
 *   QA_NEON_BRANCH_ID, QA_OWNER_DATABASE_URL,
 *   QA_STOREFRONT_DATABASE_URL, QA_ADMIN_DATABASE_URL,
 *   LEGAL_PREVIEW_SIGNING_SECRET, IP_HASH_SALT
 *
 * Run from repository root: node scripts/qa-hosted-checkout-server.mjs
 * Before use: node scripts/qa-hosted-checkout-preflight.mjs
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import pg from "pg";

const expected = {
  branch: "br-delicate-frost-awnf26nw",
  db: "neondb",
  roles: {
    QA_OWNER_DATABASE_URL: "neondb_owner",
    QA_STOREFRONT_DATABASE_URL: "ege_qa_storefront_login",
    QA_ADMIN_DATABASE_URL: "ege_qa_admin_login",
  },
  hosts: new Set([
    "ep-square-dust-awrzxg05.c-12.us-east-1.aws.neon.tech",
    "ep-square-dust-awrzxg05-pooler.c-12.us-east-1.aws.neon.tech",
  ]),
};
const fail = (message) => { throw new Error(message); };
const required = (key) => {
  const value = process.env[key];
  if (!value) fail(`${key} is not configured in the private shell`);
  return value;
};
const urls = {};
if (process.env.QA_NEON_BRANCH_ID !== expected.branch) fail("QA branch identifier mismatch");
if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.CI) {
  fail("Refusing CI, Vercel and remote deployment environments");
}
// Next dev merges .env files. Refuse those so a preexisting production secret
// cannot override the supplied isolated QA configuration.
for (const file of [".env", ".env.local", ".env.development", ".env.development.local"]) {
  if (existsSync(file)) fail(`Remove/relocate ${file} before this QA-only runner; never print its content`);
}
for (const [key, role] of Object.entries(expected.roles)) {
  const value = required(key);
  let uri;
  try { uri = new URL(value); } catch { fail(`${key} is not a valid database URL`); }
  if (!["postgres:", "postgresql:"].includes(uri.protocol)
    || !expected.hosts.has(uri.hostname)
    || uri.pathname !== `/${expected.db}`
    || uri.username !== role || !uri.password
    || uri.searchParams.get("sslmode") === "disable") {
    fail(`${key} does not exactly match approved QA host, database and role`);
  }
  urls[key] = value;
}
if (new URL(urls.QA_STOREFRONT_DATABASE_URL).hostname.replace("-pooler.", ".")
  !== new URL(urls.QA_OWNER_DATABASE_URL).hostname.replace("-pooler.", ".")
  || new URL(urls.QA_ADMIN_DATABASE_URL).hostname.replace("-pooler.", ".")
  !== new URL(urls.QA_OWNER_DATABASE_URL).hostname.replace("-pooler.", ".")) {
  fail("QA connection hosts must resolve to one isolated endpoint");
}
for (const key of ["LEGAL_PREVIEW_SIGNING_SECRET", "IP_HASH_SALT"]) {
  if (required(key).length < 24) fail(`${key} must be a securely generated temporary test secret`);
}
if (process.env.QA_HTTP_HOST && process.env.QA_HTTP_HOST !== "127.0.0.1") fail("QA HTTP server must bind to loopback");
const port = Number(process.env.QA_HTTP_PORT || "43731");
if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("Invalid QA_HTTP_PORT");

const owner = new pg.Client({
  connectionString: urls.QA_OWNER_DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
const storefront = new pg.Client({
  connectionString: urls.QA_STOREFRONT_DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
const admin = new pg.Client({
  connectionString: urls.QA_ADMIN_DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
try {
  await Promise.all([owner.connect(), storefront.connect(), admin.connect()]);
  const identities = await Promise.all([owner, storefront, admin].map(c =>
    c.query("SELECT current_user AS role, current_database() AS db")));
  if (identities.some((result, i) =>
    result.rows[0]?.db !== expected.db
    || result.rows[0]?.role !== Object.values(expected.roles)[i])) {
    fail("Database runtime identity mismatch");
  }
  const migration = await owner.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
  if (migration.rows[0]?.n !== 20) fail("QA migration head changed; review before launch");
  const acl = await owner.query(`SELECT
    has_table_privilege($1,'public.orders','SELECT') AS orders_select,
    has_table_privilege($1,'public.order_items','SELECT') AS items_select,
    has_table_privilege($1,'public.order_legal_acceptances','SELECT') AS evidence_select,
    has_function_privilege($1,'public.checkout_replay_by_key(text,text)','EXECUTE') AS replay_execute`, [expected.roles.QA_STOREFRONT_DATABASE_URL]);
  if (acl.rows[0]?.orders_select || acl.rows[0]?.items_select
    || acl.rows[0]?.evidence_select || !acl.rows[0]?.replay_execute) {
    fail("Checkout privacy ACL gate failed");
  }
} catch (error) {
  // Avoid logging the underlying pg exception; it can include connection info.
  fail(`QA DB preflight failed (${error?.code || "verification"})`);
} finally {
  await Promise.allSettled([owner.end(), storefront.end(), admin.end()]);
}
console.log(`PASS: QA endpoint, roles, migration and ACL verified. Starting localhost:${port}`);
console.log("NOTICE: Only /api/health should be called initially; checkout writes require separately reviewed synthetic fixtures.");
const child = spawn(process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)],
  {
    env: {
      // Do not inherit arbitrary environment secrets, deployment variables,
      // or preexisting checkout toggle. Pass only reviewed configuration.
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "development",
      APP_ENV: "development",
      NEON_BRANCH_ID: expected.branch,
      EXPECTED_NEON_DEVELOPMENT_BRANCH_ID: expected.branch,
      DATABASE_URL: urls.QA_OWNER_DATABASE_URL,
      STOREFRONT_DATABASE_URL: urls.QA_STOREFRONT_DATABASE_URL,
      ADMIN_DATABASE_URL: urls.QA_ADMIN_DATABASE_URL,
      CHECKOUT_SCOPED_DB_ENABLED: "true",
      LEGAL_PREVIEW_SIGNING_SECRET: required("LEGAL_PREVIEW_SIGNING_SECRET"),
      IP_HASH_SALT: required("IP_HASH_SALT"),
      NEXT_TELEMETRY_DISABLED: "1",
      LOCAL_BUILD_NO_UPLOAD: "1",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
const stop = (signal) => { if (child.pid) child.kill(signal); };
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.once("error", () => { console.error("BLOCKED: localhost server launch failed"); process.exitCode = 1; });
child.once("exit", (code) => { if (code && code !== 0) process.exitCode = 1; });
