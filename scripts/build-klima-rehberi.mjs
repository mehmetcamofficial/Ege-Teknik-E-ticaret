#!/usr/bin/env node
/**
 * Klima Rehberi static page generator (Paket 1E, P2-A: registry-driven).
 *
 * The guide hub (public/blog.html) and every guide article (public/rehber/<slug>.html) are
 * pre-rendered static HTML so their full text, headings, breadcrumbs and structured data are
 * in the document itself (crawlable without JavaScript).
 *
 * P2-A pipeline: Preview DB --(explicit export)--> data/content/registry-snapshot.json
 * --(this script)--> public/blog.html + public/rehber/<slug>.html + public/sitemap.xml.
 * Content input is the COMMITTED snapshot file via the pure domain functions in
 * lib/content-registry.ts (parseRegistrySnapshot + registryToGuides). This script never
 * contacts PostgreSQL/Neon: no driver import, no database-adapter import,
 * no connection string.
 * The frozen scripts/klima-rehberi/guides-*.mjs sources remain as recovery/reference
 * fixtures only and are no longer read by the generator.
 *
 *   node scripts/build-klima-rehberi.mjs          write the pages + sitemap
 *   node scripts/build-klima-rehberi.mjs --check  exit 1 when a committed page is out of date
 *
 * No inline executable script is emitted: structured data uses <script type="application/ld+json">,
 * which browsers never execute, so the static CSP stays `script-src 'self'`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistrySnapshot, registryToGuides, REGISTRY_SNAPSHOT_PATH } from "../lib/content-registry.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* P2-A: the committed snapshot is the ONLY content input. Read it once,
 * parse via the pure domain function, and rebuild the exact SourceGuide
 * shape the renderer already consumes. No DB, no network, no pg.
 *
 * Order contract: the legacy generator consumed guides in source-file order
 * (guides-1, then guides-2, then guides-3), and renderHub/renderSitemap emit
 * pages in GUIDES order. The snapshot stores entries sorted by id, so restore
 * the legacy hub order explicitly via the frozen list below. This list is the
 * hub presentation order only — the content of every guide comes from the
 * snapshot. The frozen guides-*.mjs files are no longer read at all; they
 * remain as recovery/reference fixtures. */
const SNAPSHOT_FILE = join(ROOT, REGISTRY_SNAPSHOT_PATH);
const SNAPSHOT = parseRegistrySnapshot(readFileSync(SNAPSHOT_FILE, "utf8"));
/* Frozen hub order (source-file order of the legacy generator). Changing this
 * list changes public output (blog.html ItemList, hub sections, sitemap). */
export const GUIDE_ORDER = [
  "klima-secimi-rehberi",
  "klima-btu-hesaplama",
  "btu-kapasite-farklari",
  "mekana-gore-klima-secimi",
  "salon-tipi-klima",
  "multi-sistem-klima-nedir",
  "ikinci-el-klima-alinir-mi",
  "inverter-klima-nedir",
  "enerji-sinifi-seer-scop",
  "wifi-klima-ne-ise-yarar",
  "gree-serileri-karsilastirma",
  "klima-montaji-oncesi",
  "yerinde-kesif-neden-onemli",
  "klima-bakimi-ne-zaman",
  "klima-neden-sogutmaz",
  "klima-neden-su-akitir",
];
const GUIDE_INDEX = new Map(GUIDE_ORDER.map((slug, i) => [slug, i]));
const REGISTRY_GUIDES = registryToGuides(SNAPSHOT.entries);
if (REGISTRY_GUIDES.length !== GUIDE_ORDER.length) {
  throw new Error(`snapshot holds ${REGISTRY_GUIDES.length} guides, expected ${GUIDE_ORDER.length}`);
}
for (const guide of REGISTRY_GUIDES) {
  if (!GUIDE_INDEX.has(guide.slug)) throw new Error(`snapshot guide "${guide.slug}" is not in the frozen hub order`);
}
export const GUIDES = [...REGISTRY_GUIDES].sort((a, b) => GUIDE_INDEX.get(a.slug) - GUIDE_INDEX.get(b.slug));
const ORIGIN = "https://egeteknik.tr";
const PUBLISHED = "2026-09-28";
const UPDATED_LABEL = "28 Eylül 2026";

