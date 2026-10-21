/**
 * H2 premium catalog: cards show only facts the catalog API carries, availability comes from saleMode and stock,
 * and colour is read only from a colour word in the product name.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadStorefront } from "./support/storefront-sandbox.ts";

const h2Css = readFileSync("public/catalog-h2.css", "utf8");
const card = () => loadStorefront().fn<(p: unknown, o?: unknown) => string>("productCard");
const base = { id: "c1", name: "Airy 12000 BTU/h", series: "Airy", category: "Duvar Tipi", sku: "", capacity: "12000 BTU/h", sale: true, price: 58_400, stock: 10, imageUrl: "" };

test("H2 card availability is derived from saleMode and stock only", () => {
  const render = card();
  assert.match(render(base), /class="product-media" data-availability="in"/);
  assert.match(render({ ...base, stock: 2 }), /data-availability="low"[\s\S]*class="stock-line is-in is-low">Stokta · 2 adet</);
  assert.match(render({ ...base, stock: 0 }), /data-availability="out"[\s\S]*class="stock-line is-out">Stokta yok<[\s\S]*class="primary" disabled>Tükendi</);
  const quote = render({ ...base, sale: false, price: 0, stock: 0 });
  assert.match(quote, /data-availability="quote"/);
  assert.doesNotMatch(quote, /data-action="add-cart"|Stokta/, "a quote product never looks purchasable or stocked");
});

test("H2 catalog cards do not print missing-data placeholders", () => {
  const html = card()(base);
  assert.doesNotMatch(html, /paylaşılmamış/i);
  assert.match(readFileSync("public/store-core.js", "utf8"), /productCard\(p,\{eager:index<3,priority:index===0\?'high':undefined\}\)/);
});

test("H2 colour chip appears only when the name carries a colour word", () => {
  const render = card();
  assert.match(render({ ...base, name: "Airy 12000 BTU/h - Siyah" }), /<span class="spec colour">Siyah<\/span>/);
  assert.match(render({ ...base, name: "Fairy 9000 BTU/h – Beyaz" }), /<span class="spec colour">Beyaz<\/span>/);
  assert.doesNotMatch(render(base), /spec colour/);
  assert.doesNotMatch(render({ ...base, name: "Grisoft 9000" }), /spec colour/, "whole words only");
});

test("H2 stylesheet keeps consistent media ratio, reduced-motion and phone layout", () => {
  assert.match(h2Css, /\.product-visual\{aspect-ratio:4\/3/);
  assert.match(h2Css, /@media\(prefers-reduced-motion:reduce\)\{[^@]*transform:none/);
  assert.match(h2Css, /@media\(max-width:560px\)\{[^@]*grid-template-columns:minmax\(112px,36%\) minmax\(0,1fr\)/);
  for (const page of ["catalog", "product"]) assert.match(readFileSync(`public/${page}.html`, "utf8"), /href="catalog-h2\.css"/);
});
