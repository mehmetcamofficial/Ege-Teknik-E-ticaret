/**
 * Paket 1E: premium hero carousel, Klima Rehberi (static, SEO-ready guide pages), verified Google Maps
 * location on the contact page, and a zero-dead-link guard across every static storefront page.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { loadStorefront, storefrontCoreSource } from "./support/storefront-sandbox.ts";
import { LEGACY_GUIDE_SLUGS, legacyGuideRedirects } from "../lib/guide-redirects.ts";
import { STATIC_FRAME_SOURCES, appContentSecurityPolicy, staticContentSecurityPolicy } from "../lib/security-headers.ts";
import { collectStaticScriptHashes, inlineScriptBodies } from "../lib/static-script-hashes.ts";

const read = (f: string) => readFileSync(f, "utf8");
const home = read("public/index.html");
const contact = read("public/contact.html");
const css = read("public/store.css");
const guideCss = read("public/guide.css");
const js = storefrontCoreSource();
const GUIDE_FILES = readdirSync("public/rehber").filter((f) => f.endsWith(".html"));
const ADDRESS = "İkiçeşmelik Mahallesi Süleyman Demirel Bulvarı, Ege Uluçınar Koop. No:13/1D, 09400 Kuşadası/Aydın";

// ---------------------------------------------------------------------------
// Hero carousel: markup
// ---------------------------------------------------------------------------

test("hero carousel: four slides, a tablist wired to them, prev/next/pause controls with labels", () => {
  const hero = home.slice(home.indexOf('<section class="hero hero-carousel"'), home.indexOf('<section class="hero-quick"'));
  const slides = [...hero.matchAll(/<div class="hc-slide[^"]*" id="(hc-slide-\d)" role="tabpanel" aria-roledescription="slayt" aria-label="(\d) \/ 4: [^"]+"/g)];
  assert.equal(slides.length, 4);
  const tabs = [...hero.matchAll(/role="tab" id="hc-tab-\d" aria-controls="(hc-slide-\d)" aria-selected="(true|false)" tabindex="(0|-1)"/g)];
  assert.equal(tabs.length, 4);
  assert.deepEqual(tabs.map((t) => t[1]), slides.map((s) => s[1]));
  assert.equal(tabs.filter((t) => t[2] === "true").length, 1, "exactly one selected tab");
  assert.match(hero, /aria-roledescription="carousel" aria-label="[^"]+"/);
  assert.match(hero, /role="tablist" aria-label="Slayt seçin"/);
  assert.match(hero, /data-hc-pause aria-label="Otomatik geçişi durdur"/);
  assert.match(hero, /data-hc-prev aria-label="Önceki slayt"/);
  assert.match(hero, /data-hc-next aria-label="Sonraki slayt"/);
  // No layout shift: every slide is in the markup, inactive ones hidden from AT and focus.
  assert.equal((hero.match(/class="hc-slide is-active"/g) ?? []).length, 1);
  assert.equal((hero.match(/data-hc-slide aria-hidden="true" inert|data-hc-slide data-series-card="Fairy" aria-hidden="true" inert/g) ?? []).length, 3);
  // Exactly one page H1, in the first slide; later slide titles are H2.
  assert.equal((home.match(/<h1\b/g) ?? []).length, 1);
  assert.match(hero, /<h1 id="hero-title" class="hc-title">/);
});

test("hero carousel imagery: real local product photos with reserved boxes; only the first slide is eager", () => {
  const hero = home.slice(home.indexOf('<section class="hero hero-carousel"'), home.indexOf('<section class="hero-quick"'));
  const imgs = hero.match(/<img\b[^>]*>/g) ?? [];
  assert.ok(imgs.length >= 4);
  for (const img of imgs) {
    assert.match(img, /src="\/assets\/home\/[a-z-]+-\d+\.webp"/, img);
    assert.match(img, /\swidth="\d+" height="\d+"/, img);
    assert.match(img, /\salt="[^"]{8,}"/, img);
  }
  assert.equal(imgs.filter((i) => /fetchpriority="high"/.test(i)).length, 1);
  assert.equal(imgs.filter((i) => /loading="lazy"/.test(i)).length, imgs.length - 1);
});

test("hero carousel CSS: stacked slides (no CLS), 44px controls, hover-only motion, reduced motion honoured", () => {
  assert.match(css, /\.hc-slide\{grid-area:1\/1;/);
  assert.match(css, /\.hc-btn\{display:grid;place-items:center;width:44px;height:44px;/);
  assert.match(css, /\.hc-tabs \[role=tab\]\{[^}]*min-height:48px/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.hc-slide \.stage img,\.hc-ladder li\{transform:none!important;opacity:1!important\}/);
  assert.match(css, /\.hc-controls\{[^}]*visibility:hidden\}\n\.hc-ready \.hc-controls\{visibility:visible\}/, "controls reserve their space before the script runs");
});

// ---------------------------------------------------------------------------
// Hero carousel: behaviour (real store-core.js in the sandbox, with a minimal DOM)
// ---------------------------------------------------------------------------

function node(attrs: Record<string, string> = {}) {
  const classes = new Set<string>((attrs.class ?? "").split(" ").filter(Boolean));
  const attributes = new Map(Object.entries(attrs));
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const n = {
    dataset: {} as Record<string, string>,
    style: { animation: "", setProperty: () => {} },
    offsetWidth: 1,
    children: {} as Record<string, unknown>,
    classList: {
      add: (c: string) => { classes.add(c); },
      remove: (c: string) => { classes.delete(c); },
      contains: (c: string) => classes.has(c),
      toggle: (c: string, force?: boolean) => { const on = force ?? !classes.has(c); if (on) classes.add(c); else classes.delete(c); return on; },
    },
    className: () => [...classes].join(" "),
    setAttribute: (k: string, v: string) => { attributes.set(k, String(v)); },
    getAttribute: (k: string) => attributes.get(k) ?? null,
    removeAttribute: (k: string) => { attributes.delete(k); },
    hasAttribute: (k: string) => attributes.has(k),
    addEventListener: (type: string, fn: (e: unknown) => void) => { (handlers[type] ??= []).push(fn); },
    fire: (type: string, e: unknown = {}) => { for (const fn of handlers[type] ?? []) fn(e); },
    querySelector: (sel: string): unknown => { const v = n.children[sel]; return Array.isArray(v) ? v[0] ?? null : v ?? null; },
    querySelectorAll: (sel: string): unknown[] => { const v = n.children[sel]; return Array.isArray(v) ? v : v ? [v] : []; },
    closest: (sel: string): unknown => (sel.split(",").some((s) => { const m = s.trim().match(/^\[([a-z-]+)\]$/); return m ? attributes.has(m[1]) : false; }) ? n : null),
    focus: () => {},
    contains: () => false,
  };
  return n;
}

function carousel({ reduced = false } = {}) {
  const root = node({ "data-hero-carousel": "" });
  const slides = [0, 1, 2, 3].map((i) => node({ class: i === 0 ? "hc-slide is-active" : "hc-slide", "data-hc-slide": "" }));
  const tabs = [0, 1, 2, 3].map((i) => { const t = node({ "data-hc-tab": String(i) }); t.dataset.hcTab = String(i); return t; });
  const pause = node({ "data-hc-pause": "" }), prev = node({ "data-hc-prev": "" }), next = node({ "data-hc-next": "" }), viewport = node();
  Object.assign(root.children, { "[data-hc-slide]": slides, "[data-hc-tab]": tabs, "[data-hc-viewport]": viewport, "[data-hc-pause]": pause });
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  const cleared: number[] = [];
  const store = loadStorefront({ elements: { "[data-hero-carousel]": root as never } });
  Object.assign(store.context, {
    setTimeout: (fn: () => void, ms: number) => { const id = timers.length + 1; timers.push({ fn, ms, id }); return id; },
    clearTimeout: (id: number) => { cleared.push(id); },
    matchMedia: (q: string) => ({ matches: q.includes("reduce") ? reduced : q.includes("hover") }),
  });
  (store.context.document as Record<string, unknown>).hidden = false;
  store.fn<() => unknown>("initHeroCarousel")();
  const active = () => slides.findIndex((s) => s.classList.contains("is-active"));
  const live = () => timers.filter((t) => !cleared.includes(t.id));
  return { root, slides, tabs, pause, prev, next, timers, live, active };
}

test("autoplay advances every 6.5 s and keeps exactly one visible, non-inert slide", () => {
  const c = carousel();
  assert.equal(c.active(), 0);
  assert.equal(c.live().length, 1);
  assert.equal(c.live()[0].ms, 6500);
  c.live()[0].fn();
  assert.equal(c.active(), 1);
  assert.equal(c.root.dataset.theme, "1");
  assert.equal(c.slides[1].hasAttribute("inert"), false);
  assert.equal(c.slides[0].getAttribute("aria-hidden"), "true");
  assert.equal(c.slides[0].hasAttribute("inert"), true);
  assert.equal(c.tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(c.tabs[1].getAttribute("tabindex"), "0");
  assert.equal(c.tabs[0].getAttribute("tabindex"), "-1");
  assert.ok(c.root.classList.contains("hc-playing"));
});

test("hover and keyboard focus pause autoplay; leaving resumes it", () => {
  const c = carousel();
  c.root.fire("mouseenter");
  assert.equal(c.live().length, 0, "no timer while hovered");
  assert.ok(c.root.classList.contains("hc-paused"));
  c.root.fire("mouseleave");
  assert.equal(c.live().length, 1, "resumes after hover");
  c.root.fire("focusin");
  assert.equal(c.live().length, 0, "no timer while focus is inside");
  c.root.fire("focusout", { relatedTarget: null });
  assert.equal(c.live().length, 1);
});

test("manual navigation stops autoplay for good; the pause button resumes it", () => {
  const c = carousel();
  c.root.fire("click", { target: c.next });
  assert.equal(c.active(), 1);
  assert.equal(c.live().length, 0);
  assert.ok(c.root.classList.contains("hc-stopped"));
  assert.equal(c.pause.getAttribute("aria-label"), "Otomatik geçişi başlat");
  c.root.fire("click", { target: c.prev });
  assert.equal(c.active(), 0);
  c.root.fire("click", { target: c.tabs[3] });
  assert.equal(c.active(), 3);
  c.root.fire("click", { target: c.pause });
  assert.equal(c.live().length, 1, "play restarts autoplay");
  assert.equal(c.pause.getAttribute("aria-label"), "Otomatik geçişi durdur");
});

test("prefers-reduced-motion: autoplay never starts on its own", () => {
  const c = carousel({ reduced: true });
  assert.equal(c.timers.length, 0);
  assert.ok(c.root.classList.contains("hc-stopped"));
  assert.equal(c.pause.getAttribute("aria-label"), "Otomatik geçişi başlat");
});

// ---------------------------------------------------------------------------
// Klima Rehberi
// ---------------------------------------------------------------------------

test("the committed Klima Rehberi pages and sitemap are exactly what the generator produces", async () => {
  const { buildAll } = await import("../scripts/build-klima-rehberi.mjs");
  const files = buildAll() as Record<string, string>;
  assert.ok(Object.keys(files).length >= 18);
  for (const [path, content] of Object.entries(files)) assert.equal(read(path), content, `${path} is stale: run node scripts/build-klima-rehberi.mjs`);
});

test("every guide page carries complete on-page SEO: title, description, canonical, one H1, breadcrumb, OG image", () => {
  assert.ok(GUIDE_FILES.length >= 15);
  const descriptions = new Set<string>();
  for (const file of GUIDE_FILES) {
    const html = read(`public/rehber/${file}`), slug = file.replace(/\.html$/, "");
    const title = html.match(/<title>([^<]+)<\/title>/)![1];
    assert.ok(title.length >= 20 && title.length <= 70, `${file}: title length ${title.length}`);
    const desc = html.match(/<meta name="description" content="([^"]+)">/)![1];
    assert.ok(desc.length >= 90 && desc.length <= 165, `${file}: description length ${desc.length}`);
    assert.ok(!descriptions.has(desc), `${file}: duplicate description`);
    descriptions.add(desc);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://egeteknik\\.tr/rehber/${slug}\\.html">`));
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${file}: exactly one H1`);
    assert.match(html, /<nav class="breadcrumbs" aria-label="İçerik yolu"><a href="\/">Ana Sayfa<\/a>.*<a href="blog\.html">Klima Rehberi<\/a>.*aria-current="page"/);
    const og = html.match(/<meta property="og:image" content="https:\/\/egeteknik\.tr(\/assets\/rehber\/og\/[a-z0-9-]+\.jpg)">/);
    assert.ok(og && existsSync(`public${og[1]}`), `${file}: OG image missing`);
    assert.match(html, /<base href="\/">/, "relative storefront links resolve from the site root");
    // Heading order: no H3 before the first H2, no skipped level.
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1, `${file}: heading jumps h${levels[i - 1]} → h${levels[i]}`);
  }
});

test("guide structured data is valid JSON-LD: BreadcrumbList + Article, FAQPage only when the FAQ is on the page", () => {
  for (const file of GUIDE_FILES) {
    const html = read(`public/rehber/${file}`);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.equal(blocks.length, 1, file);
    const graph = JSON.parse(blocks[0][1])["@graph"] as { "@type": string; mainEntity?: { name: string; acceptedAnswer: { text: string } }[]; itemListElement?: unknown[]; headline?: string }[];
    const types = graph.map((g) => g["@type"]);
    assert.ok(types.includes("BreadcrumbList") && types.includes("Article"), `${file}: ${types}`);
    assert.equal(graph.find((g) => g["@type"] === "BreadcrumbList")!.itemListElement!.length, 3);
    const h1 = html.match(/<h1>([^<]+)<\/h1>/)![1];
    assert.equal(graph.find((g) => g["@type"] === "Article")!.headline, h1.replace(/&amp;/g, "&"));
    const faq = graph.find((g) => g["@type"] === "FAQPage");
    const summaries = [...html.matchAll(/<summary>([^<]+)<\/summary><p>([^<]+)<\/p>/g)].map((m) => [m[1], m[2]]);
    if (!faq) { assert.equal(summaries.length, 0, `${file}: visible FAQ without FAQPage data`); continue; }
    assert.equal(faq.mainEntity!.length, summaries.length, `${file}: every FAQ entry must be visible on the page`);
    faq.mainEntity!.forEach((q, i) => { assert.equal(q.name, summaries[i][0]); assert.equal(q.acceptedAnswer.text, summaries[i][1]); });
    assert.doesNotMatch(blocks[0][1], /Review|AggregateRating|ratingValue/);
  }
});

test("guide images are real local files with alt text and reserved dimensions; below-the-fold ones are lazy", () => {
  for (const file of ["blog.html", ...GUIDE_FILES.map((f) => `rehber/${f}`)]) {
    const html = read(`public/${file}`);
    const imgs = html.match(/<img\b[^>]*>/g) ?? [];
    assert.ok(imgs.length > 0, file);
    for (const img of imgs) {
      const src = img.match(/src="([^"]+)"/)![1];
      assert.ok(src.startsWith("/assets/") && existsSync(`public${src}`), `${file}: missing image ${src}`);
      assert.match(img, /\swidth="\d+" height="\d+"/, `${file}: ${img}`);
      assert.match(img, /\salt="/, `${file}: ${img}`);
      for (const [, set] of img.matchAll(/srcset="([^"]+)"/g)) for (const part of set.split(",")) assert.ok(existsSync(`public${part.trim().split(" ")[0]}`), `${file}: srcset ${part}`);
    }
    assert.ok(imgs.filter((i) => /fetchpriority="high"/.test(i)).length <= 1, file);
  }
});

test("each guide links to products, the selector or contact, and other guides; no placeholder copy", () => {
  for (const file of GUIDE_FILES) {
    const html = read(`public/rehber/${file}`);
    const article = html.slice(html.indexOf('<article class="g-article">'), html.indexOf("</article>"));
    assert.match(article, /href="catalog\.html|href="selector\.html|href="second-hand\.html|href="services\.html/, `${file}: no product, selector or service link`);
    assert.match(html, /href="contact\.html/, `${file}: no contact link`);
    assert.ok((html.match(/href="rehber\/[a-z0-9-]+\.html"/g) ?? []).length >= 3, `${file}: too few guide links`);
    assert.doesNotMatch(html, /lorem|ipsum|TODO|TBD|placeholder|örnek metin|yakında/i, file);
  }
});

test("the guide hub is static, lists every guide and every category, and keeps the managed-posts slot hidden until posts exist", () => {
  const hub = read("public/blog.html");
  assert.match(hub, /<link rel="canonical" href="https:\/\/egeteknik\.tr\/blog\.html">/);
  assert.equal((hub.match(/<h1\b/g) ?? []).length, 1);
  for (const file of GUIDE_FILES) assert.ok(hub.includes(`href="rehber/${file}"`), `hub misses ${file}`);
  for (const cat of ["secim", "teknoloji", "montaj", "ariza"]) { assert.match(hub, new RegExp(`id="${cat}"`)); assert.match(hub, new RegExp(`href="blog\\.html#${cat}"`)); }
  assert.match(hub, /<section class="g-managed" data-managed-blog hidden/);
  assert.match(js, /document\.querySelector\('\[data-managed-blog\]'\)\?\.removeAttribute\('hidden'\)/);
});

test("guide cards share the 1D motion system: 200 ms ease-out lift, image scale, hover-only, reduced-motion off", () => {
  assert.match(guideCss, /\.g-card\{[^}]*transition:transform \.2s ease-out,box-shadow \.2s ease-out,border-color \.2s ease-out\}/);
  assert.match(guideCss, /@media\(hover:hover\) and \(pointer:fine\)\{\n  \.g-card:hover\{transform:translateY\(-3px\);/);
  assert.match(guideCss, /\.g-card:hover \.g-card-media img\{transform:scale\(1\.03\)\}/);
  assert.match(guideCss, /@media\(prefers-reduced-motion:reduce\)\{\.g-card,\.g-card \*/);
});

