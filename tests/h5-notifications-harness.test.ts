import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { workerOperatorSql } from "../scripts/notification-worker-test-role.mjs";

/** Hermetic guards for the real-HTTP notification suites: the shared operator-SQL substitution and the shape of the H5 harness. */
const h5 = readFileSync("scripts/test-h5-notifications-http.mjs", "utf8");
const pr37 = readFileSync("scripts/test-pr37-worker-http.mjs", "utf8");

test("workerOperatorSql substitutes every placeholder with validated identifiers and an escaped password", () => {
  const sql = workerOperatorSql({ database: "sprintb_ci", group: "sprintb_h5_notification_worker", login: "sprintb_h5_worker_login", password: "it's-a-pass" });
  assert.doesNotMatch(sql, /:"[a-z_]+"|:'[a-z_]+'/, "no placeholder is left");
  assert.match(sql, /CREATE ROLE "sprintb_h5_notification_worker" NOLOGIN/);
  assert.match(sql, /CREATE ROLE "sprintb_h5_worker_login" LOGIN PASSWORD 'it''s-a-pass'/, "a single quote in the password is doubled, not injected");
  assert.match(sql, /GRANT CONNECT ON DATABASE "sprintb_ci" TO "sprintb_h5_notification_worker"/);
  assert.doesNotMatch(sql.replace(/^\s*--.*$/gm, ""), /GRANT ALL|(?<!NO)SUPERUSER|(?<!NO)BYPASSRLS|admin_users/i, "the operator SQL stays least-privilege (a NO-prefixed attribute is the safe form)");
  for (const bad of ['a"; drop role x; --', "Upper", "x", "1abc", "a b", ""]) {
    assert.throws(() => workerOperatorSql({ database: "sprintb_ci", group: bad, login: "sprintb_h5_worker_login", password: "p" }), /invalid SQL identifier/, JSON.stringify(bad));
    assert.throws(() => workerOperatorSql({ database: bad, group: "sprintb_h5_notification_worker", login: "sprintb_h5_worker_login", password: "p" }), /invalid SQL identifier/);
  }
});

