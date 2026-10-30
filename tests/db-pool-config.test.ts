import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { scopedPoolSettings } from "../lib/db-pool-config.ts";

// The REAL driver: the object pg builds from a Pool/Client config, and the `ssl` value it later hands to tls.connect.
const require = createRequire(import.meta.url);
const ConnectionParameters = require("pg/lib/connection-parameters") as new (config: Record<string, unknown>) => { ssl: unknown; host: string; user: string; database: string };
const driverSsl = (config: Record<string, unknown>) => new ConnectionParameters(config).ssl as Record<string, unknown> | boolean;

const ENDPOINT = "ep-quiet-lake-a1b2c3d4";
const host = (pooler = false) => `${ENDPOINT}${pooler ? "-pooler" : ""}.eu-central-1.aws.neon.tech`;
const url = (role: string, database = "neondb_preview", query = "?sslmode=require", h = host()) => `postgresql://${role}:pw-s3cret-value@${h}/${database}${query}`;
const preview = {
  APP_ENV: "preview", EXPECTED_PREVIEW_STOREFRONT_DB_ROLE: "store_role", EXPECTED_PREVIEW_ADMIN_DB_ROLE: "admin_role",
  EXPECTED_PREVIEW_DB_NAME: "neondb_preview", EXPECTED_NEON_PREVIEW_ENDPOINT_ID: ENDPOINT,
} as Record<string, string | undefined>;
const pinned = { rejectUnauthorized: true };
const reasonsOf = (fn: () => unknown) => { try { fn(); } catch (error) { return (error as Error).message; } assert.fail("expected a refusal"); };

test("CONTROL against the real driver: sslmode in the URL replaces the explicit ssl option, so the old pin protected nothing", () => {
  for (const mode of ["require", "verify-ca", "verify-full"]) {
    const ssl = driverSsl({ connectionString: url("store_role", "neondb_preview", `?sslmode=${mode}`), ssl: pinned });
    assert.notDeepEqual(ssl, pinned, `sslmode=${mode}: the driver replaced { rejectUnauthorized: true } (verification now depends on Node defaults and NODE_TLS_REJECT_UNAUTHORIZED)`);
  }
});

test("the scoped settings reach the real driver as an explicit, verifying TLS option whatever the URL's sslmode says", () => {
  for (const query of ["?sslmode=require", "?sslmode=verify-ca", "?sslmode=verify-full", "", "?channel_binding=require&sslmode=require", "?sslmode=require&channel_binding=prefer"]) {
    for (const env of [preview, { ...preview, APP_ENV: "production" }]) {
      const settings = scopedPoolSettings("storefront", url("store_role", "neondb_preview", query), env);
      assert.deepEqual(settings.ssl, pinned);
      assert.deepEqual(driverSsl({ connectionString: settings.connectionString, ssl: settings.ssl }), pinned, `${query} / ${env.APP_ENV}`);
      assert.doesNotMatch(settings.connectionString, /sslmode/);
    }
  }
});

test("only sslmode is removed: identity, host, database and the other approved parameter are untouched, and no dangling '?' is left", () => {
  const kept = scopedPoolSettings("storefront", url("store_role", "neondb_preview", "?channel_binding=require&sslmode=require"), preview).connectionString;
  assert.equal(kept, url("store_role", "neondb_preview", "?channel_binding=require"));
  const bare = scopedPoolSettings("storefront", url("store_role"), preview).connectionString;
  assert.equal(bare, url("store_role", "neondb_preview", ""));
  const params = new ConnectionParameters({ connectionString: bare });
  assert.deepEqual([params.user, params.host, params.database], ["store_role", host(), "neondb_preview"]);
  assert.equal(scopedPoolSettings("storefront", url("store_role", "neondb_preview", "?sslmode=require", host(true)), preview).connectionString, url("store_role", "neondb_preview", "", host(true)), "the pooled host of the same endpoint is accepted");
});

