/**
 * P3-S1A: the client-IP identity, lib/security-policy.ts's trustedClientIp().
 *
 * What is being tested here is PARSING, and the tests are named accordingly. This function does not and
 * cannot prevent a caller from choosing its own identity: on the current deployment the header is set by
 * the hosting platform (Vercel documents that it overwrites X-Forwarded-For and does not forward external
 * IPs), and that platform guarantee is the trust boundary. What the function does own - and what every
 * test below pins - is that the identity is always a syntactically valid IPv4 or IPv6 address or the
 * literal "unknown", that whitespace is normalised in both headers, and that a non-address can never
 * become a bucket identity. On a host that forwards a caller's XFF, the first element IS caller-chosen;
 * see docs/operations/environment-contract.md and the security-policy source comment.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isIP } from "node:net";
import { trustedClientIp } from "../lib/security-policy.ts";

/** A Headers-like source, which is all trustedClientIp() reads. */
const withHeaders = (headers: Record<string, string>) => ({ get: (name: string) => headers[name.toLowerCase()] ?? null });
/** Source with comments stripped, so a structural check inspects CODE and not prose. */
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\*.*$/gm, "").replace(/\/\/.*$/gm, "");

// ---- accepted addresses -------------------------------------------------------------------------------------

test("a valid IPv4 X-Forwarded-For is the identity", () => {
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "203.0.113.9" })), "203.0.113.9");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "8.8.8.8" })), "8.8.8.8");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "0.0.0.0" })), "0.0.0.0");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "255.255.255.255" })), "255.255.255.255");
});

test("a valid IPv6 X-Forwarded-For is the identity", () => {
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "::1" })), "::1");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "fe80:0:0:0:0:0:0:1" })), "fe80:0:0:0:0:0:0:1");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "::ffff:1.2.3.4" })), "::ffff:1.2.3.4", "IPv4-mapped");
});

// ---- which element of the chain is taken --------------------------------------------------------------------

test("only the FIRST X-Forwarded-For element is read, and the rest of the chain is discarded", () => {
  // Not a spoof-resistance claim: this pins the Vercel reading, where XFF is the client's own address and
  // any further element is a proxy hop the application has no reason to trust or read.
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" })), "203.0.113.9");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "1.1.1.1,1.1.1.2,1.1.1.3" })), "1.1.1.1");
  // Same first element, different tails: one client, one identity.
  assert.equal(
    trustedClientIp(withHeaders({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })),
    trustedClientIp(withHeaders({ "x-forwarded-for": "1.1.1.1, 8.8.8.8" })),
  );
  // Different first elements: different identities. That is the honest consequence of reading the first
  // element, and it is exactly why the PLATFORM - not this parser - is the trust boundary: on Vercel the
  // header is overwritten before the request gets here, so a caller cannot put its own value first.
  assert.notEqual(
    trustedClientIp(withHeaders({ "x-forwarded-for": "9.9.9.9, 1.1.1.1" })),
    trustedClientIp(withHeaders({ "x-forwarded-for": "8.8.8.8, 1.1.1.1" })),
  );
});

// ---- whitespace ---------------------------------------------------------------------------------------------

test("surrounding whitespace is normalised in BOTH headers", () => {
  // The x-real-ip branch did not trim before P3-S1A, so " 1.2.3.4 " and "1.2.3.4" were two buckets for one client.
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "   8.8.8.8   " })), "8.8.8.8");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "\t8.8.8.8\n" })), "8.8.8.8");
  assert.equal(trustedClientIp(withHeaders({ "x-real-ip": "  198.51.100.7  " })), "198.51.100.7");
  assert.equal(
    trustedClientIp(withHeaders({ "x-forwarded-for": " 8.8.8.8 " })),
    trustedClientIp(withHeaders({ "x-forwarded-for": "8.8.8.8" })),
    "the padded and the bare form are one client, so they must be one identity",
  );
  assert.equal(
    trustedClientIp(withHeaders({ "x-real-ip": " 198.51.100.7 " })),
    trustedClientIp(withHeaders({ "x-real-ip": "198.51.100.7" })),
    "and identically for x-real-ip",
  );
});

