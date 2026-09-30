/**
 * P2-C2: navigation / information-architecture integrity of all 16 generated
 * Klima Rehberi pages (public/rehber/*.html).
 *
 * Every expectation is derived from the committed registry snapshot
 * (data/content/registry-snapshot.json) through the pure domain functions in
 * lib/content-registry.ts — there is no second, hand-kept guide dataset here —
 * and "supported local target" means a target the site itself already offers:
 * the shipped catalog defaults (categories, series, capacities), the contact
 * form's subject options and the storefront's own navigation vocabulary.
 *
 * Scope is navigation only: related entries, table of contents, breadcrumbs,
 * return-to-hub, the registry-backed CTAs, accessibility, structured data and
 * the P2-C1 discovery layer that must stay undisturbed. Nothing is asserted
 * into existence that the generator does not already emit.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { parseRegistrySnapshot, registryToGuides, REGISTRY_SNAPSHOT_PATH, type SourceGuide } from "../lib/content-registry.ts";
import { catalogDefaults } from "../lib/catalog-defaults.ts";
import { fakeElement, loadStorefront, storefrontCoreSource } from "./support/storefront-sandbox.ts";

type GeneratorModule = {
  GUIDE_ORDER: string[];
  CATEGORIES: Record<string, { name: string; short: string; desc: string }>;
  guidePath: (slug: string) => string;
  readingMinutes: (guide: SourceGuide) => number;
};
const { GUIDE_ORDER, CATEGORIES, guidePath, readingMinutes } = (await import("../scripts/build-klima-rehberi.mjs")) as GeneratorModule;

const read = (path: string) => readFileSync(path, "utf8");
const ORIGIN = "https://egeteknik.tr";

const SNAPSHOT = parseRegistrySnapshot(read(REGISTRY_SNAPSHOT_PATH));
const REGISTRY = registryToGuides(SNAPSHOT.entries);
const SLUGS = REGISTRY.map((guide) => guide.slug);
const guideOf = (slug: string) => {
  const guide = REGISTRY.find((entry) => entry.slug === slug);
  assert.ok(guide, `the registry snapshot has no guide "${slug}"`);
  return guide;
};

const HUB = read("public/blog.html");
const SITEMAP = read("public/sitemap.xml");
const CSS = read("public/guide.css");
const STORE_CSS = read("public/store.css");
const CONTACT = read("public/contact.html");
const CORE = storefrontCoreSource();

/* --- the target vocabulary the storefront itself supports ------------------ */
const CATALOG_CATEGORIES = new Set(catalogDefaults.map((product) => product.category));
const CATALOG_SERIES = new Set(catalogDefaults.map((product) => product.series));
const CATALOG_CAPACITIES = new Set(catalogDefaults.map((product) => product.capacity.replace(/\D/g, "")).filter(Boolean));
const NAV_BLOCK = (CORE.match(/const NAV_CATEGORIES=\[([\s\S]*?)\];/) ?? [])[1] ?? "";
const NAV_CATEGORY_SLUGS = new Set([...NAV_BLOCK.matchAll(/'([^']+)'/g)].map((match) => match[1]).filter((_, index) => index % 2 === 0));
const SUBJECT_SELECT = CONTACT.slice(CONTACT.indexOf('name="subject"'));
const CONTACT_SUBJECTS = new Set([...SUBJECT_SELECT.slice(0, SUBJECT_SELECT.indexOf("</select>")).matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]));
const catalogMatches = (filter: { category?: string; series?: string; btu?: string }) =>
  catalogDefaults.some(
    (product) =>
      (!filter.category || product.category === filter.category) &&
      (!filter.series || product.series === filter.series) &&
      (!filter.btu || product.capacity.replace(/\D/g, "") === filter.btu),
  );

/* --- markup helpers ------------------------------------------------------- */
const unesc = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const textOf = (value: string) => unesc(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
const attrOf = (tag: string, name: string) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) ?? [])[1] ?? null;
const listOf = (value: string) =>
  [...value.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a><\/li>/g)].map((match) => ({ href: unesc(match[1]), label: unesc(match[2]) }));

function sliceElement(html: string, open: RegExp, close: string): string {
  const match = open.exec(html);
  if (!match) return "";
  const end = html.indexOf(close, match.index + match[0].length);
  return end < 0 ? html.slice(match.index) : html.slice(match.index, end + close.length);
}
const sliceSection = (html: string, className: string) => sliceElement(html, new RegExp(`<section class="${className}"`), "</section>");

function cardsIn(markup: string) {
  return [...markup.matchAll(/<article class="g-card[^"]*">[\s\S]*?<\/article>/g)].map((match) => {
    const block = match[0];
    return {
      slug: (block.match(/<h[1-6][^>]*><a href="rehber\/([a-z0-9-]+)\.html">/) ?? [])[1] ?? "",
      title: unesc((block.match(/<h[1-6][^>]*><a href="rehber\/[a-z0-9-]+\.html">([^<]*)<\/a>/) ?? [])[1] ?? ""),
      description: unesc((block.match(/<p[^>]*>([^<]*)<\/p>/) ?? [])[1] ?? ""),
      minutes: Number((block.match(/(\d+) dk okuma/) ?? [])[1] ?? NaN),
      alt: attrOf((block.match(/<img\b[^>]*>/) ?? [""])[0], "alt") ?? "",
    };
  });
}