test("PREVIEW: a URL for the wrong role, database or endpoint is refused before any pool exists, with fixed codes that carry nothing from the URL", () => {
  const cases: Array<[string, string, string]> = [
    ["storefront", url("admin_role"), "url_role_unexpected"],                                          // swapped roles
    ["admin", url("store_role"), "url_role_unexpected"],
    ["storefront", url("store_role", "neondb_other"), "url_database_unexpected"],
    ["storefront", url("store_role", "neondb_preview", "?sslmode=require", "ep-other-wood-z9y8x7w6.eu-central-1.aws.neon.tech"), "url_endpoint_mismatch"],
    ["storefront", url("store_role", "neondb_preview", "?sslmode=require", "db.example.test"), "url_host_not_neon"],
    ["storefront", url("store_role", "neondb_preview", "?sslmode=require&host=ep-evil-1.eu-central-1.aws.neon.tech"), "url_params_unsupported"],
    ["storefront", url("store_role", "neondb_preview", "?sslmode=require&user=admin_role"), "url_params_unsupported"],
    ["storefront", url("store_role", "neondb_preview", "?ssl=0"), "url_params_unsupported"],
    ["storefront", url("store_role", "neondb_preview", "?sslmode=disable"), "url_params_unsupported"],
    ["storefront", url("store_role", "neondb_preview", "?sslmode=require&sslmode=require"), "url_params_unsupported"],
    ["storefront", url("store_role", "neondb_preview", "?sslmod%65=disable"), "url_params_unsupported"],
    ["storefront", `postgresql://store_role:pw-s3cret-value@${host()}.evil.test/neondb_preview?sslmode=require`, "url_host_not_neon"],          // suffix spoof
    ["storefront", `postgresql://${host()}:pw-s3cret-value@evil.test/neondb_preview?sslmode=require`, "url_host_not_neon"],                       // the Neon host as the userinfo, the real host elsewhere
    ["storefront", url("store%5Frole%00"), "url_role_unexpected"],
  ];
  for (const [scope, connectionString, code] of cases) {
    const message = reasonsOf(() => scopedPoolSettings(scope as "storefront" | "admin", connectionString, preview));
    assert.match(message, new RegExp(code), `${code} for ${connectionString.replace(/pw-s3cret-value/, "***")}`);
    assert.match(message, /^Scoped database connection rejected: [A-Za-z0-9_,]+\.$/, "a fixed sentence and fixed codes only");
    for (const leak of ["pw-s3cret-value", "neon.tech", "ep-", "store_role", "admin_role", "neondb"]) assert.ok(!message.includes(leak), `the message must not carry ${leak}`);
  }
});

test("PREVIEW: missing or invalid expectations fail closed, and each scope is judged against its OWN role", () => {
  assert.match(reasonsOf(() => scopedPoolSettings("storefront", url("store_role"), { APP_ENV: "preview" })), /EXPECTED_PREVIEW_STOREFRONT_DB_ROLE_invalid/);
  assert.match(reasonsOf(() => scopedPoolSettings("storefront", url("store_role"), { ...preview, EXPECTED_NEON_PREVIEW_ENDPOINT_ID: "" })), /EXPECTED_NEON_PREVIEW_ENDPOINT_ID_invalid/);
  assert.match(reasonsOf(() => scopedPoolSettings("storefront", url("store_role"), { ...preview, EXPECTED_PREVIEW_ADMIN_DB_ROLE: "store_role" })), /expected_roles_not_distinct/);
  assert.match(reasonsOf(() => scopedPoolSettings("admin", url("store_role"), preview)), /url_role_unexpected/);
  assert.equal(scopedPoolSettings("admin", url("admin_role"), preview).connectionString, url("admin_role", "neondb_preview", ""));
  assert.equal(scopedPoolSettings("storefront", url("store%5Frole"), preview).connectionString, url("store%5Frole", "neondb_preview", ""), "a percent-encoded spelling of the expected role is the expected role (decoded like the driver does)");
  assert.throws(() => scopedPoolSettings("storefront", "not a url", preview), /url_invalid/);
});

test("TLS verification switched off for the process is refused in Preview and Production, with or without a good URL", () => {
  for (const flag of ["0", " 0 "]) {
    assert.match(reasonsOf(() => scopedPoolSettings("storefront", url("store_role"), { ...preview, NODE_TLS_REJECT_UNAUTHORIZED: flag })), /tls_verification_disabled/);
    assert.match(reasonsOf(() => scopedPoolSettings("storefront", url("store_role"), { ...preview, APP_ENV: "production", NODE_TLS_REJECT_UNAUTHORIZED: flag })), /tls_verification_disabled/);
  }
  assert.match(reasonsOf(() => scopedPoolSettings("storefront", url("admin_role"), { ...preview, NODE_TLS_REJECT_UNAUTHORIZED: "0" })), /tls_verification_disabled.*url_role_unexpected|url_role_unexpected.*tls_verification_disabled/, "all reasons are reported together");
  for (const value of [undefined, "1", ""]) assert.deepEqual(scopedPoolSettings("storefront", url("store_role"), { ...preview, NODE_TLS_REJECT_UNAUTHORIZED: value }).ssl, pinned);
});

