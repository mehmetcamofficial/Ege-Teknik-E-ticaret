/**
 * Canonical domain + clean root URL (hotfix).
 *
 * Routing contract (see next.config.ts):
 *  - GET /            -> serves public/index.html internally, URL stays "/"
 *  - GET /index.html  -> 308 permanent redirect to "/"
 *  - www.egeteknik.tr/:path* -> 308 permanent redirect to apex, path+query preserved
 *  - No redirect loops: the "/" rewrite never fires for "/index.html",
 *    and the "/index.html" redirect never fires for "/".
 *
 * These tests assert the configured rules structurally (the plain
 * `node --test` runner cannot boot Next), plus the static-file side:
 * single homepage source, canonical tag, no stray index.html self-links.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const nextConfig = readFileSync("next.config.ts", "utf8");
const homepage = readFileSync("public/index.html", "utf8");
const storeJs = readFileSync("public/store.js", "utf8");

type Redirect = { source: string; destination: string; permanent?: boolean; has?: Array<{ type: string; value: string }> };

/** Minimal parser for the redirects()/rewrites() literals in next.config.ts. */
function redirectsOf(src: string): Redirect[] {
  const block = src.slice(src.indexOf("async redirects()"), src.indexOf("async rewrites()"));
  return [...block.matchAll(/source:\s*"([^"]+)"[\s\S]*?(?:has:\s*\[\{\s*type:\s*"([^"]+)",\s*value:\s*"([^"]+)"\s*\}\][\s\S]*?)?destination:\s*"([^"]+)"[\s\S]*?permanent:\s*(true|false)/g)].map(
    (m) => ({
      source: m[1],
      destination: m[4],
      permanent: m[5] === "true",
      has: m[2] ? [{ type: m[2], value: m[3] }] : undefined,
    }),
  );
}

const redirects = redirectsOf(nextConfig);
const bySource = (source: string) => redirects.find((r) => r.source === source && !r.has);
const wwwRule = redirects.find((r) => r.has?.some((h) => h.type === "host" && h.value === "www.egeteknik.tr"));

test("app/page.tsx redirect to /index.html is gone (root cause removed)", () => {
  assert.equal(existsSync("app/page.tsx"), false, "app/page.tsx must not reintroduce redirect(\"/index.html\")");
});

test("GET / rewrites internally to /index.html with no redirect", () => {
  assert.match(nextConfig, /beforeFiles:\s*\[\{\s*source:\s*"\/",\s*destination:\s*"\/index\.html"\s*\}\]/);
  assert.equal(bySource("/"), undefined, "no redirect may fire for / or the clean URL would not survive");
});

test("GET /index.html permanently redirects to /", () => {
  const rule = bySource("/index.html");
  assert.ok(rule, "missing /index.html redirect rule");
  assert.equal(rule.destination, "/");
  assert.equal(rule.permanent, true);
});

test("www host permanently redirects to apex preserving path", () => {
  assert.ok(wwwRule, "missing www.egeteknik.tr -> apex redirect rule");
  assert.equal(wwwRule.permanent, true);
});

test("www / and /index.html land on the apex in a single hop (no chain)", () => {
  // www/index.html -> apex / directly (not via apex /index.html).
  const text = nextConfig.slice(nextConfig.indexOf("async redirects()"), nextConfig.indexOf("async rewrites()"));
  assert.match(text, /source:\s*"\/index\.html"[\s\S]*?has:\s*\[\{\s*type:\s*"host",\s*value:\s*"www\.egeteknik\.tr"\s*\}\][\s\S]*?destination:\s*"https:\/\/egeteknik\.tr\/"/);
});

test("no redirect loop: rewrite and /index.html redirect target disjoint paths", () => {
  // The rewrite source is exactly "/" and the redirect source is exactly
  // "/index.html" — neither matches the other's input or output.
  assert.ok(!nextConfig.match(/source:\s*"\/:path\*"/) || wwwRule, "unexpected catch-all redirect");
  const redirectToIndex = redirects.filter((r) => r.destination.includes("index.html"));
  assert.equal(redirectToIndex.length, 0, `nothing may redirect TO /index.html: ${JSON.stringify(redirectToIndex)}`);
});

test("homepage ships canonical https://egeteknik.tr/", () => {
  assert.match(homepage, /<link rel="canonical" href="https:\/\/egeteknik\.tr\/"\s*\/?>/);
  assert.equal(homepage.match(/rel="canonical"/g)?.length ?? 0, 1, "exactly one canonical tag expected");
});

test("storefront self-links point at / instead of index.html", () => {
  for (const [name, src] of [["public/index.html", homepage], ["public/store.js", storeJs]] as const) {
    assert.equal(src.includes('href="index.html"'), false, `${name} still links to index.html`);
    assert.equal(src.includes("href='/index.html'"), false, `${name} still links to index.html`);
    assert.equal(src.includes('href="/index.html"'), false, `${name} still links to /index.html`);
  }
  assert.ok(homepage.includes('href="/"'), "homepage brand link should point at /");
  assert.ok(storeJs.includes('href="/"'), "shared header/footer should point at /");
});

test("robots.txt and sitemap.xml use the canonical apex host", () => {
  const robots = readFileSync("public/robots.txt", "utf8");
  const sitemap = readFileSync("public/sitemap.xml", "utf8");
  assert.match(robots, /Sitemap:\s*https:\/\/egeteknik\.tr\/sitemap\.xml/);
  assert.ok(!robots.includes("chatgpt.site"), "robots.txt still references a preview host");
  assert.ok(!sitemap.includes("chatgpt.site"), "sitemap.xml still references a preview host");
  assert.ok(!sitemap.includes("index.html"), "sitemap must list the clean / URL, not /index.html");
  assert.ok(sitemap.includes("<loc>https://egeteknik.tr/</loc>"), "sitemap must list the canonical homepage");
});