type JsonLdNode = {
  "@type": string;
  headline?: string;
  description?: string;
  image?: string[];
  datePublished?: string;
  dateModified?: string;
  inLanguage?: string;
  articleSection?: string;
  mainEntityOfPage?: string;
  name?: string;
  url?: string;
  author?: { name?: string; url?: string };
  publisher?: { name?: string; url?: string };
  itemListElement?: { "@type"?: string; position?: number; name?: string; item?: string }[];
  mainEntity?: { "@type"?: string; name?: string; acceptedAnswer?: { "@type"?: string; text?: string } }[];
};

function parseGuide(slug: string) {
  const html = read(`public/${guidePath(slug)}`);
  const jsonLdSource = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) ?? [])[1] ?? "";
  const graph = (JSON.parse(jsonLdSource) as { "@graph": JsonLdNode[] })["@graph"];
  const navs = [...html.matchAll(/<nav class="(g-toc g-toc-inline|g-toc)" aria-label="([^"]+)">([\s\S]*?)<\/nav>/g)].map((match) => ({
    classes: match[1],
    label: unesc(match[2]),
    markup: match[0],
    entries: listOf(match[3]),
  }));
  const breadcrumbMarkup = (html.match(/<nav class="breadcrumbs" aria-label="İçerik yolu">([\s\S]*?)<\/nav>/) ?? [])[1] ?? "";
  const crumbs = [...breadcrumbMarkup.matchAll(/<a href="([^"]+)">([^<]+)<\/a>|<span aria-current="page">([^<]+)<\/span>/g)].map((match) =>
    match[1] === undefined
      ? { href: null, label: unesc(match[3]), current: true }
      : { href: unesc(match[1]), label: unesc(match[2]), current: false },
  );
  const relatedMarkup = sliceSection(html, "g-related");
  const productsMarkup = sliceSection(html, "g-products");
  return {
    slug,
    path: guidePath(slug),
    html,
    jsonLdSource,
    graph,
    navs,
    crumbs,
    ids: [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]),
    levels: [...html.matchAll(/<h([1-6])[^>]*>/g)].map((match) => Number(match[1])),
    inlineToc: navs.find((nav) => nav.classes.includes("inline"))?.entries ?? [],
    asideToc: navs.find((nav) => !nav.classes.includes("inline"))?.entries ?? [],
    relatedMarkup,
    related: cardsIn(relatedMarkup),
    productsMarkup,
    products: [...productsMarkup.matchAll(/<a href="([^"]+)">([\s\S]*?)<\/a>/g)].map((match) => ({ href: unesc(match[1]), label: textOf(match[2]) })),
  };
}
type GuidePage = ReturnType<typeof parseGuide>;

/** Every href the generator's own chrome emits (not the authored guide prose). */
function chromeLinks(page: GuidePage): string[] {
  const regions = [
    sliceSection(page.html, "g-products"),
    page.relatedMarkup,
    sliceSection(page.html, "g-cta"),
    sliceElement(page.html, /<aside class="g-aside"/, "</aside>"),
    sliceElement(page.html, /<nav class="breadcrumbs"/, "</nav>"),
  ];
  return regions.flatMap((region) => [...region.matchAll(/\shref="([^"]+)"/g)].map((match) => unesc(match[1])));
}


// ---------------------------------------------------------------------------
// A. Related guides
// ---------------------------------------------------------------------------

test("P2-C2 A · related guides are exactly the registry relationship: resolved, never self, never duplicated", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    assert.deepEqual(page.related.map((card) => card.slug), guide.related, `${guide.slug}: rendered related guides diverge from the registry`);
    assert.ok(guide.related.length >= 3, `${guide.slug}: a useful minimum of 3 related guides is expected`);
    assert.ok(guide.related.length <= SLUGS.length - 1, `${guide.slug}: related guides exceed the 16 published guides`);
    assert.equal(new Set(guide.related).size, guide.related.length, `${guide.slug}: duplicate related guide`);
    assert.ok(!guide.related.includes(guide.slug), `${guide.slug}: a guide must not relate to itself`);
    for (const related of guide.related) {
      assert.ok(SLUGS.includes(related), `${guide.slug}: related "${related}" is not one of the 16 published guides`);
      assert.ok(existsSync(`public/${guidePath(related)}`), `${guide.slug}: related page ${related} is missing`);
    }
  }
});

test("P2-C2 A · every related card shows the related guide's registry title, description, reading time and a decorative image", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    assert.equal(page.related.length, guide.related.length, `${guide.slug}: related card count`);
    page.related.forEach((card, index) => {
      const expected = guideOf(guide.related[index]);
      assert.equal(card.title, expected.title, `${guide.slug}: related card ${index} title`);
      assert.equal(card.description, expected.description, `${guide.slug}: related card ${index} description`);
      assert.equal(card.minutes, readingMinutes(expected), `${guide.slug}: related card ${index} reading time`);
      assert.equal(card.alt, "", `${guide.slug}: related card images stay decorative — the heading link carries the text`);
    });
  }
});

