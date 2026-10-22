/**
 * P2-C1: the Klima Rehberi hub (public/blog.html) gains a progressive-enhancement
 * search over the guides that are already rendered in the document.
 *
 * The feature is deliberately local: no API route, no second dataset, no build
 * step. These tests pin the shipped artefacts (generated markup, stylesheet,
 * self-hosted script) and run the real script in a node:vm sandbox built from the
 * real markup, so behaviour is asserted against what the browser actually gets.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { staticContentSecurityPolicy } from "../lib/security-headers.ts";
import { collectStaticScriptHashes, inlineScriptBodies } from "../lib/static-script-hashes.ts";
import { loadGuideSearch, parseHub, type FakeNode } from "./support/guide-search-sandbox.ts";

const hub = readFileSync("public/blog.html", "utf8");
const css = readFileSync("public/guide.css", "utf8");
const script = readFileSync("public/guide-search.js", "utf8");
const GUIDE_FILES = readdirSync("public/rehber").filter((name) => name.endsWith(".html"));

const cardTags = (html: string) => [...html.matchAll(/<article\b[^>]*\bdata-guide-card\b[^>]*>/g)].map((m) => m[0]);
const sectionTags = (html: string) => [...html.matchAll(/<section\b[^>]*\bdata-guide-section\b[^>]*>/g)].map((m) => m[0]);
/** Card identity + text: what must be identical before and after a filter pass. */
const contentOf = (cards: FakeNode[]) => cards.map((card) => `${card.attrs["data-guide-slug"]}::${card.children.map((child) => child.textContent).join("|")}`);

const INVERTER_HITS = ["klima-secimi-rehberi", "inverter-klima-nedir"];

// ---------------------------------------------------------------------------
// A-D: the shipped markup and styles
// ---------------------------------------------------------------------------

test("A: progressive enhancement - the hub ships a search landmark and no card starts hidden", () => {
  assert.match(hub, /<form class="g-search" action="\/blog\.html" method="get" role="search" aria-labelledby="g-search-title">/);
  const cards = cardTags(hub);
  assert.equal(cards.length, 19, "3 featured + 16 category cards");
  for (const tag of cards) assert.doesNotMatch(tag, /\shidden\b/, `a guide card ships hidden without JavaScript: ${tag}`);
  const sections = sectionTags(hub);
  assert.equal(sections.length, 5, "the featured row plus four categories");
  for (const tag of sections) assert.doesNotMatch(tag, /\shidden\b/, `a guide section ships hidden without JavaScript: ${tag}`);
  // Only the no-results notice is inert up front - it is meaningless until a query misses.
  assert.equal(parseHub(hub).empty.hidden, true);
});

test("B: the field is labelled, typed as search, described by the status region, and comfortably sized", () => {
  const inputTag = /<input[^>]*\bdata-guide-search\b[^>]*>/.exec(hub);
  assert.ok(inputTag, "the hub has no [data-guide-search] field");
  assert.match(inputTag[0], /\bid="guide-search"/);
  assert.match(inputTag[0], /\btype="search"/);
  assert.match(inputTag[0], /\bautocomplete="off"/);
  assert.match(inputTag[0], /\baria-describedby="guide-search-status"/);
  assert.match(hub, /<label[^>]*\bid="g-search-title"[^>]*\bfor="guide-search"[^>]*>Rehberlerde ara<\/label>/, "the visible label must name both the landmark and the field");
  assert.match(hub, /\brole="search"[^>]*\baria-labelledby="g-search-title"/);
  assert.match(css, /\.g-search input\[type=search\]\{[^}]*min-height:48px/);
  assert.match(css, /\.g-search input\[type=search\]\{[^}]*font-size:16px/, "iOS zooms in below 16px");
});

test("C: the result count is announced politely and starts at the full guide count", () => {
  const { status, cards } = parseHub(hub);
  const unique = new Set(cards.map((card) => card.attrs["data-guide-slug"]));
  assert.equal(unique.size, 16);
  assert.equal(status.attrs["id"], "guide-search-status");
  assert.equal(status.attrs["role"], "status");
  assert.equal(status.attrs["aria-live"], "polite");
  assert.equal(status.textContent, `${unique.size} rehberden ${unique.size} gösteriliyor`);
  assert.match(script, /`\$\{total\} rehberden \$\{shown\} gösteriliyor`/, "the script keeps the same wording while filtering");
});