test("both HTTP suites build the worker identity from the shared operator SQL, never a hand-written copy", () => {
  for (const [name, source] of [["h5", h5], ["pr37", pr37]] as const) {
    assert.match(source, /import \{ workerOperatorSql \} from "\.\/notification-worker-test-role\.mjs";/, name);
    assert.match(source, /workerOperatorSql\(\{/, name);
    assert.doesNotMatch(source, /replaceAll\(':"dbname"'/, `${name} does not substitute the operator SQL itself`);
  }
  assert.doesNotMatch(h5, /CREATE ROLE sprintb_h5|GRANT ALL|(?<!NO)SUPERUSER|(?<!NO)BYPASSRLS/, "H5 creates no worker role by hand and grants nothing broad");
});

test("H5 closes the mock mail server and the Next process group on EVERY exit path", () => {
  const tryAt = h5.indexOf("\ntry {\n");
  assert.ok(tryAt > 0 && h5.indexOf("http.createServer") < tryAt, "the mock is created at top level, so the finally block can reach it");
  assert.equal((h5.match(/mock\.close\(/g) ?? []).length, 1, "exactly one close, inside the idempotent cleanup");
  assert.match(h5, /mock\.closeAllConnections\?\.\(\)/, "keep-alive connections cannot hold the close back");
  assert.match(h5, /\} finally \{\n  await cleanup\(\);\n  clearTimeout\(watchdog\);\n\}/, "success and failure both end in cleanup");
  assert.doesNotMatch(h5.slice(h5.indexOf("PASS ")), /await new Promise\(\(r\) => mock\.close/, "no success-only close remains");
  assert.match(h5, /const TIME_LIMIT_MS = \d[\d_]*;/);
  assert.match(h5, /setTimeout\(async \(\) => \{[\s\S]*?await Promise\.race\(\[cleanup\(\)[\s\S]*?process\.exit\(1\);[\s\S]*?\}, TIME_LIMIT_MS\);\s*watchdog\.unref\(\);/, "a hung step ends the run: bounded cleanup, then a non-zero exit");
});

test("H5 keeps the fail-closed contract: 404, 401, 503 not_configured, 503 worker_unavailable, a shared role is refused", () => {
  for (const needle of ['assert.equal((await dispatch()).status, 404', 'assert.equal((await dispatch(null)).status, 401', 'assert.equal((await dispatch("x".repeat(40))).status, 401',
    'noRecipients.status, 503', 'noRecipients.data?.error, "not_configured"', 'noWorker.data?.error, "worker_unavailable"', 'sharedRole.status, 503', "NOTIFICATION_WORKER_DATABASE_URL: storefrontUrl"]) {
    assert.ok(h5.includes(needle), `missing: ${needle}`);
  }
  const okAnswer = h5.indexOf("assert.equal(notConfigured.status, 200)");
  assert.ok(okAnswer > h5.indexOf("NOTIFICATION_WORKER_DATABASE_URL: workerUrl"), "a 200 is only expected once the dedicated worker is configured");
  assert.ok(okAnswer > h5.indexOf("noRecipients.status, 503"), "and only after the fail-closed answers were asserted");
});

test("H5 owns what it removes by PROOF (oid ledger), with per-run names; no static marker, comment or fixed name is an authority to drop", () => {
  assert.match(h5, /ledger = openLedger\(\{ suite: "h5", systemId \}\);\s+\/\/ before anything is created/, "the ledger exists before anything is created");
  assert.match(h5, /DB = `sprintb_h5_\$\{ledger\.nonce\}`;/, "the database name is random per run");
  assert.match(h5, /ROLE = \{ store: `\$\{DB\}_store`, admin: `\$\{DB\}_admin`, group: `\$\{DB\}_worker`, login: `\$\{DB\}_wlogin` \};/, "so are all four role names");
  assert.doesNotMatch(h5, /WORKER_MARK|COMMENT ON ROLE|shobj_description|sprintb_http_|ALTER ROLE|DROP OWNED/, "no static marker, no comment as authority, no foreign or shared role, no ALTER of an existing role");
  assert.equal((h5.match(/DROP (DATABASE|ROLE)/g) ?? []).length, 0, "H5 writes no DROP itself: every removal goes through the oid-checked releaseOwned");
  assert.match(h5, /releaseOwned\(\{ query: \(t, p\) => admin\.query\(t, p\), databases: ledger\.state\.databases, roles: ledger\.state\.roles \}\)/, "only the ledger's own entries are released");
  assert.ok(h5.indexOf("await attestDisposableCluster(") < h5.indexOf("openLedger(") && h5.indexOf("openLedger(") < h5.indexOf("CREATE DATABASE"), "attest, then ledger, then the first creation");
  assert.match(h5, /database already exists: refusing to reuse or reset it/);
  assert.match(h5, /recordRoles\(\[ROLE\.group, ROLE\.login\]\)/, "the worker roles are recorded right after the operator SQL");
});

test("H5 refuses unsafe targets and never lets ambient credentials reach the server it starts", () => {
  assert.match(h5, /process\.env\.H5_PG_URL/);
  assert.match(h5, /base0\.port === "55432"\) refuse\("the recovery cluster port is never allowed"\)/);
  assert.match(h5, /loopback PostgreSQL URL required/);
  assert.match(h5, /const PASSTHROUGH = \["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TZ", "CI", "USER", "SHELL"\];/, "an allow-list, not the whole environment");
  const start = h5.slice(h5.indexOf("const startServer"), h5.indexOf("// ---------- loopback mock"));
  assert.doesNotMatch(start, /\.\.\.process\.env/, "the dev server does not inherit process.env");
  assert.match(h5, /assert\.match\(mockBase, \/\^http:\\\/\\\/127\\\.0\\\.0\\\.1:\\d\+\$\/, "the mail provider is a loopback mock/);
});

test("H5 cleans up on a signal on its own connection, and prints its cleanup line only when everything owned is gone", () => {
  assert.match(h5, /for \(const \[signal, code\] of \[\["SIGINT", 130\], \["SIGTERM", 143\]\]\) \{\s+process\.on\(signal, async \(\) => \{[\s\S]*?await Promise\.race\(\[cleanup\(\), sleep\(45_000\)\]\);\s+process\.exit\(code\);/);
  assert.match(h5, /const admin = new pg\.Client\(\{ connectionString: maintenanceUrl, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 \}\);/, "a dedicated, time-bounded connection");
  assert.match(h5, /await Promise\.race\(\[inflight, sleep\(10_000\)\]\);/, "a creation in flight is recorded before cleanup decides what it owns");
  const code = h5.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");   // executable lines only (the header quotes the line too)
  assert.equal(code.split('"[h5-http] cleanup: owned resources removed"').length - 1, 1, "the line is printed from exactly one place");
  const removed = code.indexOf('"[h5-http] cleanup: owned resources removed"');
  assert.ok(removed > code.indexOf("if (problems.length)") && removed > code.indexOf("ledger?.remove()"), "and that place comes after the problem check and the ledger removal");
  assert.match(h5, /cleanup INCOMPLETE \(the ledger is kept; recover with scripts\/h5-recover-leftovers\.mjs\)/);
  assert.ok(h5.indexOf('console.log("[h5-http] PASS: scoped-worker notification integration")') > h5.indexOf("results.summary"), "PASS is printed only after the last assertion");
});