// ---------------------------------------------------------------------------
// B. Table of contents
// ---------------------------------------------------------------------------

test("P2-C2 B · the table of contents lists every section in registry order and every fragment resolves to exactly one id", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    const expected = [
      ...guide.sections.map((section) => ({ href: `${guidePath(guide.slug)}#${section.id}`, label: section.title })),
      ...(guide.faq.length ? [{ href: `${guidePath(guide.slug)}#sss`, label: "Sık sorulan sorular" }] : []),
    ];
    assert.deepEqual(page.inlineToc, expected, `${guide.slug}: TOC entries`);
    for (const entry of page.inlineToc) {
      const [path, fragment] = entry.href.split("#");
      assert.equal(path, guidePath(guide.slug), `${guide.slug}: the TOC must point at this page (base href="/" makes a bare fragment unsafe)`);
      assert.ok(fragment, `${guide.slug}: TOC entry without a fragment: ${entry.href}`);
      assert.equal(page.ids.filter((id) => id === fragment).length, 1, `${guide.slug}: #${fragment} must match exactly one element id`);
    }
    for (const section of guide.sections) {
      assert.match(page.html, new RegExp(`<section class="g-section" id="${section.id}" aria-labelledby="${section.id}-title">`), `${guide.slug}: section ${section.id}`);
      assert.equal(page.ids.filter((id) => id === `${section.id}-title`).length, 1, `${guide.slug}: heading id for ${section.id}`);
    }
  }
});

test("P2-C2 B · no guide page repeats an element id, and every aria-labelledby target exists", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    const counts = new Map<string, number>();
    for (const id of page.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    assert.deepEqual([...counts].filter(([, count]) => count > 1).map(([id]) => id), [], `${guide.slug}: duplicate element ids`);
    for (const target of [...page.html.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1])) {
      assert.ok(page.ids.includes(target), `${guide.slug}: aria-labelledby="${target}" has no target`);
    }
  }
});

test("P2-C2 B · the FAQ anchor exists exactly when the registry guide has FAQ entries", () => {
  let withFaq = 0;
  let withoutFaq = 0;
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    const anchors = page.ids.filter((id) => id === "sss");
    const tocHasFaq = page.inlineToc.some((entry) => entry.href.endsWith("#sss"));
    const summaries = [...page.html.matchAll(/<summary>([^<]*)<\/summary>/g)].map((match) => unesc(match[1]));
    const faqPage = page.graph.find((node) => node["@type"] === "FAQPage");
    if (guide.faq.length === 0) {
      withoutFaq += 1;
      assert.deepEqual(anchors, [], `${guide.slug}: an FAQ anchor without registry FAQ content`);
      assert.equal(tocHasFaq, false, `${guide.slug}: the TOC advertises an FAQ that does not exist`);
      assert.equal(faqPage, undefined, `${guide.slug}: FAQPage without visible FAQ content`);
      assert.deepEqual(summaries, [], `${guide.slug}: FAQ markup without registry FAQ content`);
      continue;
    }
    withFaq += 1;
    assert.equal(anchors.length, 1, `${guide.slug}: the FAQ anchor must appear exactly once`);
    assert.equal(tocHasFaq, true, `${guide.slug}: the FAQ is missing from the TOC`);
    assert.equal(summaries.length, guide.faq.length, `${guide.slug}: visible FAQ count`);
  }
  assert.equal(withFaq + withoutFaq, SLUGS.length);
  assert.ok(withFaq >= 15 && withoutFaq >= 1, `the FAQ anchor must be conditional (with=${withFaq}, without=${withoutFaq})`);
});


test("P2-C2 B · the inline (mobile) and sticky (desktop) TOCs carry the same links, and only one is visible at a time", () => {
  const tabletBlock = CSS.slice(CSS.indexOf("@media(max-width:1023px)"), CSS.indexOf("@media(max-width:720px)"));
  assert.ok(tabletBlock.length > 0, "the tablet breakpoint must exist");
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    assert.equal(page.navs.length, 2, `${guide.slug}: two TOC landmarks`);
    assert.deepEqual(page.asideToc, page.inlineToc, `${guide.slug}: the two TOCs disagree`);
    assert.deepEqual(
      page.navs.map((nav) => nav.label).sort(),
      ["Bu rehberde", "Bu rehberde (yan menü)"],
      `${guide.slug}: each TOC landmark needs its own accessible name`,
    );
    for (const nav of page.navs) assert.ok(nav.entries.length > 0, `${guide.slug}: empty TOC landmark`);
  }
  assert.match(CSS, /\.g-toc-inline\{display:none;/, "the inline TOC is the small-screen variant");
  assert.match(tabletBlock, /\.g-aside \.g-toc\{display:none\}/, "the sticky TOC is hidden where the inline one appears");
  assert.match(tabletBlock, /\.g-toc-inline\{display:block\}/);
  assert.match(CSS, /\.g-aside\{position:sticky;top:180px/, "the desktop TOC column stays sticky");
  assert.match(CSS, /\.g-aside\{position:static/, "the sticky column is released on small screens");
});

// ---------------------------------------------------------------------------
// C. Breadcrumbs and canonical alignment
// ---------------------------------------------------------------------------

test("P2-C2 C · breadcrumbs read Ana Sayfa → Klima Rehberi → this guide, with aria-current only on the last crumb", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    assert.equal(page.crumbs.length, 3, `${guide.slug}: breadcrumb depth`);
    assert.deepEqual(page.crumbs[0], { href: "/", label: "Ana Sayfa", current: false }, `${guide.slug}: first crumb`);
    assert.deepEqual(page.crumbs[1], { href: "blog.html", label: "Klima Rehberi", current: false }, `${guide.slug}: hub crumb`);
    assert.deepEqual(page.crumbs[2], { href: null, label: guide.title, current: true }, `${guide.slug}: current crumb`);
    assert.equal([...page.html.matchAll(/aria-current="page"/g)].length, 1, `${guide.slug}: exactly one aria-current="page"`);
    assert.equal([...page.html.matchAll(/<nav class="breadcrumbs" aria-label="İçerik yolu">/g)].length, 1, `${guide.slug}: one labelled breadcrumb landmark`);
    assert.equal([...page.html.matchAll(/<nav class="breadcrumbs"/g)].length, 1, `${guide.slug}: one breadcrumb landmark`);
    assert.ok(existsSync("public/index.html") && existsSync("public/blog.html"), `${guide.slug}: breadcrumb targets must exist`);
  }
});

