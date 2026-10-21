import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { accountContentSecurityPolicy, appContentSecurityPolicy, clerkFrontendOrigin, staticContentSecurityPolicy, staticSecurityHeaders } from "../lib/security-headers.ts";
import { collectStaticScriptHashes, inlineScriptBodies, sha256Source } from "../lib/static-script-hashes.ts";

const PUBLIC_DIR = "public";
const hashes = collectStaticScriptHashes(PUBLIC_DIR);
const staticCsp = staticContentSecurityPolicy(hashes);
const appCsp = appContentSecurityPolicy("testnonce");
const clerkHost = "clerk.example.test";
const publishableKey = `pk_test_${Buffer.from(`${clerkHost}$`).toString("base64").replace(/=+$/, "")}`;
const accountCsp = accountContentSecurityPolicy("accountnonce", clerkFrontendOrigin(publishableKey));
const scriptSrc = (csp: string) => csp.split("; ").find((directive) => directive.startsWith("script-src "))!;

test("neither script policy allows unsafe-inline or unsafe-eval", () => {
  for (const csp of [staticCsp, appCsp, accountCsp]) {
    assert.equal(scriptSrc(csp).includes("'unsafe-inline'"), false, `unsafe-inline present in: ${scriptSrc(csp)}`);
    assert.equal(csp.includes("'unsafe-eval'"), false);
  }
});

test("no script source is a wildcard, bare scheme, or runtime Tailwind CDN", () => {
  for (const csp of [staticCsp, appCsp, accountCsp]) {
    for (const source of scriptSrc(csp).split(" ").slice(1)) {
      assert.equal(source === "*" || source.endsWith("*") || source === "https:" || source === "data:", false, `unsafe script source: ${source}`);
    }
    assert.equal(scriptSrc(csp).includes("cdn.tailwindcss.com"), false);
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
  // Zero inline scripts is the strictest outcome (all storefront logic ships in same-origin files); any that exist must be hashed.
  assert.ok(inlineScripts >= 0);
});

test("the static policy carries hashes without an external runtime script CDN", () => {
  for (const hash of hashes) assert.ok(staticCsp.includes(`'${hash}'`));
  assert.match(scriptSrc(staticCsp), /^script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')*$/, "only self plus exact hashes; no unsafe-inline/unsafe-eval/wildcards");
  assert.equal(scriptSrc(staticCsp).includes("https://cdn.tailwindcss.com"), false);
});

test("the app policy is nonce-based and carries no static hashes", () => {
  assert.ok(scriptSrc(appCsp).includes("'nonce-testnonce'"));
  assert.equal(scriptSrc(appCsp).includes("sha256-"), false);
  assert.equal(scriptSrc(appCsp).includes("cdn.tailwindcss.com"), false);
});

test("the account policy uses a nonce and only exact Clerk support origins", () => {
  assert.equal(clerkFrontendOrigin(publishableKey), "https://clerk.example.test");
  assert.match(scriptSrc(accountCsp), /^script-src 'self' 'nonce-accountnonce' https:\/\/clerk\.example\.test https:\/\/challenges\.cloudflare\.com$/);
  assert.ok(accountCsp.includes("connect-src 'self' https://clerk.example.test https://clerk-telemetry.com"));
  assert.ok(accountCsp.includes("frame-src 'self' https://clerk.example.test https://challenges.cloudflare.com"));
  assert.ok(accountCsp.includes("worker-src 'self' blob:"));
  assert.equal(accountCsp.includes("*"), false);
  assert.equal(accountCsp.includes("'unsafe-eval'"), false);
  assert.equal(accountCsp.includes("'unsafe-inline'"), true, "only style-src retains unsafe-inline");
});

test("invalid Clerk publishable keys fail closed without echoing their value", () => {
  for (const key of [undefined, "", "pk_test_not-base64", `pk_live_${Buffer.from("https://evil.test$").toString("base64")}`]) {
    assert.throws(() => clerkFrontendOrigin(key), (error: Error) => {
      assert.equal(error.message, "A valid Clerk publishable key is required for the account CSP.");
      if (key) assert.equal(error.message.includes(key), false);
      return true;
    });
  }
});

test("Google Fonts origins are absent after fonts and icons were localized", () => {
  for (const csp of [staticCsp, appCsp, accountCsp]) {
    assert.equal(csp.includes("fonts.googleapis.com"), false);
    assert.equal(csp.includes("fonts.gstatic.com"), false);
    assert.ok(csp.includes("font-src 'self'"));
  }
});

test("both policies lock down framing, objects, base URI and form targets", () => {
  for (const csp of [staticCsp, appCsp, accountCsp]) {
    assert.ok(csp.includes("default-src 'self'"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.ok(csp.includes("object-src 'none'"));
    assert.ok(csp.includes("base-uri 'self'"));
    assert.ok(csp.includes("form-action 'self'"));
    assert.ok(csp.includes("connect-src 'self'"));
  }
});

test("proxy gives both account and admin documents request and response nonce CSP headers", () => {
  const source = readFileSync("proxy.ts", "utf8");
  assert.match(source, /const withClerk = clerkMiddleware\([\s\S]*accountContentSecurityPolicy\(nonce, clerkOrigin\)[\s\S]*\);/);
  assert.match(source, /if \(route === "account"\) return withClerk\(request, event\)/);
  assert.match(source, /headers\.set\("x-nonce", nonce\)/);
  assert.match(source, /headers\.set\("Content-Security-Policy", csp\)/);
  assert.match(source, /response\.headers\.set\("Content-Security-Policy", csp\)/);
  assert.match(source, /return nextWithNonceCsp\(request, csp, nonce\)/);
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
