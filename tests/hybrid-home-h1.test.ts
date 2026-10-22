import assert from "node:assert/strict";
import test from "node:test";
import { apiProduct, featuredCard, loadStorefront } from "./support/storefront-sandbox.ts";

function heroCard() {
  const card = featuredCard("synthetic-h1");
  const action = { disabled: false, textContent: "Sepete ekle" };
  const fields = card.querySelectorAll;
  card.querySelectorAll = (selector: string) => selector === "[data-hero-cart]" ? [action] as never : fields(selector);
  return { card, action };
}

test("hero purchase action stays disabled while the authoritative catalog is pending", () => {
  const { card, action } = heroCard();
  const store = loadStorefront({ featured: [card], api: { products: "pending" } });
  store.fn<() => void>("renderFeaturedProducts")();
  assert.equal(action.disabled, true);
  assert.equal(card.fields.price.textContent, "Fiyat yükleniyor…");
});

for (const scenario of ["unavailable", "missing", "sold-out", "quote", "available"] as const) {
  test(`hero purchase state follows authoritative catalog: ${scenario}`, async () => {
    const { card, action } = heroCard();
    const products = scenario === "unavailable" ? "fail" : scenario === "missing" ? [] : [apiProduct({
      id: "synthetic-h1", stock: scenario === "sold-out" ? 0 : 4,
      saleMode: scenario === "quote" ? "quote" : "online", price: 12345,
    })];
    const store = loadStorefront({ featured: [card], api: { products } });
    await store.fn<() => Promise<void>>("loadCatalog")();
    assert.equal(action.disabled, scenario !== "available");
    if (scenario === "available") {
      assert.equal(card.fields.stock.textContent, "Stok: 4");
      assert.equal(card.fields.price.textContent, new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(12345));
    }
  });
}