test("P2-C2 C/G · BreadcrumbList mirrors the visible trail and agrees with canonical, og:url and the Article URL", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    const canonical = (page.html.match(/<link rel="canonical" href="([^"]+)">/) ?? [])[1];
    const ogUrl = (page.html.match(/<meta property="og:url" content="([^"]+)">/) ?? [])[1];
    const article = page.graph.find((node) => node["@type"] === "Article");
    const breadcrumbList = page.graph.find((node) => node["@type"] === "BreadcrumbList");
    assert.equal(canonical, `${ORIGIN}/${guidePath(guide.slug)}`, `${guide.slug}: canonical`);
    assert.equal(ogUrl, canonical, `${guide.slug}: og:url`);
    assert.ok(article, `${guide.slug}: Article node`);
    assert.equal(article.mainEntityOfPage, canonical, `${guide.slug}: Article.mainEntityOfPage`);
    assert.ok(breadcrumbList, `${guide.slug}: BreadcrumbList node`);
    const items = breadcrumbList.itemListElement ?? [];
    assert.deepEqual(items.map((item) => item.position), [1, 2, 3], `${guide.slug}: breadcrumb positions`);
    assert.deepEqual(items.map((item) => item.name), page.crumbs.map((crumb) => crumb.label), `${guide.slug}: JSON-LD names vs visible labels`);
    assert.deepEqual(items.map((item) => item.item), [`${ORIGIN}/`, `${ORIGIN}/blog.html`, canonical], `${guide.slug}: JSON-LD URLs`);
    assert.ok(items.every((item) => item["@type"] === "ListItem"), `${guide.slug}: breadcrumb items must be ListItems`);
    for (const item of items) {
      const path = (item.item ?? "").replace(`${ORIGIN}/`, "");
      assert.ok(existsSync(`public/${path === "" ? "index.html" : path}`), `${guide.slug}: ${item.item} has no committed file`);
    }
  }
});


// ---------------------------------------------------------------------------
// D. Return navigation
// ---------------------------------------------------------------------------

test("P2-C2 D · every guide keeps a working path back to the hub: breadcrumb, category chip, related section and header nav", () => {
  const hubAnchors = new Set([...HUB.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  assert.match(CORE, /<a href="blog\.html">Klima Rehberi<\/a>/, "the header nav identifies the Rehber context");
  assert.ok(existsSync("public/blog.html"), "the hub must exist");
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    assert.equal(page.crumbs[1].href, "blog.html", `${guide.slug}: the breadcrumb must link back to the hub`);
    assert.match(page.relatedMarkup, /<a class="link-arrow" href="blog\.html">Tüm rehberler/, `${guide.slug}: the related section must link back to the hub`);
    const chip = page.html.match(/<a class="g-cat" href="([^"]+)">([^<]+)<\/a>/);
    assert.ok(chip, `${guide.slug}: the category chip is missing`);
    assert.equal(unesc(chip[1]), `blog.html#${guide.category}`, `${guide.slug}: the category chip must deep-link into its hub section`);
    assert.equal(unesc(chip[2]), CATEGORIES[guide.category].name, `${guide.slug}: the category chip must name the registry category`);
    assert.ok(hubAnchors.has(guide.category), `${guide.slug}: the hub has no #${guide.category} section`);
    assert.match(HUB, new RegExp(`<section class="g-cat-section" id="${guide.category}" data-guide-section`), `${guide.slug}: hub section markup`);
  }
});

