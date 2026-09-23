/**
 * Phase 3A.3F claim audit: factual/certification/warranty/performance claims the project
 * holds no evidence for were removed from the storefront. This keeps them from creeping
 * back into shipped pages (visible text and customer-facing attributes) or store.js
 * templates. Product specifications are unaffected: they come from the catalog API at
 * runtime, not from these source files.
 *
 * If the business supplies evidence (dealer certificate, warranty terms, test protocol),
 * restore the claim together with that evidence and narrow the matching pattern here.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const UNVERIFIED = [
  { name: "dealer/authorisation status", pattern: /yetkili\s+(bayi|satıcı|satış|servis|iklimlendirme)|resmi\s+(gree|satış|distribüt)|distribütör/i },
  { name: "certification", pattern: /sertifikal/i },
  { name: "warranty period", pattern: /\d+\s*yıl(lık)?\s*(fabrika\s*|kompresör\s*)?garanti/i },
  { name: "inspection-point count", pattern: /\d+\s*nokta\s*(test|kontrol)/i },
  { name: "grading scheme", pattern: /\bgrade\s*[ab]/i },
  { name: "noise figure", pattern: /\d+\s*dB\b/ },
  { name: "hard-coded energy class", pattern: /\bA\+{2,3}/ },
  { name: "percentage performance/saving figure", pattern: /%\s?\d+|\d+\s?%/ },
  { name: "instalment/payment offer (payments are not live)", pattern: /taksit/i },
  { name: "campaign that does not exist", pattern: /kampanya/i },
  { name: "free-service promise", pattern: /ücretsiz/i },
  { name: "originality claim", pattern: /orijinal/i },
  { name: "cipher-strength claim", pattern: /256[-\s]?bit/i },
  { name: "third-party guarantee", pattern: /güvences/i },
  { name: "same-day promise", pattern: /aynı\s*gün/i },
  { name: "fixed delivery period", pattern: /\d+\s*[–-]\s*\d+\s*iş\s*günü/i },
];

function customerFacingText(html: string) {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "");
  const attributes = [...body.matchAll(/\b(?:content|title|alt|aria-label|placeholder)="([^"]*)"/g)].map((m) => m[1]);
  return [...body.split(/<[^>]+>/), ...attributes].join("\n");
}

const pages = readdirSync("public").filter((f) => f.endsWith(".html") && f !== "admin.html");

test("no storefront page makes a claim the project holds no evidence for", () => {
  for (const page of pages) {
    const text = customerFacingText(readFileSync(`public/${page}`, "utf8"));
    for (const { name, pattern } of UNVERIFIED) {
      const hit = text.match(pattern);
      assert.equal(hit, null, `${page}: unverified ${name}: "${hit?.[0]}"`);
    }
  }
});

test("store.js templates make none of those claims either", () => {
  // Only rendered strings matter: template literals and quoted strings, not code or comments.
  // Excluded on purpose: the editorial guide list (`const articles=[...]`), whose titles explain
  // topics such as "A++ ve A+++ Arasındaki Fark" rather than claim anything about our products,
  // and URL attribute values (e.g. "Yedek%20Parça" is URL encoding, not a percentage).
  const source = readFileSync("public/store.js", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/const articles=\[[\s\S]*?\]\];/, "")
    .replace(/\bhref="[^"]*"/g, "");
  assert.ok(!/const articles=/.test(source), "the guide list moved - update this exclusion rather than dropping coverage");
  const literals = [...source.matchAll(/`[^`]*`|'[^'\n]*'/g)].map((m) => m[0]).join("\n");
  for (const { name, pattern } of UNVERIFIED) {
    const hit = literals.match(pattern);
    assert.equal(hit, null, `store.js: unverified ${name}: "${hit?.[0]}"`);
  }
});

test("checkout does not present an inactive card payment as selectable or working", () => {
  // PayTR/iyzico are not live (see public/policies.html). The only enabled choice is the
  // confirm-later option, it is the default, and the page says plainly that no card payment is taken.
  const html = readFileSync("public/checkout.html", "utf8");
  const radios = [...html.matchAll(/<input\b[^>]*name="provider"[^>]*>/g)].map((m) => m[0]);
  assert.equal(radios.length, 3);
  for (const radio of radios) {
    const live = /value="discovery"/.test(radio);
    assert.equal(/\sdisabled\b/.test(radio), !live, `${radio} enabled state`);
    assert.equal(/\schecked\b/.test(radio), live, `${radio} default state`);
  }
  assert.match(html, /kartla ödeme henüz aktif değil/i);
  assert.doesNotMatch(customerFacingText(html), /3D Secure|güvenli ödeme|ödeme bağlantısı/i);
});

test("customer-facing placeholders say what is missing instead of promising supplier content", () => {
  const source = readFileSync("public/store.js", "utf8");
  assert.doesNotMatch(source, /Bayiden eklenecek|bayi görselleri/i);
  assert.doesNotMatch(readFileSync("public/second-hand.html", "utf8"), /şablon/i);
});