// ---- fallthrough --------------------------------------------------------------------------------------------

test("an unusable X-Forwarded-For falls through to a usable x-real-ip", () => {
  for (const forwarded of ["random-value", "999.999.999.999", "010.1.1.1", "1.2.3.4:8080", "", "   ", ", 10.0.0.1", "attacker"]) {
    assert.equal(
      trustedClientIp(withHeaders({ "x-forwarded-for": forwarded, "x-real-ip": "198.51.100.7" })),
      "198.51.100.7",
      `XFF ${JSON.stringify(forwarded)} must fall through`,
    );
  }
});

test("an empty or absent first element is an unusable first element, not an identity", () => {
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "" })), "unknown");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": " " })), "unknown");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": ", 10.0.0.1" })), "unknown");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "10.0.0.1, " })), "10.0.0.1", "a later element is never promoted");
});

// ---- rejection ----------------------------------------------------------------------------------------------

test("arbitrary text and malformed addresses are never identities", () => {
  const rejected = [
    "random-value", "attacker", "unknown-ish", "localhost", "example.com", "1.2.3", "1.2.3.4.5",
    "1.2.3.", ".1.2.3", "256.1.1.1", "999.999.999.999", "010.1.1.1", "1.2.3.4:8080", "1.2.3.4/24",
    "2001:db8::1::2", "2001:db8:::1", "fe80::1%eth0", "gggg::1", "12345::1", "[2001:db8::1]",
    "0x7f.0.0.1", "null", "undefined",
  ];
  for (const value of rejected) {
    assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": value })), "unknown", `must reject ${JSON.stringify(value)}`);
    assert.equal(trustedClientIp(withHeaders({ "x-real-ip": value })), "unknown", `must reject x-real-ip ${JSON.stringify(value)}`);
  }
});

test("an IPv4 with a port is rejected, because the address itself is not a valid IPv4 address", () => {
  assert.equal(isIP("1.2.3.4:8080"), 0, "node's own validator agrees it is not an address");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "1.2.3.4:8080" })), "unknown");
});

test("a huge or malformed value never becomes the identity", () => {
  const huge = `${"9".repeat(10_000)}.1.1.1`;
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": huge })), "unknown");
  assert.equal(trustedClientIp(withHeaders({ "x-real-ip": huge })), "unknown");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "1.1.1.1, ".repeat(2_000) })), "1.1.1.1", "a long chain is still just its first element");
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": `1.1.1.1${" ,9".repeat(5_000)}` })), "1.1.1.1");
});

// ---- fallback and stability ---------------------------------------------------------------------------------

test("no forwarding header at all yields the single 'unknown' identity", () => {
  assert.equal(trustedClientIp(withHeaders({})), "unknown");
  assert.equal(trustedClientIp(withHeaders({ host: "magaza.ege-teknik.com" })), "unknown");
  // Local development and any host that sends no forwarding header all share this one bucket. That is the
  // intended fail-safe direction: throttling degrades, it never fails open.
  assert.equal(trustedClientIp(withHeaders({})), trustedClientIp(withHeaders({ "x-real-ip": "not-an-ip" })));
});

test("the same legitimate address is always the same identity, and different ones differ", () => {
  for (const value of ["203.0.113.9", " 203.0.113.9 ", "203.0.113.9, 10.0.0.1"]) {
    assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": value })), "203.0.113.9", value);
  }
  assert.equal(trustedClientIp(withHeaders({ "x-real-ip": "203.0.113.9" })), "203.0.113.9", "either header, one client");
  assert.notEqual(trustedClientIp(withHeaders({ "x-forwarded-for": "203.0.113.9" })), trustedClientIp(withHeaders({ "x-forwarded-for": "203.0.113.10" })));
  assert.notEqual(trustedClientIp(withHeaders({ "x-forwarded-for": "203.0.113.9" })), trustedClientIp(withHeaders({ "x-forwarded-for": "2001:db8::9" })));
  assert.notEqual(trustedClientIp(withHeaders({ "x-forwarded-for": "203.0.113.9" })), "unknown");
});