test("P2-C2 D · no prev/next navigation is invented; cross-guide links stay in the article prose, the TOC and the related section", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    assert.doesNotMatch(page.html, /rel="(?:prev|next)"/, `${guide.slug}: a prev/next link relation must not exist`);
    assert.doesNotMatch(page.html, /class="[^"]*g-(?:prev|next)/, `${guide.slug}: no prev/next styling hooks`);
    assert.doesNotMatch(page.html, /(Önceki|Sonraki)\s+(rehber|yazı|sayfa)/i, `${guide.slug}: no prev/next labels`);
    const relatedSlugs = [...page.relatedMarkup.matchAll(/href="rehber\/([a-z0-9-]+)\.html"/g)].map((match) => match[1]);
    assert.deepEqual(relatedSlugs, guide.related, `${guide.slug}: the related section must render exactly the registry entry`);
    // Guide links are allowed in three places only: the article prose, the TOC and the related section.
    const withoutProse = page.html.replace(/<section class="g-section[^"]*"[\s\S]*?<\/section>/g, "");
    const withoutRelated = withoutProse.replace(page.relatedMarkup, "");
    const withoutToc = page.navs.reduce((markup, nav) => markup.replace(nav.markup, ""), withoutRelated);
    assert.doesNotMatch(withoutToc, /href="rehber\//, `${guide.slug}: a cross-guide link outside the prose, the TOC and the related section`);
    const tocSlugs = new Set(page.inlineToc.map((entry) => entry.href.split("#")[0].replace(/^rehber\//, "").replace(/\.html$/, "")));
    assert.deepEqual([...tocSlugs], [guide.slug], `${guide.slug}: the TOC must only point at this page`);
    // Every cross-guide link on the page (prose included) must resolve to one of the 16 published guides.
    for (const slug of [...page.html.matchAll(/href="rehber\/([a-z0-9-]+)\.html/g)].map((match) => match[1])) {
      assert.ok(SLUGS.includes(slug), `${guide.slug}: stale guide link ${slug}`);
      assert.ok(existsSync(`public/rehber/${slug}.html`), `${guide.slug}: guide link ${slug} has no committed page`);
    }
  }
});


test("P2-C2 D · the shared header marks the Rehber link as the current page on every guide URL, and only there", () => {
  // The header is injected at runtime by the real store-core.js, so this runs its
  // renderHeader() in the storefront sandbox. The spy root stands in for the rendered
  // header: its querySelector answers for the one link the core looks up, while the
  // rendered markup itself is asserted to carry that link.
  const mountHeader = (path: string) => {
    const marks: string[] = [];
    const rehberLink = {
      getAttribute: (name: string) => (name === "href" ? "blog.html" : null),
      setAttribute: (name: string, value: string) => { marks.push(`${name}=${value}`); },
    };
    const root = fakeElement();
    root.querySelectorAll = () => [];
    root.querySelector = (selector) => (selector === ".nav-links>a[href=\"blog.html\"]" ? rehberLink : null);
    loadStorefront({ path, elements: { "[data-site-header]": root } }).fn<() => void>("renderHeader")();
    return { root, marks };
  };
  assert.ok(SLUGS.length > 0, "the guide set must be readable");
  for (const slug of SLUGS) {
    const { root, marks } = mountHeader(`rehber/${slug}.html`);
    assert.deepEqual(marks, ["aria-current=page"], `${slug}: the header must flag the Rehber link as the current page`);
    assert.match(root.innerHTML, /<a href="blog\.html">Klima Rehberi<\/a>/, `${slug}: the header must keep its Rehber entry`);
  }
  const control = mountHeader("catalog.html");
  assert.deepEqual(control.marks, [], "outside /rehber/ the Rehber link must not claim to be the current page");
  assert.doesNotMatch(control.root.innerHTML, /aria-current/, "the current-page marker is applied by the runtime rule, never baked into the template");
  assert.match(control.root.innerHTML, /<a href="catalog\.html"/, "the control header must still render");
});


// ---------------------------------------------------------------------------
// E. CTA / link integrity (registry-backed only)
// ---------------------------------------------------------------------------

test("P2-C2 E · every registry CTA is rendered in order and resolves to a supported local target", () => {
  assert.ok(CATALOG_CATEGORIES.size > 0 && CATALOG_SERIES.size > 0 && CATALOG_CAPACITIES.size > 0, "the catalog vocabulary must be readable");
  assert.ok(NAV_CATEGORY_SLUGS.size > 0, "the storefront publishes a category vocabulary");
  assert.ok(CONTACT_SUBJECTS.size > 0, "the contact form publishes its subject options");
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    const expected = (guide.products ?? []).map((product) => ({ href: unesc(product.href), label: unesc(product.label) }));
    assert.deepEqual(page.products, expected, `${guide.slug}: the CTA block diverges from the registry`);
    assert.ok(expected.length >= 1, `${guide.slug}: every guide needs at least one registry CTA`);
    for (const cta of expected) {
      const [path, query] = cta.href.split("?");
      assert.match(path, /^[a-z0-9-]+\.html$/, `${guide.slug}: ${cta.href}`);
      assert.ok(existsSync(`public/${path}`), `${guide.slug}: ${cta.href} resolves to no committed page`);
      if (!query) continue;
      const params = new URLSearchParams(query);
      const category = params.get("category");
      const series = params.get("series");
      const btu = params.get("btu");
      if (category) {
        assert.ok(CATALOG_CATEGORIES.has(category), `${guide.slug}: unsupported catalog category "${category}"`);
        assert.ok(NAV_CATEGORY_SLUGS.has(category), `${guide.slug}: "${category}" is not in the storefront navigation vocabulary`);
      }
      if (series) assert.ok(CATALOG_SERIES.has(series), `${guide.slug}: unsupported catalog series "${series}"`);
      if (btu) assert.ok(CATALOG_CAPACITIES.has(btu), `${guide.slug}: unsupported capacity "${btu}"`);
      if (path === "catalog.html") assert.ok(catalogMatches({ category: category ?? undefined, series: series ?? undefined, btu: btu ?? undefined }), `${guide.slug}: ${cta.href} matches no catalog default`);
      if (path === "contact.html") assert.ok(CONTACT_SUBJECTS.has(params.get("subject") ?? ""), `${guide.slug}: unsupported contact subject in ${cta.href}`);
    }
  }
});

test("P2-C2 E · the guide chrome adds no CTA of its own: no invented product, service, price or mapping", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    assert.equal([...page.productsMarkup.matchAll(/<a\s/g)].length, page.products.length, `${guide.slug}: extra links in the CTA block`);
    assert.doesNotMatch(page.productsMarkup, /<img|data-|₺|\bTL\b|fiyat/i, `${guide.slug}: the CTA block invents a product, price or image`);
    const links = chromeLinks(page);
    assert.ok(links.length > 0, `${guide.slug}: the chrome must keep its navigation links`);
    for (const href of links) {
      if (href.startsWith("mailto:")) {
        assert.equal(href, "mailto:info@egeteknik.tr", `${guide.slug}: unexpected mailto ${href}`);
        continue;
      }
      if (href.startsWith("tel:")) {
        assert.equal(href, "tel:+905427957560", `${guide.slug}: unexpected tel ${href}`);
        continue;
      }
      const [pathAndQuery] = href.split("#");
      const [rawPath, query] = pathAndQuery.split("?");
      const path = rawPath.replace(/^\//, "");
      assert.ok(existsSync(`public/${path === "" ? "index.html" : path}`), `${guide.slug}: chrome link ${href} resolves to no committed page`);
      if (!query) continue;
      const params = new URLSearchParams(query);
      const subject = params.get("subject");
      const category = params.get("category");
      if (subject) assert.ok(CONTACT_SUBJECTS.has(subject), `${guide.slug}: chrome link ${href} uses an unsupported subject`);
      if (category) assert.ok(CATALOG_CATEGORIES.has(category), `${guide.slug}: chrome link ${href} uses an unsupported category`);
    }
  }
});


// ---------------------------------------------------------------------------
// F. Accessibility
// ---------------------------------------------------------------------------

test("P2-C2 F · guide shell: one H1, no skipped heading level, labelled landmarks and correct image text", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    assert.equal(page.levels.filter((level) => level === 1).length, 1, `${guide.slug}: exactly one H1`);
    for (let index = 1; index < page.levels.length; index += 1) {
      assert.ok(page.levels[index] <= page.levels[index - 1] + 1, `${guide.slug}: heading jump h${page.levels[index - 1]} → h${page.levels[index]}`);
    }
    assert.match(page.html, /<article class="g-article">\s*<div class="g-answer"><h2 id="g-answer-title">Kısa cevap<\/h2>/, `${guide.slug}: the article must open with the short answer`);
    assert.equal([...page.html.matchAll(/<nav class="breadcrumbs" aria-label="İçerik yolu">/g)].length, 1, `${guide.slug}: labelled breadcrumb landmark`);
    assert.equal([...page.html.matchAll(/<nav class="g-toc[^"]*" aria-label="[^"]+">/g)].length, 2, `${guide.slug}: both TOCs must be labelled landmarks`);
    assert.match(page.html, /<aside class="g-aside" aria-label="Rehber araçları">/, `${guide.slug}: labelled aside landmark`);
    const hero = (page.html.match(/<figure class="g-hero-figure[^"]*">(<img\b[^>]*>)/) ?? [])[1] ?? "";
    assert.equal(unesc(attrOf(hero, "alt") ?? ""), guide.image.alt, `${guide.slug}: the hero image must carry the registry alt text`);
    assert.ok((attrOf(hero, "alt") ?? "").length > 0, `${guide.slug}: the hero image is informative and needs alt text`);
    const caption = guide.image.caption.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(page.html, new RegExp(`<figcaption>${caption}</figcaption>`), `${guide.slug}: the hero caption must be the registry caption`);
    for (const card of page.related) assert.equal(card.alt, "", `${guide.slug}: related card images are decorative`);
    for (const [, img] of page.html.matchAll(/(<img\b[^>]*>)/g)) assert.match(img, /\salt="[^"]*"/, `${guide.slug}: every image needs an alt attribute`);
  }
});

