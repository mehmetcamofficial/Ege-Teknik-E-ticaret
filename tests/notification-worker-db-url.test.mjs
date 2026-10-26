import assert from "node:assert/strict";
import test from "node:test";
import { resolveNotificationWorkerDatabaseUrl } from "../lib/notification-worker-db-url.ts";

const url = (role, host = "ep-qa.example.neon.tech", db = "neondb") =>
  `postgresql://${role}:dummy@${host}/${db}?sslmode=require`;
const good = () => ({
  DATABASE_URL: url("qa_legacy"),
  STOREFRONT_DATABASE_URL: url("qa_storefront", "ep-qa-pooler.example.neon.tech"),
  ADMIN_DATABASE_URL: url("qa_admin"),
  NOTIFICATION_WORKER_DATABASE_URL: url("qa_worker", "ep-qa-pooler.example.neon.tech"),
});

test("dedicated worker URL accepts same Neon direct/pooler endpoint and four distinct roles", () => {
  const env = good();
  assert.equal(resolveNotificationWorkerDatabaseUrl(env), env.NOTIFICATION_WORKER_DATABASE_URL);
});
test("missing worker URL fails closed", () => {
  const env = good(); delete env.NOTIFICATION_WORKER_DATABASE_URL;
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(env), /NOTIFICATION_WORKER_DATABASE_URL is required/);
});
test("worker cannot reuse any other database role", () => {
  for (const role of ["qa_legacy", "qa_storefront", "qa_admin"]) {
    const env = good(); env.NOTIFICATION_WORKER_DATABASE_URL = url(role);
    assert.throws(() => resolveNotificationWorkerDatabaseUrl(env), /four distinct database roles/);
  }
});
test("cross-branch hostname and database name are rejected", () => {
  const wrongHost = good(); wrongHost.NOTIFICATION_WORKER_DATABASE_URL = url("qa_worker", "ep-other.example.neon.tech");
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(wrongHost), /endpoint mismatch/);
  const wrongDb = good(); wrongDb.NOTIFICATION_WORKER_DATABASE_URL = url("qa_worker", "ep-qa.example.neon.tech", "otherdb");
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(wrongDb), /endpoint mismatch/);
});
test("invalid schemes and missing scoped connections are rejected", () => {
  const invalid = good(); invalid.NOTIFICATION_WORKER_DATABASE_URL = "https://example.com/secret";
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(invalid), /PostgreSQL URL/);
  const missingAdmin = good(); delete missingAdmin.ADMIN_DATABASE_URL;
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(missingAdmin), /ADMIN_DATABASE_URL is required/);
});
test("errors do not expose database passwords", () => {
  const env = good(); env.NOTIFICATION_WORKER_DATABASE_URL = "not-a-url-secret-string";
  try { resolveNotificationWorkerDatabaseUrl(env); assert.fail("should fail"); }
  catch (error) { assert.doesNotMatch(String(error), /not-a-url-secret-string/); }
});

test("a percent-encoded or differently written username cannot smuggle a reused role past the distinctness check", () => {
  const encodedAdmin = good(); encodedAdmin.NOTIFICATION_WORKER_DATABASE_URL = url("qa%5Fadmin");
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(encodedAdmin), /four distinct database roles/);
  const encodedLegacy = good(); encodedLegacy.NOTIFICATION_WORKER_DATABASE_URL = url("qa%5flegacy");
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(encodedLegacy), /four distinct database roles/);
});
test("percent-encoded host-independent parts of the endpoint cannot hide a different database", () => {
  const sameDbEncoded = good(); sameDbEncoded.NOTIFICATION_WORKER_DATABASE_URL = url("qa_worker", "ep-qa-pooler.example.neon.tech", "neon%64b");
  assert.equal(resolveNotificationWorkerDatabaseUrl(sameDbEncoded), sameDbEncoded.NOTIFICATION_WORKER_DATABASE_URL, "neon%64b is the database neondb");
  const upperHost = good(); upperHost.NOTIFICATION_WORKER_DATABASE_URL = url("qa_worker", "EP-QA.EXAMPLE.NEON.TECH");
  assert.equal(resolveNotificationWorkerDatabaseUrl(upperHost), upperHost.NOTIFICATION_WORKER_DATABASE_URL, "host names are case-insensitive");
  const otherDb = good(); otherDb.NOTIFICATION_WORKER_DATABASE_URL = url("qa_worker", "ep-qa.example.neon.tech", "neon%65db");
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(otherDb), /endpoint mismatch/);
});
test("connection options (session settings) and undecodable escapes are rejected on every URL", () => {
  const withOptions = good(); withOptions.NOTIFICATION_WORKER_DATABASE_URL += "&options=-c%20role%3Dqa_admin";
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(withOptions), /must not carry connection options/);
  const legacyOptions = good(); legacyOptions.DATABASE_URL += "&options=-c%20search_path%3Devil";
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(legacyOptions), /must not carry connection options/);
  const badEscape = good(); badEscape.NOTIFICATION_WORKER_DATABASE_URL = "postgresql://qa%E0%A4%A:dummy@ep-qa.example.neon.tech/neondb";
  assert.throws(() => resolveNotificationWorkerDatabaseUrl(badEscape), /must be a PostgreSQL URL/);
});
test("query parameters that node-postgres lets override the URL identity or drop TLS are rejected on every URL", () => {
  // Reproduced against pg-connection-string 2.14.0: ?user=, ?host=, ?database= replace the parts the guard compares.
  for (const extra of ["&user=qa_admin", "&host=evil.example", "&port=1", "&database=otherdb", "&dbname=otherdb", "&password=x", "&USER=qa_admin", "&sslmode=disable", "&sslmode=require&sslmode=disable", "&application_name=x"]) {
    for (const key of ["NOTIFICATION_WORKER_DATABASE_URL", "DATABASE_URL", "STOREFRONT_DATABASE_URL", "ADMIN_DATABASE_URL"]) {
      const env = good(); env[key] += extra;
      assert.throws(() => resolveNotificationWorkerDatabaseUrl(env), /must not carry connection (parameters|options)/, `${key}${extra.split("=")[0]}`);
    }
  }
  const neon = good(); neon.NOTIFICATION_WORKER_DATABASE_URL += "&channel_binding=require";
  assert.equal(resolveNotificationWorkerDatabaseUrl(neon), neon.NOTIFICATION_WORKER_DATABASE_URL, "the two standard Neon parameters stay accepted");
  const bare = good(); bare.NOTIFICATION_WORKER_DATABASE_URL = "postgresql://qa_worker:dummy@ep-qa.example.neon.tech/neondb";
  assert.equal(resolveNotificationWorkerDatabaseUrl(bare), bare.NOTIFICATION_WORKER_DATABASE_URL, "no query string at all is fine");
});