test("old article.html guide addresses redirect permanently to the static page that covers the topic", () => {
  const redirects = legacyGuideRedirects();
  assert.equal(redirects.length, Object.keys(LEGACY_GUIDE_SLUGS).length);
  for (const r of redirects) {
    assert.equal(r.source, "/article.html");
    assert.equal(r.permanent, true);
    assert.ok(existsSync(`public${r.destination}`), `redirect target missing: ${r.destination}`);
  }
  // The client-side fallback map in store-core.js is the same map.
  const clientMap = JSON.parse(js.match(/const GUIDE_LEGACY=(\{[^}]+\});/)![1].replace(/'/g, '"'));
  assert.deepEqual(clientMap, LEGACY_GUIDE_SLUGS);
});

test("next.config registers the legacy guide redirects", () => {
  const config = read("next.config.ts");
  assert.match(config, /import \{ legacyGuideRedirects \} from "\.\/lib\/guide-redirects";/);
  assert.match(config, /\.\.\.legacyGuideRedirects\(\),\n    \];/);
});

test("article.html sends a legacy slug to its static guide and shows an honest not-found state otherwise", async () => {
  const replaced: string[] = [];
  const article = { innerHTML: "", dataset: {} } as never;
  const legacy = loadStorefront({ path: "article.html", search: "?slug=9000-btu-kac-metrekare", elements: { "[data-article]": article } });
  (legacy.location as unknown as { replace: (u: string) => void }).replace = (u) => replaced.push(u);
  legacy.fn<() => void>("renderArticle")();
  assert.deepEqual(replaced, ["/rehber/btu-kapasite-farklari.html"]);

  const missing = { innerHTML: "", dataset: {} } as { innerHTML: string };
  const store = loadStorefront({ path: "article.html", search: "?slug=olmayan-yazi", elements: { "[data-article]": missing as never }, api: { blog: [], secondHand: [] } });
  await store.fn<() => Promise<void>>("loadManagedContent")();
  assert.match(missing.innerHTML, /Aradığınız yazı bulunamadı/);
  assert.match(missing.innerHTML, /href="blog\.html"/);
});