test("P2-C2 F · FAQ stays a native disclosure widget, tables stay keyboard-scrollable and focus styling is intact", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    const faq = sliceSection(page.html, "g-section g-faq");
    if (guide.faq.length === 0) {
      assert.equal(faq, "", `${guide.slug}: an FAQ section without registry FAQ content`);
    } else {
      assert.match(faq, /<section class="g-section g-faq" id="sss" aria-labelledby="sss-title">/, `${guide.slug}: FAQ landmark`);
      assert.match(faq, /<h2 id="sss-title">Sık sorulan sorular<\/h2>/, `${guide.slug}: FAQ heading`);
      assert.equal([...faq.matchAll(/<details>/g)].length, guide.faq.length, `${guide.slug}: one <details> per registry question`);
      assert.equal([...faq.matchAll(/<summary>/g)].length, guide.faq.length, `${guide.slug}: one native <summary> per question`);
      assert.equal([...faq.matchAll(/<details><summary>[^<]*<\/summary><p>[^<]*<\/p><\/details>/g)].length, guide.faq.length, `${guide.slug}: every answer is a text paragraph inside its own disclosure`);
      assert.doesNotMatch(faq, /role="button"|aria-expanded|aria-controls|tabindex|<button|onclick/i, `${guide.slug}: the FAQ must stay a native <details>/<summary> widget`);
    }
    const tables = [...page.html.matchAll(/<table\b/g)].length;
    const regions = [...page.html.matchAll(/<div class="g-table-wrap" role="region" tabindex="0" aria-label="([^"]*)"><table class="[^"]+"><caption>([^<]*)<\/caption>/g)].map((match) => ({ label: unesc(match[1]), caption: match[2] }));
    assert.equal(regions.length, tables, `${guide.slug}: every table must sit in a focusable scroll region`);
    for (const region of regions) assert.equal(region.label, region.caption, `${guide.slug}: the scroll region must repeat the table caption as its name`);
    assert.doesNotMatch(page.html, /<div class="g-table-wrap">/, `${guide.slug}: a bare table wrapper would not be reachable by keyboard`);
  }
  assert.match(CSS, /\.g-table-wrap\{[^}]*overflow-x:auto/, "the table region must actually scroll");
  assert.match(CSS, /\.g-table-wrap:focus-visible\{outline:3px solid var\(--focus\)/, "the scroll region shows focus");
  assert.match(CSS, /\.g-faq summary:focus-visible\{outline:3px solid var\(--focus\)/, "the FAQ summary shows focus");
  assert.match(CSS, /\.g-faq details\[open\] summary::after/, "the FAQ marker follows the native open state");
  assert.match(CSS, /\.g-card:focus-within\{outline:3px solid var\(--focus\)/, "card links show their ring on the card");
  assert.match(CSS, /\.g-card h2 a:focus-visible,\.g-card h3 a:focus-visible\{outline:none\}/, "the stretched card link must not double the ring");
  assert.match(STORE_CSS, /\.store a:focus-visible[^{]*\{outline:3px solid var\(--focus\)/, "the storefront focus ring still applies inside guide pages");
});


// ---------------------------------------------------------------------------
// G. Structured data
// ---------------------------------------------------------------------------

test("P2-C2 G · Article structured data is complete, matches the page and points only at shipped files", () => {
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    assert.equal(page.graph.filter((node) => node["@type"] === "Article").length, 1, `${guide.slug}: exactly one Article node`);
    const article = page.graph.find((node) => node["@type"] === "Article")!;
    const h1 = unesc((page.html.match(/<h1>([^<]+)<\/h1>/) ?? [])[1] ?? "");
    const description = unesc((page.html.match(/<meta name="description" content="([^"]+)">/) ?? [])[1] ?? "");
    assert.equal(article.headline, h1, `${guide.slug}: Article.headline must be the visible H1`);
    assert.equal(article.description, description, `${guide.slug}: Article.description must be the meta description`);
    assert.equal(article.inLanguage, "tr-TR", `${guide.slug}: Article.inLanguage`);
    assert.equal(article.articleSection, CATEGORIES[guide.category].name, `${guide.slug}: Article.articleSection`);
    const images = article.image ?? [];
    assert.ok(images.length >= 1, `${guide.slug}: Article.image`);
    assert.equal(images[0], `${ORIGIN}/assets/rehber/og/${guide.slug}.jpg`, `${guide.slug}: Article.image[0] must be the social card`);
    for (const url of images) {
      const path = url.replace(`${ORIGIN}/`, "").replace(/^\//, "");
      assert.ok(existsSync(`public/${path}`), `${guide.slug}: structured-data image ${url} is not a shipped file`);
    }
    const publishedTime = (page.html.match(/<meta property="article:published_time" content="([^"]+)">/) ?? [])[1];
    assert.ok(publishedTime, `${guide.slug}: article:published_time`);
    assert.equal(article.datePublished, publishedTime, `${guide.slug}: datePublished`);
    assert.equal(article.dateModified, publishedTime, `${guide.slug}: dateModified`);
    const time = page.html.match(/<time datetime="([^"]+)">([^<]+)<\/time>/);
    assert.ok(time, `${guide.slug}: the visible update date is missing`);
    assert.equal(time[1], publishedTime, `${guide.slug}: the visible <time> must carry the structured-data date`);
    const label = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${publishedTime}T00:00:00Z`));
    assert.equal(time[2], label, `${guide.slug}: the visible update label must match the structured-data date`);
    assert.equal(article.author?.name, "Ege Teknik", `${guide.slug}: Article.author`);
    assert.equal(article.publisher?.name, "Ege Teknik", `${guide.slug}: Article.publisher`);
    assert.equal(article.publisher?.url, `${ORIGIN}/`, `${guide.slug}: Article.publisher.url`);
  }
});

test("P2-C2 G · no stale or unknown guide slug in structured data, breadcrumbs or the sitemap", () => {
  const sitemapGuides = [...SITEMAP.matchAll(new RegExp(`<url><loc>${ORIGIN}/rehber/([a-z0-9-]+)\\.html</loc><lastmod>([^<]+)</lastmod></url>`, "g"))].map((match) => ({ slug: match[1], lastmod: match[2] }));
  assert.deepEqual(sitemapGuides.map((entry) => entry.slug).sort(), [...SLUGS].sort(), "the sitemap must list exactly the 16 published guides");
  assert.equal([...SITEMAP.matchAll(/<url>/g)].length, 8 + SLUGS.length, "the sitemap must list the eight static pages plus the 16 guides");
  for (const page of ["", "catalog.html", "services.html", "selector.html", "regions.html", "blog.html", "contact.html", "second-hand.html"]) {
    assert.ok(SITEMAP.includes(`<loc>${ORIGIN}/${page}</loc>`), `the sitemap misses /${page}`);
  }
  for (const entry of sitemapGuides) {
    assert.ok(existsSync(`public/rehber/${entry.slug}.html`), `the sitemap lists the missing page ${entry.slug}`);
    assert.match(entry.lastmod, /^\d{4}-\d{2}-\d{2}$/, `${entry.slug}: lastmod format`);
  }
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    const urls = [...page.jsonLdSource.matchAll(new RegExp(`${ORIGIN}/rehber/([a-z0-9-]+)\\.html`, "g"))].map((match) => match[1]);
    assert.ok(urls.includes(guide.slug), `${guide.slug}: structured data must describe this page`);
    for (const slug of urls) {
      assert.ok(SLUGS.includes(slug), `${guide.slug}: stale guide slug "${slug}" in structured data`);
      assert.ok(existsSync(`public/rehber/${slug}.html`), `${guide.slug}: structured data points at the missing page ${slug}`);
    }
  }
});


// ---------------------------------------------------------------------------
// H. Discovery regression (P2-C1) and frozen URLs
// ---------------------------------------------------------------------------

test("P2-C2 H · the P2-C1 discovery layer stays hub-only and the guide set, counts and URLs are unchanged", () => {
  const files = readdirSync("public/rehber").filter((name) => name.endsWith(".html")).sort();
  assert.deepEqual(files, [...SLUGS].sort().map((slug) => `${slug}.html`), "public/rehber must hold exactly the 16 published guides");
  assert.equal(REGISTRY.length, 16, "guide count");
  assert.equal(new Set(SLUGS).size, 16, "the guide slugs must be unique");
  assert.deepEqual([...SLUGS].sort(), [...GUIDE_ORDER].sort(), "the frozen hub order still names exactly the published guides");
  const counts: Record<string, number> = {};
  for (const guide of REGISTRY) counts[guide.category] = (counts[guide.category] ?? 0) + 1;
  assert.deepEqual(counts, { secim: 7, teknoloji: 4, montaj: 3, ariza: 2 }, "category counts");
  for (const guide of REGISTRY) {
    const page = parseGuide(guide.slug);
    assert.doesNotMatch(page.html, /data-guide/, `${guide.slug}: the search hooks are hub-only`);
    assert.doesNotMatch(page.html, /guide-search\.js/, `${guide.slug}: the hub script must not load on guide pages`);
    assert.ok(HUB.includes(`href="${guidePath(guide.slug)}"`), `the hub misses ${guide.slug}`);
    assert.match(SITEMAP, new RegExp(`<loc>${ORIGIN}/${guidePath(guide.slug)}</loc>`), `the sitemap misses ${guide.slug}`);
  }
  assert.equal([...HUB.matchAll(/data-guide-card/g)].length, 19, "3 featured + 16 category cards");
  assert.equal(new Set([...HUB.matchAll(/data-guide-slug="([a-z0-9-]+)"/g)].map((match) => match[1])).size, 16, "unique guide slugs on the hub");
  assert.equal([...HUB.matchAll(/data-guide-section/g)].length, 5, "the featured row plus four categories");
  for (const [key, count] of Object.entries(counts)) {
    assert.match(HUB, new RegExp(`<span class="eyebrow">${count} rehber</span><h2 id="${key}-title">`), `hub section header for ${key}`);
    assert.match(HUB, new RegExp(`<small>${count} rehber</small>`), `hub category nav count for ${key}`);
    assert.match(HUB, new RegExp(`<a href="blog\\.html#${key}"><b>`), `hub category nav link for ${key}`);
  }
  assert.match(HUB, /<script src="\/guide-search\.js" defer><\/script>/, "the hub ships the search script deferred");
  assert.equal([...HUB.matchAll(/<script src="\/guide-search\.js"/g)].length, 1, "the hub ships the search script once");
  const script = read("public/guide-search.js");
  assert.doesNotMatch(script, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|import\s*\(/, "the local search must stay local: no API, no storage, no dynamic import");
  assert.match(script, /toLocaleLowerCase\('tr'\)/, "the Turkish folding behaviour of P2-C1 must survive");
});
