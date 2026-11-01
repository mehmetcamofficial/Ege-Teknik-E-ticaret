import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { PRECONNECT_REASONS, preConnectViolations } from "../lib/db-attestation-url-guard.ts";
import { resolveScopedDatabaseUrl } from "../lib/db-access-scope.ts";

const ENDPOINT = "ep-quiet-river-a1b2c3d4", HOST = `${ENDPOINT}-pooler.eu-central-1.aws.neon.tech`, DIRECT = `${ENDPOINT}.eu-central-1.aws.neon.tech`;
const EXPECTED = { role: "ege_preview_storefront", database: "neondb", endpointId: ENDPOINT };
const url = (over: { user?: string; host?: string; db?: string; query?: string; pw?: string } = {}) =>
  `postgresql://${over.user ?? EXPECTED.role}:${over.pw ?? "pw-S3cr3t"}@${over.host ?? HOST}/${over.db ?? EXPECTED.database}${over.query ?? "?sslmode=verify-full"}`;
const check = (u: string) => preConnectViolations(u, EXPECTED);

// The driver, exactly as installed: the guard must read a string the way THIS parser does. (pg-connection-string is pg's own dependency, not ours.)
const { parse } = createRequire(createRequire(import.meta.url).resolve("pg"))("pg-connection-string") as { parse: (s: string) => Record<string, unknown> };

test("accepted: the expected endpoint (pooled or direct), role and database, in every legitimate spelling", () => {
  for (const u of [url(), url({ host: DIRECT }), url({ host: HOST.toUpperCase() }), url({ host: `${ENDPOINT}.c-2.eu-central-1.aws.neon.tech` }), url({ query: "" }), url({ query: "?sslmode=require" }), url({ query: "?sslmode=verify-ca" }),
    url({ query: "?sslmode=require&channel_binding=require" }), url({ query: "?channel_binding=prefer&sslmode=verify-full" }), url({ user: "ege%5Fpreview%5Fstorefront" }), url({ user: "ege_preview_%73torefront" }),
    url({ db: "neond%62" }), url({ pw: "p%40ss%3Aw%2Frd" }), `postgres://${EXPECTED.role}:pw@${HOST}:5432/neondb?sslmode=require`])
    assert.deepEqual(check(u), [], u.replace(/:[^:@/]+@/, ":***@"));
});

test("the endpoint and the host: every wrong or spoofed host is refused before anything is dialled", () => {
  const notNeon = ["db.example.test", "localhost", "127.0.0.1", "[::1]", "neon.tech", "evil.example", `${ENDPOINT}.neon.tech.evil.example`, `${ENDPOINT}.eu-central-1.aws.neon.tech.evil.example`, `${ENDPOINT}.eu-central-1.aws.xneon.tech`, `${ENDPOINT}.eu-central-1.aws.neon.tech.`,
    `evil-${ENDPOINT}.eu-central-1.aws.neon.tech`, `${ENDPOINT}-pooler.eu-central-1.aws.neon.tech.localhost`, `${ENDPOINT}.neon.tech`, `${ENDPOINT}%2eeu-central-1.aws.neon.tech`, `${ENDPOINT}%00.eu-central-1.aws.neon.tech`,
    `%65${ENDPOINT.slice(1)}.eu-central-1.aws.neon.tech`, `${ENDPOINT}.eu-central-1.aws.neon.tech%2f`, `${ENDPOINT}.eu-central-1.aws.neon.tech:80@evil.example`.split("@")[1], "/var/run/postgresql", `ep-.eu-central-1.aws.neon.tech`, `ep--x.eu-central-1.aws.neon.tech`];
  for (const host of notNeon) { const r = check(url({ host })); assert.ok(r.includes("url_host_not_neon") || r.includes("url_invalid"), `${host} -> ${JSON.stringify(r)}`); }
  for (const host of [`ep-quiet-river-a1b2c3d5.eu-central-1.aws.neon.tech`, `ep-quiet-river-a1b2c3d.eu-central-1.aws.neon.tech`, `ep-quiet-river.eu-central-1.aws.neon.tech`, `ep-other-endpoint-9z9z9z9z-pooler.eu-central-1.aws.neon.tech`, `ep-quiet-river-a1b2c3d4-x.eu-central-1.aws.neon.tech`])
    assert.deepEqual(check(url({ host })), ["url_endpoint_mismatch"], host);
});