test("PRODUCTION: the TLS pin applies, the Preview identity judgement does not, and nothing is loosened", () => {
  const production = { APP_ENV: "production" };
  const settings = scopedPoolSettings("storefront", "postgresql://prod_store:pw@ep-prod-aaaa1111.eu-central-1.aws.neon.tech/neondb?sslmode=require", production);
  assert.deepEqual(settings.ssl, pinned);
  assert.doesNotMatch(settings.connectionString, /sslmode/);
  assert.deepEqual(driverSsl({ connectionString: settings.connectionString, ssl: settings.ssl }), pinned);
});

test("DISPOSABLE LOCAL: development + loopback + sprintb keeps its plain connection untouched; nothing else gets that exception", () => {
  const local = "postgresql://sprintb_http_storefront:pw@127.0.0.1:5432/sprintb_http";
  assert.deepEqual(scopedPoolSettings("storefront", local, { APP_ENV: "development" }), { connectionString: local, ssl: false });
  assert.equal(driverSsl({ connectionString: local, ssl: false }), false);
  assert.deepEqual(scopedPoolSettings("storefront", local, { APP_ENV: "development", NODE_TLS_REJECT_UNAUTHORIZED: "0" }), { connectionString: local, ssl: false });
  assert.deepEqual(scopedPoolSettings("storefront", "postgresql://u:pw@127.0.0.1:5432/appdb", { APP_ENV: "development" }).ssl, pinned, "loopback without the sprintb prefix keeps TLS");
  assert.deepEqual(scopedPoolSettings("storefront", "postgresql://u:pw@db.example.test/sprintb_x", { APP_ENV: "development" }).ssl, pinned, "sprintb on a non-loopback host keeps TLS");
  assert.throws(() => scopedPoolSettings("storefront", local, { ...preview }), /url_host_not_neon/, "the exception exists for development only: Preview judges the same URL");
  assert.throws(() => scopedPoolSettings("storefront", local, { APP_ENV: "preview" }), /_invalid/, "Preview without expectations is closed");
});

test("db/index.ts: the scoped pool is decided by scopedPoolSettings BEFORE any Pool exists; the legacy and worker pools pass no settings", () => {
  const source = readFileSync("db/index.ts", "utf8");
  const scoped = source.slice(source.indexOf("export function getScopedPool"), source.indexOf("/** Dedicated outbox worker"));
  assert.match(scoped, /resolveScopedDatabaseUrl\(scope, process\.env\)/);
  assert.match(scoped, /createPool\(connectionString, scopedPoolSettings\(scope, connectionString, process\.env\)\)/, "settings are computed in the argument: a refusal throws before createPool runs");
  assert.equal([...source.matchAll(/createPool\(/g)].length, 4, "one definition plus the legacy, scoped and worker call sites: a new pool cannot appear unnoticed");
  assert.match(source, /ssl: scoped \? scoped\.ssl : disposableLocal \? false : \{ rejectUnauthorized: true \}/, "the TLS option of a scoped pool comes from the settings; the legacy expression is kept verbatim for the other pools");
  assert.match(source, /egeTeknikPool = createPool\(databaseUrl\(\)\)/, "legacy pool: unchanged");
  assert.match(source, /egeTeknikNotificationWorkerPool = createPool\(url\)/, "worker pool: unchanged");
  assert.doesNotMatch(scoped.split("createPool")[0], /new Pool/, "no pool is constructed before the settings exist");
  // The disposable-local predicate of lib/db-pool-config.ts equals the one in createPool.
  const create = source.slice(source.indexOf("function createPool"), source.indexOf("/** Legacy connection"));
  for (const condition of ['process.env.APP_ENV === "development"', '["127.0.0.1", "localhost", "::1"].includes(target.hostname)', 'target.pathname.slice(1).startsWith("sprintb")']) assert.ok(create.includes(condition), condition);
  const config = readFileSync("lib/db-pool-config.ts", "utf8");
  for (const condition of ['env.APP_ENV === "development"', '["127.0.0.1", "localhost", "::1"].includes(target.hostname)', 'target.pathname.slice(1).startsWith("sprintb")']) assert.ok(config.includes(condition), condition);
});

test("the module is pure: no I/O, no logging, no driver", () => {
  const config = readFileSync("lib/db-pool-config.ts", "utf8");
  assert.doesNotMatch(config.replace(/\/\*[\s\S]*?\*\//g, ""), /console\.|process\.env|from "pg"|node:(fs|net|tls|http)/);
});