// ---- parity with the standard validator --------------------------------------------------------------------

test("the validator agrees with node:net's own isIP() across a broad corpus", () => {
  // The production function cannot import node:net - lib/security-policy.ts is also read by a "use client"
  // admin component and by proxy.ts on the Edge runtime. So instead of hand-rolling acceptance on trust,
  // the hand-rolled form is pinned here, in a plain-node test, to the standard validator it mirrors. The
  // ONE intentional deviation (an IPv6 zone id) is excluded from this corpus and has its own test below.
  const corpus = [
    "0.0.0.0", "1.2.3.4", "255.255.255.255", "203.0.113.9", "010.1.1.1", "1.2.3", "1.2.3.4.5", "256.0.0.1",
    "999.999.999.999", "1.2.3.4:80", "0x7f.0.0.1", "1.2.3.4/24", "127.1", "1.2.3.-4", "1..2.3", "1.2.3.4.",
    "::", "::1", "::2", "1::", "1::2", "fe80::1", "2001:db8::1", "2001:db8:0:0:0:0:0:1", "1:2:3:4:5:6:7:8",
    "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7", "::ffff:1.2.3.4", "::ffff:999.1.1.1", "64:ff9b::1.2.3.4",
    "1:2:3:4:5:6:1.2.3.4", "1:2:3:4:5:6:7:1.2.3.4", "2001:db8::1::2", "1::2::3", "::12345",
    "gggg::1", "2001:db8:::1", "1:2:3:4:5:6:7:8:", ":1:2:3:4:5:6:7", "12345::1", "[::1]", "::1]",
    "random-value", "attacker", "localhost", "", " ", "unknown", "0:0:0:0:0:ffff:1.2.3.4",
  ];
  for (const value of corpus) {
    const expected = isIP(value) !== 0;
    // trustedClientIp accepts exactly the addresses, and answers "unknown" for everything else.
    const actual = trustedClientIp(withHeaders({ "x-forwarded-for": value })) !== "unknown";
    assert.equal(actual, expected, `disagreement with node:net on ${JSON.stringify(value)} (isIP=${isIP(value)})`);
  }
});

test("an IPv6 zone id is the one deliberate deviation from node:net, and it is the stricter side", () => {
  // node:net's isIP("fe80::1%eth0") is 6 - it accepts a zone id. This parser does not, on purpose: a zone id
  // names a LOCAL interface on one host, never appears in a forwarding header, and accepting it would let
  // one client spell the same address two ways and land in two buckets. Rejecting is the safe direction, and
  // it is the only place this validator is stricter than the standard.
  assert.equal(isIP("fe80::1%eth0"), 6, "documenting the standard's behaviour, which this differs from");
  for (const value of ["fe80::1%eth0", "fe80::1%", "%eth0", "1.2.3.4%eth0", "2001:db8::1%a%b"]) {
    assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": value })), "unknown", `must reject ${JSON.stringify(value)}`);
  }
});

// ---- hashing and privacy (no database needed) ---------------------------------------------------------------

const HASH_KEY = "order-lookup";
/** The real key construction from lib/http-security.ts, rebuilt here over the real hashing contract. */
function bucketKey(identity: string, salt = "a".repeat(32)) {
  return `${HASH_KEY}:${createHash("sha256").update(`${salt}:${identity}`).digest("hex")}`;
}