// ---------------------------------------------------------------------------
// Verified location, Google Maps and CSP
// ---------------------------------------------------------------------------

test("the business address is one verified string everywhere it is published", () => {
  assert.ok(js.includes(`address:'${ADDRESS}'`));
  assert.ok(read("public/llms.txt").includes(`Adres: ${ADDRESS}`));
  assert.match(contact, /<address class="location-address">[\s\S]*İkiçeşmelik Mahallesi Süleyman Demirel Bulvarı,<br>Ege Uluçınar Koop\. No:13\/1D,<br>09400 Kuşadası \/ Aydın/);
});

test("contact page: Google Maps embed with a title, lazy loading and the verified place; directions, e-mail and phone", () => {
  const iframe = contact.match(/<iframe\b[^>]*>/)![0];
  assert.match(iframe, /title="Ege Teknik konumu, Kuşadası — Google Haritalar"/);
  assert.match(iframe, /src="https:\/\/www\.google\.com\/maps\?q=Ege\+Teknik[^"]*&amp;ll=37\.8542159,27\.2652041&amp;z=16&amp;hl=tr&amp;output=embed"/);
  assert.match(iframe, /loading="lazy"/);
  assert.match(contact, /href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=Ege\+Teknik[^"]*" target="_blank" rel="noopener">[\s\S]*?Yol tarifi al<span class="sr-only"> \(Google Haritalar yeni sekmede açılır\)<\/span>/);
  assert.match(contact, /<a href="mailto:info@egeteknik\.tr">/);
  assert.match(contact, /<a href="tel:\+905427957560">/);
  assert.match(contact, /Google’ın gizlilik koşulları/);
  // e-mail stays the first contact channel; WhatsApp is secondary
  assert.ok(contact.indexOf("mailto:info@egeteknik.tr") < contact.indexOf("wa.me/"));
  // the homepage links to the location without embedding a second map
  assert.match(home, /class="visit-band is-compact"[\s\S]*href="contact\.html#konum"/);
  assert.doesNotMatch(home, /<iframe/);
});

test("CSP: the static policy frames exactly https://www.google.com; nothing else is loosened", () => {
  const csp = staticContentSecurityPolicy(collectStaticScriptHashes("public"));
  assert.deepEqual([...STATIC_FRAME_SOURCES], ["https://www.google.com"]);
  assert.match(csp, /(^|; )frame-src https:\/\/www\.google\.com(;|$)/);
  assert.match(csp, /(^|; )script-src 'self'(;|$)/, "no inline script hashes are needed");
  assert.doesNotMatch(csp, /unsafe-eval|\*|maps\.googleapis|gstatic/);
  assert.doesNotMatch(appContentSecurityPolicy("n"), /frame-src/, "the app policy does not frame anything");
  // JSON-LD data blocks are not executable and never enter script-src.
  assert.deepEqual(inlineScriptBodies('<script type="application/ld+json">{"a":1}</script>'), []);
  assert.deepEqual(inlineScriptBodies("<script>run()</script>"), ["run()"]);
});

test("guide pages ship no executable inline script (the static CSP stays script-src 'self')", () => {
  for (const file of GUIDE_FILES) assert.deepEqual(inlineScriptBodies(read(`public/rehber/${file}`)), [], file);
});

// ---------------------------------------------------------------------------
// Zero dead links
// ---------------------------------------------------------------------------

test("zero dead links: every internal href on every static page resolves to a file and every #anchor exists", () => {
  const pages = [...readdirSync("public").filter((f) => f.endsWith(".html")), ...GUIDE_FILES.map((f) => `rehber/${f}`)];
  const exists = (path: string) => path === "" || path === "account" || existsSync(`public/${path}`);
  for (const page of pages) {
    const html = read(`public/${page}`).replace(/<script[\s\S]*?<\/script>/g, "");
    const base = /<base href="\/">/.test(html) ? "" : page.includes("/") ? page.slice(0, page.lastIndexOf("/") + 1) : "";
    for (const [, raw] of html.matchAll(/\shref="([^"]*)"/g)) {
      const href = raw.replace(/&amp;/g, "&");
      assert.ok(href && href !== "#" && !/^javascript:/i.test(href), `${page}: dummy href "${raw}"`);
      if (/^(https?:|mailto:|tel:)/.test(href)) {
        if (href.startsWith("mailto:")) assert.equal(href, "mailto:info@egeteknik.tr", `${page}: unexpected mailto`);
        if (href.startsWith("tel:")) assert.equal(href, "tel:+905427957560", `${page}: unexpected tel`);
        continue;
      }
      const [pathAndQuery, hash] = href.split("#");
      const path = pathAndQuery.split("?")[0];
      const target = path.startsWith("/") ? path.slice(1) : base + path;
      assert.ok(exists(target), `${page}: dead link ${raw}`);
      if (hash && (target === "" ? "index.html" : target).endsWith(".html")) {
        const targetFile = target === "" ? "index.html" : path === "" ? page : target;
        assert.match(read(`public/${targetFile}`), new RegExp(`id="${hash}"`), `${page}: missing anchor ${raw}`);
      }
    }
  }
});