test("only PostgreSQL URLs: a perfect host, role and database under another scheme, or an incomplete URL, is refused", () => {
  const rest = `${EXPECTED.role}:pw@${HOST}/neondb?sslmode=verify-full`;
  for (const scheme of ["https", "http", "mysql", "ftp", "file", "postgresql+ssl", "jdbc:postgresql", "postgres+tcp"]) assert.deepEqual(check(`${scheme}://${rest}`), ["url_invalid"], scheme);
  for (const bad of ["", " ", "postgresql://", "postgresql:///neondb", `postgresql://@${HOST}/neondb`, `postgresql://${HOST}/neondb`, `//${rest}`, rest, "postgresql:", "not a url"]) assert.ok(check(bad).length > 0, JSON.stringify(bad));
});

test("userinfo attacks: a Neon-looking name in the userinfo is not the host", () => {
  assert.deepEqual(check(`postgresql://${EXPECTED.role}:${DIRECT}@evil.example/neondb?sslmode=verify-full`), ["url_host_not_neon"], "the real host is foreign");
  assert.deepEqual(check(`postgresql://${DIRECT}@evil.example/neondb`).sort(), ["url_host_not_neon", "url_role_unexpected"]);
  assert.deepEqual(check(`postgresql://${EXPECTED.role}:pw@evil.example@${HOST}/neondb`), [], "an '@' inside the password is part of the password: the host is still the last one (the parser and the driver agree)");
  assert.equal(parse(`postgresql://${EXPECTED.role}:pw@evil.example@${HOST}/neondb`).host, HOST, "the driver reads the same host");
  assert.deepEqual(check(`postgresql://${EXPECTED.role}:pw@${HOST}@evil.example/neondb`), ["url_host_not_neon"]);
  assert.deepEqual(check(`postgresql://${EXPECTED.role}:pw@${HOST}:5432@evil.example/neondb`), ["url_host_not_neon"]);
  assert.deepEqual(check(`postgresql://${EXPECTED.role}:pw@${HOST}%40evil.example/neondb`).length > 0, true);
});

test("role and database: wrong, percent-encoded to look right, double-encoded, or carrying a path", () => {
  for (const user of ["ege_preview_admin", "neondb_owner", "postgres", "ege_preview_storefront2", "EGE_PREVIEW_STOREFRONT", "ege_preview_storefront%00", "ege_preview_storefront%20", "ege%255Fpreview%255Fstorefront", "x"])
    assert.deepEqual(check(url({ user })), ["url_role_unexpected"], user);
  for (const db of ["postgres", "neondb2", "NEONDB", "neondb%2Fx", "neondb%00", "neondb%252F", "neondb%20", "neon%64b%2F", "other"]) assert.deepEqual(check(url({ db })), ["url_database_unexpected"], db);
  assert.deepEqual(check(`postgresql://${EXPECTED.role}:pw@${HOST}/neondb/extra`), ["url_database_unexpected"]); assert.deepEqual(check(`postgresql://${EXPECTED.role}:pw@${HOST}/`), ["url_database_unexpected"]);
  assert.deepEqual(check(`postgresql://${EXPECTED.role}:pw@${HOST}`), ["url_database_unexpected"]);
  for (const bad of ["%", "%zz", "%E0%A4%A"]) assert.ok(check(url({ user: bad })).length > 0, `malformed encoding ${bad}`);
  assert.ok(check(url({ db: "%E0%A4%A" })).includes("url_invalid"));
});