export const CATEGORIES = {
  secim: { name: "Seçim ve kapasite", short: "Seçim", desc: "Doğru kapasite, klima tipi ve mekâna göre seçim." },
  teknoloji: { name: "Teknoloji ve verimlilik", short: "Teknoloji", desc: "Inverter, enerji sınıfı, Wi-Fi ve GREE seri karşılaştırması." },
  montaj: { name: "Montaj, keşif ve bakım", short: "Montaj ve bakım", desc: "Montaj öncesi hazırlık, yerinde keşif ve periyodik bakım." },
  ariza: { name: "Arıza ve kullanım", short: "Arıza", desc: "Soğutmama ve su akıtma gibi sık karşılaşılan sorunlar." },
};

/* Every image is a real, local file: official GREE product photos or Ege Teknik's own technical illustrations. */
export const IMAGES = {
  airyBeyaz: { src: "/assets/home/airy-beyaz-880.webp", w: 822, h: 515, photo: true },
  airySiyah: { src: "/assets/home/airy-siyah-1200.webp", srcset: "/assets/home/airy-siyah-720.webp 720w, /assets/home/airy-siyah-1200.webp 1200w", w: 1200, h: 704, photo: true },
  fairy: { src: "/assets/home/fairy-1200.webp", srcset: "/assets/home/fairy-720.webp 720w, /assets/home/fairy-1200.webp 1200w", w: 1200, h: 456, photo: true },
  salonTipi: { src: "/assets/home/salon-tipi-360.webp", w: 360, h: 1182, photo: true },
  btuOlcek: { src: "/assets/rehber/btu-olcek.svg", w: 1200, h: 750 },
  enerjiEtiketi: { src: "/assets/rehber/enerji-etiketi.svg", w: 1200, h: 750 },
  splitSistem: { src: "/assets/rehber/split-sistem.svg", w: 1200, h: 750 },
  multiSistem: { src: "/assets/rehber/multi-sistem.svg", w: 1200, h: 750 },
  inverter: { src: "/assets/rehber/inverter.svg", w: 1200, h: 750 },
  wifi: { src: "/assets/rehber/wifi-kontrol.svg", w: 1200, h: 750 },
  mekanTurleri: { src: "/assets/rehber/mekan-turleri.svg", w: 1200, h: 750 },
  bakim: { src: "/assets/rehber/bakim.svg", w: 1200, h: 750 },
  sogutmaKontrol: { src: "/assets/rehber/sogutma-kontrol.svg", w: 1200, h: 750 },
  drenaj: { src: "/assets/rehber/drenaj.svg", w: 1200, h: 750 },
  kesifPlan: { src: "/assets/rehber/kesif-plan.svg", w: 1200, h: 750 },
  ikinciEl: { src: "/assets/rehber/ikinci-el.svg", w: 1200, h: 750 },
};


const FEATURED = ["klima-secimi-rehberi", "klima-btu-hesaplama", "gree-serileri-karsilastirma"];

export const guidePath = (slug) => `rehber/${slug}.html`;
const guideUrl = (slug) => `${ORIGIN}/${guidePath(slug)}`;
const ogImage = (slug) => `/assets/rehber/og/${slug}.jpg`;
const bySlug = (slug) => GUIDES.find((g) => g.slug === slug);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
const plain = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

export function readingMinutes(guide) {
  const text = [guide.lead, guide.answer, ...guide.sections.map((s) => s.title + " " + plain(s.html)), ...guide.faq.flat()].join(" ");
  return Math.max(2, Math.round(text.split(/\s+/).filter(Boolean).length / 190));
}
const pageTitle = (t) => (t.length + " | Ege Teknik".length <= 66 ? `${t} | Ege Teknik` : t);

const ICON = {
  arrow: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  calc: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
};

function imgTag(key, alt, { cls = "", eager = false, sizes = "(max-width:760px) 92vw, 560px" } = {}) {
  const im = IMAGES[key];
  if (!im) throw new Error(`unknown image ${key}`);
  const srcset = im.srcset ? ` srcset="${im.srcset}" sizes="${sizes}"` : "";
  const loading = eager ? ' fetchpriority="high"' : ' loading="lazy"';
  return `<img${cls ? ` class="${cls}"` : ""} src="${im.src}"${srcset} width="${im.w}" height="${im.h}" alt="${esc(alt)}"${loading} decoding="async">`;
}

