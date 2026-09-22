import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Site-wide dead-link regression coverage for the static storefront pages
 * (Phase 3A.3E). Catches the exact defect the Production Master Audit found
 * on public/index.html: href="#" placeholders, empty hrefs, javascript:
 * pseudo-links, and in-page #fragment links whose target id doesn't exist -
 * without flagging a legitimate #section link to a real, existing id.
 */

const PUBLIC_DIR = "public";
const pages = readdirSync(PUBLIC_DIR).filter((entry) => entry.endsWith(".html"));

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1]);
}

function idsOf(html: string): Set<string> {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

const pageHtml = new Map(pages.map((page) => [page, readFileSync(join(PUBLIC_DIR, page), "utf8")]));
const pageIds = new Map(pages.map((page) => [page, idsOf(pageHtml.get(page)!)]));

test("public pages exist to test against", () => {
  assert.ok(pages.length > 0);
});

test("no href is exactly # or empty (the placeholder pattern the audit found on the homepage)", () => {
  for (const page of pages) {
    for (const href of hrefsOf(pageHtml.get(page)!)) {
      assert.notEqual(href.trim(), "#", `${page}: href="#" dead link`);
      assert.notEqual(href.trim(), "", `${page}: href="" empty link`);
    }
  }
});

test("no href uses a javascript: pseudo-URL", () => {
  for (const page of pages) {
    for (const href of hrefsOf(pageHtml.get(page)!)) {
      assert.equal(/^\s*javascript:/i.test(href), false, `${page}: javascript: link "${href}"`);
    }
  }
});

test("every in-page #fragment link resolves to a real id on the same page", () => {
  let checked = 0;
  for (const page of pages) {
    for (const href of hrefsOf(pageHtml.get(page)!)) {
      if (!href.startsWith("#") || href === "#") continue;
      checked++;
      const fragment = href.slice(1);
      assert.ok(pageIds.get(page)!.has(fragment), `${page}: href="${href}" has no matching id="${fragment}" on the page`);
    }
  }
  assert.ok(checked > 0, "expected at least one legitimate in-page #fragment link to check");
});

test("every local *.html href points at a page that exists, and any #fragment on it resolves on that target page", () => {
  let checked = 0;
  for (const page of pages) {
    for (const href of hrefsOf(pageHtml.get(page)!)) {
      const m = href.match(/^([a-zA-Z0-9_-]+\.html)(\?[^#]*)?(#([a-zA-Z0-9_-]+))?$/);
      if (!m) continue; // external, mailto:, tel:, wa.me, app routes like /account, etc. - out of scope here
      checked++;
      const [, target, , , fragment] = m;
      assert.ok(pageHtml.has(target), `${page}: href="${href}" points at "${target}", which does not exist under public/`);
      if (fragment) assert.ok(pageIds.get(target)!.has(fragment), `${page}: href="${href}" has no matching id="${fragment}" on ${target}`);
    }
  }
  assert.ok(checked > 0, "expected at least one local *.html link to check");
});

test("the homepage no longer contains any href=\"#\" placeholder (Production Master Audit finding)", () => {
  assert.equal((pageHtml.get("index.html")!.match(/href="#"/g) ?? []).length, 0);
});

test("no inline onclick/oninput/onchange HTML attribute survives on the homepage (the site's CSP has no 'unsafe-hashes', so these are silently non-functional)", () => {
  // Strip <script> bodies first: a JS-assigned el.onclick=... property is a normal event
  // listener, unaffected by CSP, and not what this test is guarding against.
  const html = pageHtml.get("index.html")!.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const attr of ["onclick", "oninput", "onchange"]) {
    assert.equal(new RegExp(`<[a-z]+[^>]*\\s${attr}=`).test(html), false, `index.html still has an inline ${attr}="..." attribute, which the CSP blocks`);
  }
});