test("the database must be exactly one path segment, whatever the expectation says", () => {
  // A validated expectation never contains '/', but the guard must not lean on that: even asked for a multi-segment name it refuses a multi-segment path.
  const odd = { ...EXPECTED, database: "neondb/extra" };
  assert.ok(preConnectViolations(`postgresql://${EXPECTED.role}:pw@${HOST}/neondb/extra`, odd).includes("url_database_unexpected"));
  assert.deepEqual(preConnectViolations(`postgresql://${EXPECTED.role}:pw@${HOST}/neondb`, EXPECTED), []);
});

test("parameters: nothing but the two TLS ones, each once - every other parameter reconfigures the driver", () => {
  // These are the parameters the driver would obey. Showing it makes the point: they are not cosmetic.
  assert.equal(parse(url({ query: "?host=evil.example" })).host, "evil.example", "?host= REPLACES the URL's host in the driver");
  assert.equal(parse(url({ query: "?user=neondb_owner" })).user, "neondb_owner", "?user= replaces the URL's user");
  assert.equal(parse(url({ query: "?ssl=0" })).ssl, false, "?ssl=0 switches TLS off");
  assert.deepEqual((parse(url({ query: "?sslmode=no-verify" })).ssl as { rejectUnauthorized: boolean }).rejectUnauthorized, false, "sslmode=no-verify stops verifying certificates");
  const dangerous = ["host=evil.example", "hostaddr=203.0.113.9", "user=neondb_owner", "dbname=postgres", "database=postgres", "port=1", "ssl=0", "ssl=false", "ssl=1", "sslmode=disable", "sslmode=no-verify", "sslmode=allow", "sslmode=prefer", "sslmode=verify-none", "sslmode=",
    "sslrootcert=/tmp/ca.pem", "sslcert=/tmp/c.pem", "sslkey=/tmp/k.pem", "sslnegotiation=direct", "uselibpqcompat=true", "options=-c%20role%3Dpostgres", "application_name=x", "target_session_attrs=any", "channel_binding=disable", "channel_binding=", "password=x", "connect_timeout=1",
    "SSLMODE=require", "%73slmode=disable", "%73slmod%65=disable", "x=1", "=1", "sslmode=require&sslmode=require", "sslmode=require&sslmode=verify-full", "sslmode=verify-full&ssl=0", "channel_binding=require&channel_binding=prefer", "sslmode=verify-full&host=evil.example", "&"];
  for (const q of dangerous) assert.deepEqual(check(url({ query: `?${q}` })), ["url_params_unsupported"], q);
  // The driver percent-decodes parameter NAMES and ignores empty segments. The guard does the same, so these are the SAME harmless string to both - and the encoded
  // attack forms are caught because the guard decodes before judging.
  for (const q of ["sslmod%65=require", "&&sslmode=require", "sslmode=require&"]) { assert.deepEqual(check(url({ query: `?${q}` })), [], q); assert.equal(parse(url({ query: `?${q}` })).sslmode, "require", `the driver reads ${q} as sslmode=require`); }
  assert.equal(parse(url({ query: "?%73slmode=disable" })).ssl, false, "the encoded form of sslmode=disable really switches TLS off in the driver");
  // A bare '?' is "no query" to the URL parser and to the driver alike (nothing to obey), so it is not a parameter.
  assert.deepEqual(check(url({ query: "?" })), [], "a bare '?'"); assert.equal(parse(url({ query: "?" })).sslmode, undefined); assert.equal(parse(url({ query: "?" })).ssl, undefined); assert.deepEqual(check(`${url()}#frag`), ["url_invalid"], "a fragment");
});

test("TLS options: only the approved values pass, and none can weaken verification", () => {
  for (const mode of ["require", "verify-ca", "verify-full"]) assert.deepEqual(check(url({ query: `?sslmode=${mode}` })), [], mode);
  for (const mode of ["disable", "allow", "prefer", "no-verify", "verify-none", "REQUIRE", "Verify-Full", "true", "0"]) assert.deepEqual(check(url({ query: `?sslmode=${mode}` })), ["url_params_unsupported"], mode);
  // Of the accepted modes, the real driver never yields a TLS-off or verification-off config.
  for (const mode of ["require", "verify-ca", "verify-full"]) { const ssl = parse(url({ query: `?sslmode=${mode}` })).ssl as Record<string, unknown> | boolean | undefined; assert.ok(ssl !== false && ssl !== undefined, mode); assert.notEqual((ssl as Record<string, unknown>).rejectUnauthorized, false, mode); }
  assert.equal(parse(url({ query: "" })).ssl, undefined, "no sslmode: the route's pinned option applies");
});

