import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { appContentSecurityPolicy, staticContentSecurityPolicy, staticSecurityHeaders } from "../lib/security-headers.ts";
import { collectStaticScriptHashes, inlineScriptBodies, sha256Source } from "../lib/static-script-hashes.ts";

const PUBLIC_DIR = "public";
const hashes = collectStaticScriptHashes(PUBLIC_DIR);
const staticCsp = staticContentSecurityPolicy(hashes);
const appCsp = appContentSecurityPolicy("testnonce");
const scriptSrc = (csp: string) => csp.split("; ").find((directive) => directive.startsWith("script-src "))!;

test("neither script policy allows unsafe-inline or unsafe-eval", () => {
  for (const csp of [staticCsp, appCsp]) {
    assert.equal(scriptSrc(csp).includes("'unsafe-inline'"), false, `unsafe-inline present in: ${scriptSrc(csp)}`);
    assert.equal(csp.includes("'unsafe-eval'"), false);
  }
});

test("no script source is a wildcard or bare scheme", () => {
  for (const csp of [staticCsp, appCsp]) {
    for (const source of scriptSrc(csp).split(" ").slice(1)) {
      assert.equal(source === "*" || source.endsWith("*") || source === "https:" || source === "data:", false, `unsafe script source: ${source}`);
    }
  }
});

test("every inline script in every static page is covered by a hash", () => {
  const pages = readdirSync(PUBLIC_DIR).filter((entry) => entry.endsWith(".html"));
  assert.ok(pages.length > 0, "expected static pages to audit");
  let inlineScripts = 0;
  for (const page of pages) {
    for (const body of inlineScriptBodies(readFileSync(join(PUBLIC_DIR, page), "utf8"))) {
      inlineScripts += 1;
      assert.ok(hashes.includes(sha256Source(body)), `inline script in ${page} is not allowlisted by the CSP`);
    }
  }
  assert.ok(inlineScripts > 0, "expected at least one inline script to be hashed");
});

test("the static policy carries hashes and the Tailwind CDN the storefront loads", () => {
  assert.ok(hashes.length > 0);
  for (const hash of hashes) assert.ok(staticCsp.includes(`'${hash}'`));
  assert.ok(scriptSrc(staticCsp).includes("https://cdn.tailwindcss.com"));
});

test("the app policy is nonce-based and carries no static hashes", () => {
  assert.ok(scriptSrc(appCsp).includes("'nonce-testnonce'"));
  assert.equal(scriptSrc(appCsp).includes("sha256-"), false);
  assert.equal(scriptSrc(appCsp).includes("cdn.tailwindcss.com"), false);
});

test("both policies lock down framing, objects, base URI and form targets", () => {
  for (const csp of [staticCsp, appCsp]) {
    assert.ok(csp.includes("default-src 'self'"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.ok(csp.includes("object-src 'none'"));
    assert.ok(csp.includes("base-uri 'self'"));
    assert.ok(csp.includes("form-action 'self'"));
    assert.ok(csp.includes("connect-src 'self'"));
  }
});

test("the supporting security headers are present with safe values", () => {
  const headers = Object.fromEntries(staticSecurityHeaders.map((header) => [header.key, header.value]));
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.ok(headers["Strict-Transport-Security"].includes("max-age=31536000"));
  assert.ok(headers["Permissions-Policy"].includes("payment=()"));
});

test("inline script extraction ignores external scripts and empty bodies", () => {
  assert.deepEqual(inlineScriptBodies('<script src="/store.js"></script>'), []);
  assert.deepEqual(inlineScriptBodies("<script></script>"), []);
  assert.deepEqual(inlineScriptBodies('<script id="x">alert(1)</script>'), ["alert(1)"]);
  assert.deepEqual(inlineScriptBodies('<script src="/a.js"></script><script>b()</script>'), ["b()"]);
});