test("D: the no-results state says so plainly and offers a real, non-submitting reset control", () => {
  const { empty, clear } = parseHub(hub);
  assert.equal(clear.tag, "button");
  assert.equal(clear.attrs["type"], "button", "a bare button inside the form would submit it");
  assert.match(empty.textContent, /Aramanızla eşleşen rehber bulunamadı\./);
  assert.match(clear.textContent, /Aramayı temizle/);
  assert.match(css, /\.g-search-empty button\{[^}]*min-height:44px/, "the reset control keeps a 44px touch target");
});

// ---------------------------------------------------------------------------
// E-H: how the filter is implemented
// ---------------------------------------------------------------------------

test("E: filtering only toggles [hidden]; the script never rebuilds or restyles markup", () => {
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|replaceChildren|createElement|appendChild|insertBefore|removeChild/);
  assert.doesNotMatch(script, /classList|\.style\.|setAttribute/);
  const page = loadGuideSearch();
  const before = contentOf(page.cards);
  page.type("inverter");
  assert.deepEqual(contentOf(page.cards), before, "card markup and text must survive a filter pass");
  assert.equal(page.cards.length, 19, "the same card nodes stay in the document");
  assert.equal(page.cards.filter((card) => card.hidden).length, 16, "only the hidden flag moves");
});

test("F: /guide-search.js is self-hosted, deferred, and loaded by the hub alone", () => {
  assert.ok(existsSync("public/guide-search.js"));
  assert.match(hub, /<script src="\/guide-search\.js" defer><\/script>/);
  assert.doesNotMatch(hub, /<script[^>]+src="https?:\/\//, "no third-party script enters the hub");
  assert.ok(hub.indexOf("/store.js") < hub.indexOf("/guide-search.js"), "the storefront bootstrap still runs first");
  for (const file of GUIDE_FILES) {
    const article = readFileSync(`public/rehber/${file}`, "utf8");
    assert.doesNotMatch(article, /guide-search\.js/, `${file} must not load the hub-only search script`);
  }
});

test("G: the hub adds no inline script and no inline handler, so script-src stays 'self'", () => {
  assert.deepEqual(inlineScriptBodies(hub), [], "blog.html has no executable inline script");
  assert.doesNotMatch(hub.replace(/<script[\s\S]*?<\/script>/g, ""), /<[a-z][a-z0-9]*\b[^>]*\son[a-z]+\s*=/i);
  const csp = staticContentSecurityPolicy(collectStaticScriptHashes("public"));
  assert.match(csp, /(^|; )script-src 'self'(;|$)/, "no inline script hash is needed");
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-/);
});

test("H: matching folds Turkish case, so İ/I/ı/i and ASCII queries stay in step", () => {
  assert.match(script, /toLocaleLowerCase\('tr'\)/);
  assert.match(script, /replace\(\/\\u0131\/g, 'i'\)/, "dotless ı must fold onto i as well");
  const page = loadGuideSearch();
  for (const query of ["inverter", "Inverter", "INVERTER", "İNVERTER", "ınverter"]) {
    page.type(query);
    assert.deepEqual(page.visibleSlugs(), INVERTER_HITS, `"${query}" must find the inverter guides`);
  }
  for (const query of ["bakım", "bakim", "BAKIM", "BAKIMI"]) {
    page.type(query);
    assert.deepEqual(page.visibleSlugs(), ["klima-bakimi-ne-zaman"], `"${query}" must find the maintenance guide`);
  }
});

// ---------------------------------------------------------------------------
// I-L: filtering behaviour
// ---------------------------------------------------------------------------

test("I: an empty or whitespace-only query is not a filter", () => {
  const page = loadGuideSearch();
  assert.deepEqual(page.hiddenSlugs(), [], "all 16 guides are visible on load");
  assert.equal(page.hiddenSections().length, 0);
  assert.equal(page.status.textContent, "16 rehberden 16 gösteriliyor");
  assert.equal(page.empty.hidden, true);
  page.type("   ");
  assert.deepEqual(page.hiddenSlugs(), [], "spaces alone must not hide anything");
  assert.equal(page.status.textContent, "16 rehberden 16 gösteriliyor");
  assert.equal(page.empty.hidden, true);
});