test("the guard and the driver read every accepted URL the same way", () => {
  for (const u of [url(), url({ host: DIRECT }), url({ user: "ege%5Fpreview%5Fstorefront" }), url({ db: "neond%62" }), url({ query: "?sslmode=require&channel_binding=require" }), `postgres://${EXPECTED.role}:pw@${HOST}:5432/neondb`]) {
    assert.deepEqual(check(u), []); const c = parse(u);
    assert.equal(String(c.host).toLowerCase(), new URL(u).hostname.toLowerCase(), "same host"); assert.equal(c.user, EXPECTED.role, "same role"); assert.equal(c.database, EXPECTED.database, "same database");
  }
  // Where the two WOULD differ (the driver percent-decodes the host), the guard refuses instead of interpreting twice.
  const sneaky = url({ host: `${ENDPOINT}%2eeu-central-1.aws.neon.tech` });
  assert.ok(String(parse(sneaky).host).includes("."), "the driver decodes %2e in the host"); assert.ok(check(sneaky).length > 0, "so the guard refuses it");
});

test("the guard never accepts what the scoped-URL guard rejects, and reports only fixed codes", () => {
  const legacy = url({ user: "owner_role" }), admin = url({ user: "ege_preview_admin" });
  const corpus = [url(), url({ host: DIRECT }), url({ query: "" }), url({ query: "?sslmode=disable" }), url({ query: "?sslmode=require&sslmode=require" }), url({ query: "?host=evil.example" }), url({ query: "?ssl=0" }), url({ query: "?sslrootcert=/x" }), url({ query: "?options=-c%20x" }),
    url({ user: "owner_role" }), url({ user: "ege_preview_admin" }), url({ host: "db.example.test" }), url({ host: "ep-other-endpoint-9z9z9z9z-pooler.eu-central-1.aws.neon.tech" }), url({ db: "other" }), "not a url", "https://u:p@x.test/db", "postgresql://u@h", "", url({ query: "?channel_binding=disable" })];
  for (const u of corpus) {
    const reasons = check(u); assert.ok(reasons.every((r) => (PRECONNECT_REASONS as readonly string[]).includes(r)), JSON.stringify(reasons)); assert.ok(!reasons.join("").includes("pw-S3cr3t"));
    if (reasons.length === 0) assert.doesNotThrow(() => resolveScopedDatabaseUrl("storefront", { DATABASE_URL: legacy, STOREFRONT_DATABASE_URL: u, ADMIN_DATABASE_URL: admin }), `the guard accepted a URL the scoped guard rejects: ${u.replace(/:[^:@/]+@/, ":***@")}`);
  }
});

test("random input never throws and never leaks the input", () => {
  let seed = 7; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const parts = ["postgresql://", "postgres://", "http://", HOST, "@", ":", "/", "?", "&", "=", "%", "%2e", "sslmode", "require", EXPECTED.role, "neondb", "[", "]", " ", "\u0000", "é", "\\", "#"];
  for (let i = 0; i < 4000; i++) {
    let s = ""; for (let k = rnd(12) + 1; k > 0; k--) s += parts[rnd(parts.length)];
    const r = check(s); assert.ok(Array.isArray(r)); assert.ok(r.every((x) => (PRECONNECT_REASONS as readonly string[]).includes(x)));
  }
});

test("the guard is pure: no I/O, no environment, no logging", () => {
  const source = readFileSync("lib/db-attestation-url-guard.ts", "utf8");
  assert.doesNotMatch(source, /process\.env|console\.|node:fs|node:net|fetch\(|from "pg"/);
});