function head({ title, description, canonical, ogType, image, extra = "", base = false, preloadImage = "" }) {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
${base ? '<base href="/">\n' : ""}<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:site_name" content="Ege Teknik">
<meta property="og:locale" content="tr_TR">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ORIGIN}${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
${extra}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/plus-jakarta-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
${preloadImage}<link rel="stylesheet" href="/store.css">
<link rel="stylesheet" href="/guide.css">
`;
}

const foot = `<div data-site-footer></div>
<script src="/store.js"></script>
</body>
</html>
`;

/* Hub-only: the local guide search script runs solely on blog.html. Guide
 * article pages keep exactly their existing scripts. */
const hubFoot = `<div data-site-footer></div>
<script src="/store.js"></script>
<script src="/guide-search.js" defer></script>
</body>
</html>
`;

function card(guide, { headingLevel = 3, searchable = false } = {}) {
  const cat = CATEGORIES[guide.category];
  const im = IMAGES[guide.image.key];
  const h = `h${headingLevel}`;
  /* The hub search (blog.html only) hooks onto these markers; guide article pages stay
     byte-identical to before by not carrying them. */
  const hook = searchable ? ` data-guide-card data-guide-slug="${guide.slug}"` : "";
  return `<article class="g-card${im.photo ? " is-photo" : ""}"${hook}>
<div class="g-card-media">${imgTag(guide.image.key, "", { sizes: "(max-width:760px) 92vw, 400px" })}</div>
<div class="g-card-body"><span class="g-cat">${esc(cat.short)}</span><${h}${searchable ? " data-guide-title" : ""}><a href="${guidePath(guide.slug)}">${esc(guide.title)}</a></${h}><p${searchable ? " data-guide-description" : ""}>${esc(guide.description)}</p>
<div class="g-card-foot"><span class="g-time">${ICON.clock}${readingMinutes(guide)} dk okuma</span><span class="g-card-cta" aria-hidden="true">Rehberi oku${ICON.arrow}</span></div></div>
</article>`;
}

function ctaBand() {
  return `<section class="g-cta" aria-labelledby="g-cta-title">
<div class="wrap"><div class="cta-band"><div><h2 id="g-cta-title">Kararınızı birlikte netleştirelim</h2><p>Kapasite, seri veya montaj konusunda emin değilseniz e-posta, telefon ya da form ile bize ulaşın; gerekirse yerinde keşif planlayalım.</p></div>
<div class="buy-actions"><a class="btn btn-lg btn-light" href="contact.html?subject=kesif">Keşif talebi oluştur</a><a class="btn btn-lg btn-outline-light" href="mailto:info@egeteknik.tr">E-posta gönderin</a></div></div></div>
</section>`;
}

/* Wide tables scroll horizontally on phones; the scroll container is a named, focusable region so keyboard users can scroll it. */
const tableRegions = (html) => html.replace(/<div class="g-table-wrap"><table class="([^"]+)"><caption>([^<]+)<\/caption>/g, (_, cls, cap) => `<div class="g-table-wrap" role="region" tabindex="0" aria-label="${cap}"><table class="${cls}"><caption>${cap}</caption>`);

export function renderGuide(guide) {
  const cat = CATEGORIES[guide.category];
  const url = guideUrl(guide.slug);
  const im = IMAGES[guide.image.key];
  const minutes = readingMinutes(guide);
  const toc = [...guide.sections.map((s) => [s.id, s.title]), ...(guide.faq.length ? [["sss", "Sık sorulan sorular"]] : [])];
  const related = guide.related.map(bySlug).filter(Boolean);
  const graph = [
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "Klima Rehberi", item: `${ORIGIN}/blog.html` },
      { "@type": "ListItem", position: 3, name: guide.title, item: url },
    ] },
    { "@type": "Article", headline: guide.title, description: guide.description, image: [`${ORIGIN}${ogImage(guide.slug)}`, `${ORIGIN}${im.src}`],
      datePublished: PUBLISHED, dateModified: PUBLISHED, inLanguage: "tr-TR", articleSection: cat.name, mainEntityOfPage: url,
      author: { "@type": "Organization", name: "Ege Teknik", url: `${ORIGIN}/` },
      publisher: { "@type": "Organization", name: "Ege Teknik", url: `${ORIGIN}/`, logo: { "@type": "ImageObject", url: `${ORIGIN}/favicon.svg` } } },
  ];
  if (guide.faq.length) graph.push({ "@type": "FAQPage", mainEntity: guide.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });

  return `${head({ title: pageTitle(guide.seoTitle), description: guide.description, canonical: url, ogType: "article", image: ogImage(guide.slug), base: true,
    extra: `<meta property="article:published_time" content="${PUBLISHED}">\n<meta property="article:section" content="${esc(cat.name)}">\n` })}${jsonLd({ "@context": "https://schema.org", "@graph": graph })}
</head>
<body class="store guide-page">
<div data-site-header></div>
<main id="main">
<header class="g-hero">
<div class="wrap">
<nav class="breadcrumbs" aria-label="İçerik yolu"><a href="/">Ana Sayfa</a><span aria-hidden="true">›</span><a href="blog.html">Klima Rehberi</a><span aria-hidden="true">›</span><span aria-current="page">${esc(guide.title)}</span></nav>
<div class="g-hero-grid">
<div class="g-hero-copy">
<a class="g-cat" href="blog.html#${guide.category}">${esc(cat.name)}</a>
<h1>${esc(guide.title)}</h1>
<p class="g-lead">${esc(guide.lead)}</p>
<p class="g-meta"><span>Ege Teknik teknik ekibi</span><span aria-hidden="true">·</span><span>Güncelleme: <time datetime="${PUBLISHED}">${UPDATED_LABEL}</time></span><span aria-hidden="true">·</span><span class="g-time">${ICON.clock}${minutes} dk okuma</span></p>
</div>
<figure class="g-hero-figure${im.photo ? " is-photo" : ""}${guide.image.portrait ? " is-portrait" : ""}">${imgTag(guide.image.key, guide.image.alt, { eager: true, sizes: "(max-width:1023px) 92vw, 560px" })}<figcaption>${esc(guide.image.caption)}</figcaption></figure>
</div>
</div>
</header>
<div class="wrap g-layout">
<article class="g-article">
<div class="g-answer"><h2 id="g-answer-title">Kısa cevap</h2><p>${esc(guide.answer)}</p></div>
<nav class="g-toc g-toc-inline" aria-label="Bu rehberde"><h2>Bu rehberde</h2><ol>${toc.map(([id, t]) => `<li><a href="${guidePath(guide.slug)}#${id}">${esc(t)}</a></li>`).join("")}</ol></nav>
${guide.sections.map((s) => `<section class="g-section" id="${s.id}" aria-labelledby="${s.id}-title">\n<h2 id="${s.id}-title">${esc(s.title)}</h2>${tableRegions(s.html)}\n</section>`).join("\n")}
${guide.faq.length ? `<section class="g-section g-faq" id="sss" aria-labelledby="sss-title">\n<h2 id="sss-title">Sık sorulan sorular</h2>\n${guide.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}\n</section>` : ""}
<section class="g-products" aria-labelledby="g-products-title"><h2 id="g-products-title">İlgili ürünler ve hizmetler</h2><div class="g-product-links">${guide.products.map((p) => `<a href="${esc(p.href)}">${esc(p.label)}${ICON.arrow}</a>`).join("")}</div></section>
</article>
<aside class="g-aside" aria-label="Rehber araçları">
<nav class="g-toc" aria-label="Bu rehberde (yan menü)"><h2>Bu rehberde</h2><ol>${toc.map(([id, t]) => `<li><a href="${guidePath(guide.slug)}#${id}">${esc(t)}</a></li>`).join("")}</ol></nav>
<div class="g-aside-card"><span class="g-aside-ico">${ICON.calc}</span><h2>Kapasitenizi hesaplayın</h2><p>Şehir, m², güneş ve yalıtım bilgisiyle ön öneri alın.</p><a class="primary" href="selector.html">Klima Seçici</a></div>
<div class="g-aside-card is-quiet"><h2>Sorunuz mu var?</h2><ul class="g-contact-list"><li><a href="mailto:info@egeteknik.tr">${ICON.mail}info@egeteknik.tr</a></li><li><a href="tel:+905427957560">${ICON.phone}0542 795 75 60</a></li><li><a href="contact.html?subject=kesif">${ICON.clipboard}Keşif talebi</a></li></ul></div>
</aside>
</div>
${related.length ? `<section class="g-related" aria-labelledby="g-related-title"><div class="wrap"><div class="section-head"><div><span class="eyebrow">Klima Rehberi</span><h2 id="g-related-title">İlgili rehberler</h2></div><a class="link-arrow" href="blog.html">Tüm rehberler${ICON.arrow}</a></div><div class="g-grid">${related.map((g) => card(g)).join("\n")}</div></div></section>` : ""}
${ctaBand()}
</main>
${foot}`;
}

export function renderHub() {
  const url = `${ORIGIN}/blog.html`;
  const featured = FEATURED.map(bySlug);
  /* P2-C1: local guide discovery search. Progressive enhancement - with JavaScript the
     form filters the already-rendered cards; without it the field is inert and every
     card stays visible. Enter never navigates (the script cancels the submit). */
  const search = `<form class="g-search" action="/blog.html" method="get" role="search" aria-labelledby="g-search-title">
<div class="wrap"><div class="g-search-box">
<label class="g-search-label" id="g-search-title" for="guide-search">Rehberlerde ara</label>
<input id="guide-search" name="guide-search" type="search" autocomplete="off" placeholder="Örn. inverter, BTU, bakım…" data-guide-search aria-describedby="guide-search-status">
<p class="g-search-status" id="guide-search-status" data-guide-search-status role="status" aria-live="polite">${GUIDES.length} rehberden ${GUIDES.length} gösteriliyor</p>
<p class="g-search-empty" data-guide-search-empty hidden>Aramanızla eşleşen rehber bulunamadı. <button type="button" data-guide-search-clear>Aramayı temizle</button></p>
</div></div>
</form>`;
  const graph = [
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "Klima Rehberi", item: url },
    ] },
    { "@type": "CollectionPage", name: "Klima Rehberi", url, inLanguage: "tr-TR", description: "Klima seçimi, BTU hesabı, enerji verimliliği, montaj, bakım ve arıza rehberleri.",
      publisher: { "@type": "Organization", name: "Ege Teknik", url: `${ORIGIN}/` },
      mainEntity: { "@type": "ItemList", itemListElement: GUIDES.map((g, i) => ({ "@type": "ListItem", position: i + 1, url: guideUrl(g.slug), name: g.title })) } },
  ];
  const sections = Object.entries(CATEGORIES).map(([key, cat]) => {
    const list = GUIDES.filter((g) => g.category === key);
    return `<section class="g-cat-section" id="${key}" data-guide-section aria-labelledby="${key}-title">
<div class="section-head"><div><span class="eyebrow">${list.length} rehber</span><h2 id="${key}-title">${esc(cat.name)}</h2><p>${esc(cat.desc)}</p></div></div>
<div class="g-grid">${list.map((g) => card(g, { searchable: true })).join("\n")}</div>
</section>`;
  }).join("\n");
  return `${head({ title: "Klima Rehberi: Seçim, Kapasite, Montaj ve Bakım | Ege Teknik", description: "Klima seçimi, BTU hesabı, inverter, enerji sınıfı, montaj, bakım ve arıza konularında Ege Teknik'in hazırladığı sade ve uygulanabilir rehberler.", canonical: url, ogType: "website", image: "/assets/rehber/og/klima-rehberi.jpg" })}${jsonLd({ "@context": "https://schema.org", "@graph": graph })}
</head>
<body class="store guide-page guide-hub">
<div data-site-header></div>
<main id="main">
<header class="g-hero g-hub-hero">
<div class="wrap">
<nav class="breadcrumbs" aria-label="İçerik yolu"><a href="/">Ana Sayfa</a><span aria-hidden="true">›</span><span aria-current="page">Klima Rehberi</span></nav>
<div class="g-hub-head">
<div>
<span class="eyebrow">Ege Teknik bilgi merkezi</span>
<h1>Klima Rehberi</h1>
<p class="g-lead">Klima seçerken, kurarken ve kullanırken aklınıza takılanlara sade ve uygulanabilir cevaplar. Kapasite hesabından enerji etiketine, montaj hazırlığından bakıma kadar ${GUIDES.length} rehber.</p>
</div>
<nav class="g-cat-nav" aria-label="Rehber kategorileri">${Object.entries(CATEGORIES).map(([key, cat]) => `<a href="blog.html#${key}"><b>${esc(cat.name)}</b><small>${GUIDES.filter((g) => g.category === key).length} rehber</small></a>`).join("")}</nav>
</div>
</div>
</header>
${search}
<div class="wrap">
<section class="g-featured" data-guide-section aria-labelledby="g-featured-title">
<h2 id="g-featured-title" class="sr-only">Öne çıkan rehberler</h2>
<div class="g-featured-grid">${featured.map((g, i) => card(g, { headingLevel: 3, searchable: true }).replace('class="g-card', `class="g-card${i === 0 ? " is-lead" : ""}`)).join("\n")}</div>
</section>
<section class="g-tool" aria-labelledby="g-tool-title">
<div class="g-tool-copy"><span class="eyebrow">Akıllı Klima Seçici</span><h2 id="g-tool-title">Hangi kapasite size uygun?</h2><p>Alan, güneş, yalıtım ve kişi sayısına göre ön kapasite önerisini hemen alın; sonuçla birlikte uygun modelleri görün.</p><a class="primary btn-lg" href="selector.html">Klima Seçici'yi aç</a></div>
<ul class="g-tool-list" aria-label="Kapasiteye göre modeller">
<li><a href="catalog.html?btu=9000"><b>9.000</b><span>BTU/h · küçük oda</span></a></li>
<li><a href="catalog.html?btu=12000"><b>12.000</b><span>BTU/h · oda</span></a></li>
<li><a href="catalog.html?btu=18000"><b>18.000</b><span>BTU/h · salon</span></a></li>
<li><a href="catalog.html?btu=24000"><b>24.000</b><span>BTU/h · büyük alan</span></a></li>
</ul>
</section>
${sections}
<section class="g-managed" data-managed-blog hidden aria-labelledby="g-managed-title">
<div class="section-head"><div><span class="eyebrow">Ege Teknik'ten</span><h2 id="g-managed-title">Güncel yazılar</h2></div></div>
<div class="g-grid" data-blog></div>
</section>
<section class="g-shop" aria-labelledby="g-shop-title">
<h2 id="g-shop-title">Ürün kategorileri</h2>
<div class="g-product-links is-large">
<a href="catalog.html?category=Duvar%20Tipi">Duvar tipi klimalar${ICON.arrow}</a>
<a href="catalog.html?category=Salon%20Tipi">Salon tipi klimalar${ICON.arrow}</a>
<a href="catalog.html?category=Ticari%20Klima">Ticari klimalar${ICON.arrow}</a>
<a href="catalog.html?category=Multi%20Sistem">Multi sistem${ICON.arrow}</a>
<a href="catalog.html?category=Is%C4%B1%20Pompas%C4%B1">Isı pompaları${ICON.arrow}</a>
<a href="services.html">Montaj ve servis${ICON.arrow}</a>
</div>
</section>
</div>
${ctaBand()}
</main>
${hubFoot}`;
}

export function renderSitemap() {
  const pages = ["", "catalog.html", "services.html", "selector.html", "regions.html", "blog.html", "contact.html", "second-hand.html"];
  const lines = [
    ...pages.map((p) => `<url><loc>${ORIGIN}/${p}</loc></url>`),
    ...GUIDES.map((g) => `<url><loc>${guideUrl(g.slug)}</loc><lastmod>${PUBLISHED}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}\n</urlset>\n`;
}

export function buildAll() {
  const files = { "public/blog.html": renderHub(), "public/sitemap.xml": renderSitemap() };
  for (const g of GUIDES) files[`public/${guidePath(g.slug)}`] = renderGuide(g);
  return files;
}

function validate() {
  const slugs = new Set();
  for (const g of GUIDES) {
    if (slugs.has(g.slug)) throw new Error(`duplicate slug ${g.slug}`);
    slugs.add(g.slug);
    if (!CATEGORIES[g.category]) throw new Error(`${g.slug}: unknown category`);
    if (!IMAGES[g.image.key]) throw new Error(`${g.slug}: unknown image`);
    if (g.description.length > 165) throw new Error(`${g.slug}: description too long (${g.description.length})`);
    for (const r of g.related) if (!bySlug(r)) throw new Error(`${g.slug}: unknown related ${r}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  validate();
  const files = buildAll();
  const stale = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(ROOT, rel);
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (current === content) continue;
    if (process.argv.includes("--check")) stale.push(rel);
    else { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); console.log("wrote", rel); }
  }
  if (stale.length) { console.error("Klima Rehberi pages are out of date:\n" + stale.join("\n") + "\nRun: node scripts/build-klima-rehberi.mjs"); process.exit(1); }
}