test("J: a title query hides every non-matching card and every emptied section", () => {
  const page = loadGuideSearch();
  page.type("multi");
  assert.deepEqual(page.visibleSlugs(), ["multi-sistem-klima-nedir"]);
  assert.equal(page.hiddenSlugs().length, 15);
  assert.equal(page.cards.filter((card) => card.hidden).length, page.cards.length - 1, "both copies of a matching guide stay, everything else goes");
  assert.equal(page.hiddenSections().length, 4, "featured row + three empty categories are hidden, not left as bare headings");
  assert.equal(page.status.textContent, "16 rehberden 1 gösteriliyor");
  assert.equal(page.empty.hidden, true);
});

test("K: a phrase that only appears in a description still finds its guide", () => {
  const page = loadGuideSearch();
  const card = page.cards.find((candidate) => candidate.attrs["data-guide-slug"] === "klima-montaji-oncesi");
  assert.ok(card, "the mounting guide is missing from the hub");
  const title = card.querySelector("[data-guide-title]")!.textContent;
  assert.ok(!title.includes("vakumlama"), "this fixture must stay description-only to prove descriptions are searched");
  page.type("vakumlama");
  assert.deepEqual(page.visibleSlugs(), ["klima-montaji-oncesi"]);
});

test("L: the announced count is unique guides, never the duplicated card count", () => {
  const page = loadGuideSearch();
  assert.equal(page.cards.length, 19, "featured cards repeat three guides");
  assert.equal(new Set(page.cards.map((card) => card.attrs["data-guide-slug"])).size, 16);
  page.type("inverter");
  assert.equal(page.status.textContent, "16 rehberden 2 gösteriliyor");
  assert.equal(page.cards.filter((card) => !card.hidden).length, 3, "two guides, one of them featured as well");
  assert.doesNotMatch(page.status.textContent, /17|18|19/, "duplicates must never inflate the count");
});

// ---------------------------------------------------------------------------
// M-P: recovery, keyboard behaviour, and scope
// ---------------------------------------------------------------------------

test("M: a query that matches nothing hides everything and says so", () => {
  const page = loadGuideSearch();
  page.type("zzz-boyle-bir-rehber-yok");
  assert.deepEqual(page.visibleSlugs(), []);
  assert.equal(page.hiddenSlugs().length, 16);
  assert.equal(page.cards.filter((card) => card.hidden).length, page.cards.length);
  assert.equal(page.hiddenSections().length, page.sections.length);
  assert.equal(page.status.textContent, "16 rehberden 0 gösteriliyor");
  assert.equal(page.empty.hidden, false, "the no-results notice must become visible");
});

test("N: Escape clears an active query and steps aside when there is nothing to clear", () => {
  const page = loadGuideSearch();
  page.type("multi");
  assert.equal(page.hiddenSections().length, 4);
  const escape = page.input.fire("keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(page.input.value, "");
  assert.deepEqual(page.hiddenSlugs(), []);
  assert.equal(page.hiddenSections().length, 0);
  assert.equal(page.status.textContent, "16 rehberden 16 gösteriliyor");
  assert.equal(page.empty.hidden, true);
  assert.equal(page.input.fire("keydown", { key: "Escape" }).defaultPrevented, false, "an empty field must not swallow the key");
});

test("O: Enter never navigates, and the reset button clears the field and returns focus", () => {
  const page = loadGuideSearch();
  assert.equal(page.form.fire("submit").defaultPrevented, true, "the filter must never reload the page");
  assert.equal(page.input.fire("keydown", { key: "Enter" }).defaultPrevented, true);
  page.type("multi");
  page.clear.fire("click");
  assert.equal(page.input.value, "");
  assert.deepEqual(page.hiddenSlugs(), []);
  assert.equal(page.hiddenSections().length, 0);
  assert.equal(page.input.focused, true, "focus must land back in the field");
  assert.equal(page.empty.hidden, true);
});

test("P: the filter carries no second dataset, and the committed hub is exactly what the generator emits", async () => {
  assert.doesNotMatch(script, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|\bimport\s*\(/, "no network or storage: this is a document-only filter");
  assert.ok(script.length < 6000, "the script stays a small filter, not a data payload (the guide text alone is ~3 KB)");
  for (const match of hub.matchAll(/<[a-z0-9]+[^>]*\bdata-guide-title\b[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/g)) {
    assert.ok(!script.includes(match[1].trim()), `guide text was copied into guide-search.js: ${match[1]}`);
  }
  const { buildAll } = await import("../scripts/build-klima-rehberi.mjs") as { buildAll: () => Record<string, string> };
  const generated = buildAll()["public/blog.html"];
  assert.equal(generated, hub, "--check parity: regenerating the hub produces no diff");
  assert.ok(generated.includes('src="/guide-search.js" defer'));
});



