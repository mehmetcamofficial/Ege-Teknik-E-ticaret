#!/usr/bin/env node
/**
 * Ege Teknik — hosted Neon QA preflight only. ZERO writes, no migrations,
 * fixtures, HTTP traffic or destructive SQL. Never use for active Preview/Prod.
 *
 * Invocation:
 *   QA_OWNER_DATABASE_URL='postgresql://...' \
 *   QA_STOREFRONT_DATABASE_URL='postgresql://...' \
 *   node scripts/qa-hosted-checkout-preflight.mjs
 *
 * Do not paste URLs/passwords into chat, terminal transcripts or CI logs.
 */
import pg from "pg";

const EXPECTED_HOSTS = new Set([
  "ep-square-dust-awrzxg05.c-12.us-east-1.aws.neon.tech",
  "ep-square-dust-awrzxg05-pooler.c-12.us-east-1.aws.neon.tech",
]);
const expectedDatabase = "neondb";
const expectedStorefront = "ege_qa_storefront_login";
const expectedOwner = "neondb_owner";
const expectedBranch = "br-delicate-frost-awnf26nw";

function parseConnection(name, value, expectedUser) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name}: invalid connection URL`); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !EXPECTED_HOSTS.has(url.hostname) || url.pathname !== `/${expectedDatabase}`
    || url.username !== expectedUser || !url.password) {
    throw new Error(`${name}: host, database, username or credentials do not match approved QA`);
  }
  if (url.searchParams.get("sslmode") === "disable") throw new Error(`${name}: TLS must be enabled`);
  return value;
}
function requireValue(name) {
  if (!process.env[name]) throw new Error(`${name} must be set privately in your shell`);
  return process.env[name];
}
const report = (name, pass) => {
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}`);
  if (!pass) process.exitCode = 1;
};
const expectedDenied = async (client, relation) => {
  try {
    await client.query(`SELECT count(*) FROM public.${relation}`);
    return false;
  } catch (error) {
    if (error.code !== "42501") throw error;
    return true;
  }
};

const ownerConnection = parseConnection("QA_OWNER_DATABASE_URL",
  requireValue("QA_OWNER_DATABASE_URL"), expectedOwner);
const storeConnection = parseConnection("QA_STOREFRONT_DATABASE_URL",
  requireValue("QA_STOREFRONT_DATABASE_URL"), expectedStorefront);
if (process.env.QA_NEON_BRANCH_ID !== expectedBranch) {
  throw new Error("QA_NEON_BRANCH_ID must equal the approved isolated QA branch");
}
const owner = new pg.Client({ connectionString: ownerConnection, ssl: { rejectUnauthorized: true } });
const store = new pg.Client({ connectionString: storeConnection, ssl: { rejectUnauthorized: true } });

try {
  await owner.connect();
  await store.connect();
  const [ownerIdentity, storeIdentity] = await Promise.all([
    owner.query("SELECT current_user AS role, current_database() AS db"),
    store.query("SELECT current_user AS role, current_database() AS db"),
  ]);
  report("QA owner/database identity", ownerIdentity.rows[0].role === expectedOwner && ownerIdentity.rows[0].db === expectedDatabase);
  report("QA restricted storefront/database identity", storeIdentity.rows[0].role === expectedStorefront && storeIdentity.rows[0].db === expectedDatabase);
  if (process.exitCode) throw new Error("Database identity guard failed");

  const migrations = await owner.query("SELECT count(*)::integer AS n FROM drizzle.__drizzle_migrations");
  report("Migration 0019 included (minimum 20 applied)", migrations.rows[0].n >= 20);
  const fn = await owner.query(`SELECT p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS owner,
    p.proconfig AS config,
    has_function_privilege($1,'public.checkout_replay_by_key(text,text)','EXECUTE') AS storefront_execute,
    has_function_privilege('public','public.checkout_replay_by_key(text,text)','EXECUTE') AS public_execute
    FROM pg_proc p WHERE p.oid='public.checkout_replay_by_key(text,text)'::regprocedure`, [expectedStorefront]);
  const f = fn.rows[0];
  report("Owner-only definer and restricted EXECUTE", Boolean(f?.definer && f.owner === expectedOwner
    && f.storefront_execute && !f.public_execute
    && f.config?.some(c => c === "search_path=pg_catalog, public, pg_temp")));

  for (const name of ["customers", "addresses", "orders", "order_items", "order_legal_acceptances"]) {
    report(`${name}: SELECT denied with 42501`, await expectedDenied(store, name));
  }
  const missing = await store.query(
    "SELECT public.checkout_replay_by_key($1,$2) AS payload",
    ["qa-missing-key-20261012", "0".repeat(64)]);
  report("Unknown replay key returns NULL", missing.rows[0]?.payload === null);

  const acl = await owner.query(`SELECT
    has_table_privilege($1, 'public.orders', 'INSERT') AS orders_insert,
    has_table_privilege($1, 'public.order_items', 'INSERT') AS items_insert,
    has_table_privilege($1, 'public.order_legal_acceptances', 'INSERT') AS evidence_insert,
    has_table_privilege($1, 'public.customers', 'INSERT') AS customers_insert,
    has_table_privilege($1, 'public.addresses', 'INSERT') AS addresses_insert`, [expectedStorefront]);
  report("Five required INSERT grants retained", Object.values(acl.rows[0]).every(v => v === true));
  const counts = await owner.query(`SELECT
    (SELECT count(*)::integer FROM public.orders) AS orders,
    (SELECT count(*)::integer FROM public.order_items) AS items,
    (SELECT count(*)::integer FROM public.order_legal_acceptances) AS evidence`);
  console.log(`Baseline counts (aggregate only): orders=${counts.rows[0].orders}; items=${counts.rows[0].items}; evidence=${counts.rows[0].evidence}`);
  console.log(process.exitCode ? "BLOCKED: read-only preflight failed" : "PASS: read-only preflight; HTTP fixture tests NOT RUN");
} catch (error) {
  process.exitCode = 1;
  // Never log database URLs, SQL query values, secrets, or customer rows.
  console.error(`BLOCKED: QA preflight could not complete (${error?.code ?? error?.name ?? "unknown error"})`);
} finally {
  await Promise.allSettled([store.end(), owner.end()]);
}
