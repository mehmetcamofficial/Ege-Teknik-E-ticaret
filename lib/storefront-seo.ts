/** Public SEO vocabulary. No marketing claims, inferred ratings or invented stock. */
export const SITE_ORIGIN = "https://egeteknik.tr";
export const organization = { "@type": "Organization", "@id": SITE_ORIGIN + "/#organization", name: "Ege Teknik", url: SITE_ORIGIN, email: "info@egeteknik.tr", telephone: "+905427957560" };
export type SeoProduct = { id: string; name: string; description?: string | null; shortDescription?: string | null; imageUrl?: string | null; brandId?: string | null; sku?: string | null; price?: number; saleMode?: string; stock?: number | null };
export function productCanonical(id: string) { return SITE_ORIGIN + "/product.html?id=" + encodeURIComponent(id); }
export function productStructuredData(p: SeoProduct) {
  const url = productCanonical(p.id);
  const offer = p.saleMode === "online" && typeof p.price === "number" && Number.isFinite(p.price) && p.price > 0
    ? { "@type": "Offer", url, priceCurrency: "TRY", price: p.price, seller: { "@id": organization["@id"] },
      ...(Number.isInteger(p.stock) && p.stock! >= 0 ? { availability: "https://schema.org/" + (p.stock! > 0 ? "InStock" : "OutOfStock") } : {}) } : null;
  return { "@context": "https://schema.org", "@graph": [organization,
    { "@type": "Product", "@id": url + "#product", name: p.name, url, ...(offer ? { offers: offer } : {}), description: p.shortDescription || p.name,
      ...(p.imageUrl && /^https:\/\//.test(p.imageUrl) ? { image: p.imageUrl } : {}), ...(p.sku ? { sku: p.sku } : {}), ...(p.brandId === "gree" ? { brand: { "@type": "Brand", name: "GREE" } } : {}) },
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: SITE_ORIGIN + "/" }, { "@type": "ListItem", position: 2, name: "Ürünler", item: SITE_ORIGIN + "/catalog.html" }, { "@type": "ListItem", position: 3, name: p.name, item: url }] } ] };
}
export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
export function renderProductHead(template: string, p: SeoProduct) {
  const title = p.name + " | Ege Teknik", description = String(p.shortDescription || p.name + " — teknik özellikler, fiyat ve keşif seçenekleri.").slice(0,170);
  return template.replace(/<title>[^<]*<\/title>/, "<title>" + escapeHtml(title) + "</title>")
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + escapeHtml(description) + '">')
    .replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + escapeHtml(productCanonical(p.id)) + '">')
    .replace('</head>', '<meta property="og:type" content="product"><meta property="og:title" content="'+escapeHtml(title)+'"><meta property="og:description" content="'+escapeHtml(description)+'"><meta property="og:url" content="'+escapeHtml(productCanonical(p.id))+'"><script type="application/ld+json">'+jsonLd(productStructuredData(p))+'</script></head>')
    .replace('<main class="store-shell" id="main" data-product-page></main>', '<main class="store-shell" id="main" data-product-page><h1>'+escapeHtml(p.name)+'</h1><p>'+escapeHtml(description)+'</p><p>Güncel ürün ayrıntıları yükleniyor.</p></main>');
}