test("the rate-limit key is an opaque hash: no raw address is persisted in it", () => {
  const identity = trustedClientIp(withHeaders({ "x-forwarded-for": "203.0.113.9" }));
  const key = bucketKey(identity);
  assert.equal(key.startsWith(`${HASH_KEY}:`), true, "still scoped, so limits cannot be spent across scopes");
  assert.ok(!key.includes("203.0.113.9"), "the raw address must not appear in the key");
  assert.ok(!key.includes("203"), "nor any fragment of it");
  assert.match(key, /^order-lookup:[0-9a-f]{64}$/, "a fixed-length hex digest");
  // Same client, same key. Distinct clients, distinct keys. Unknown is one shared bucket.
  assert.equal(bucketKey(trustedClientIp(withHeaders({ "x-forwarded-for": " 203.0.113.9 " }))), key);
  assert.notEqual(bucketKey(trustedClientIp(withHeaders({ "x-forwarded-for": "203.0.113.10" }))), key);
  assert.equal(bucketKey(trustedClientIp(withHeaders({}))), bucketKey("unknown"));
  // A different salt yields a different digest, so the stored key is not a lookup table of addresses.
  assert.notEqual(bucketKey(identity, "b".repeat(32)), key);
});

// ---- the repository facts this identity depends on ----------------------------------------------------------

test("no consumer bypasses the shared path: order-lookup, order-create and admin-login all call the shared rateLimit", () => {
  // Structural, and deliberately so: the point is that the three highest-value limiters reach ONE parser,
  // so this slice needed no route edit and a future parser change reaches all of them at once.
  for (const file of ["app/api/orders/lookup/route.ts", "app/api/orders/route.ts", "app/api/auth/login/route.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /await rateLimit\(request,/, `${file} must use the shared rateLimit()`);
    assert.doesNotMatch(source, /clientIp|hashClientIp/, `${file} must not read the client IP itself`);
    assert.match(source, /from "@\/lib\/http-security"/, `${file} must import the shared helper`);
  }
  // And the shared helper is the one that goes through clientIp -> hashWithSecret.
  const httpSecurity = readFileSync("lib/http-security.ts", "utf8");
  assert.match(httpSecurity, /const key=`\$\{scope\}:\$\{await hashWithSecret\(clientIp\(request\)\)\}`/);
  assert.match(httpSecurity, /from "@\/lib\/admin-auth"/);
  // The salt contract that makes all of this fail closed is unchanged.
  const adminAuth = readFileSync("lib/admin-auth.ts", "utf8");
  assert.match(adminAuth, /if\(!secret\|\|secret\.length<32\)throw new Error\("IP_HASH_SALT must contain at least 32 characters"\)/);
  assert.match(adminAuth, /return sha256\(`\$\{secret\}:\$\{value\}`\)/, "the hashing itself is untouched");
  assert.match(codeOf(adminAuth), /export function clientIp\(request:HeaderSource\)\{return trustedClientIp\(request\.headers\)\}/, "clientIp is a thin delegation now");
});

test("no rate-limit constant, limiter store or proxy rule was touched by the client-IP slice", () => {
  for (const [file, pattern] of [
    ["app/api/orders/lookup/route.ts", /rateLimit\(request, "order-lookup", 10, 15 \* 60_000\)/],
    ["app/api/orders/route.ts", /rateLimit\(request,"order-create",8,15\*60_000\)/],
    ["app/api/auth/login/route.ts", /rateLimit\(request, "admin-login", 5, 15 \* 60_000\)/],
  ] as const) {
    assert.match(readFileSync(file, "utf8"), pattern, `${file} keeps its exact scope, limit and window`);
  }
  // The limiter is still one atomic statement, and the policy module still reads no node:* builtin
  // (it is also loaded by a "use client" component and by proxy.ts on the Edge runtime). Comments are
  // stripped first: this file's own documentation NAMES those things in order to rule them out.
  assert.match(readFileSync("lib/rate-limit-db.ts", "utf8"), /onConflictDoUpdate/);
  const policy = codeOf(readFileSync("lib/security-policy.ts", "utf8"));
  assert.doesNotMatch(policy, /from "node:/, "the policy module must stay importable in the browser and on the Edge runtime");
  assert.doesNotMatch(policy, /TRUSTED_HOPS|x-vercel-forwarded-for/, "this slice adds no trusted-proxy model");
});

test("X-Forwarded-For still takes precedence over x-real-ip when both carry a valid address", () => {
  assert.equal(trustedClientIp(withHeaders({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "9.9.9.9" })), "1.1.1.1");
});
