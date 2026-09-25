import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { apiProduct, fakeElement, loadStorefront } from "./support/storefront-sandbox.ts";

const js = readFileSync("public/store.js", "utf8");
const css = readFileSync("public/product-detail.css", "utf8");
const zero = { summary: { count: 0, average: null, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } }, reviews: [], nextCursor: null };
const review = (over: Record<string, unknown> = {}) => ({ id: "r1", rating: 4, displayName: "Ayşe K.", body: "Sessiz ve hızlı soğutuyor.", date: "2026-09-01", verifiedPurchase: false, ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));

async function page(reviews: unknown, extra: Record<string, unknown> = {}) {
  const root = fakeElement(), reviewsRoot = fakeElement(), hero = fakeElement();
  const detail = apiProduct({ id: "p1", name: "Test Klima" });
  const store = loadStorefront({ path: "product.html", search: "?id=p1", elements: { "[data-product-page]": root, "[data-reviews-root]": reviewsRoot, "[data-review-hero]": hero }, api: { products: [detail], detail, reviews: reviews as never, ...extra } });
  await store.fn<() => Promise<void>>("loadCatalog")(); await flush(); await flush();
  return { store, root, reviewsRoot, hero };
}

// ---- rendering -------------------------------------------------------------------------------------------
test("zero reviews: honest empty state and a real write action; no stars, no 0 count, no hero rating", async () => {
  const { reviewsRoot, hero, root } = await page(zero);
  assert.match(reviewsRoot.innerHTML, /<p class="review-empty">Bu ürün için henüz müşteri yorumu bulunmuyor\.<\/p>/);
  assert.match(reviewsRoot.innerHTML, /data-action="review-open" aria-expanded="false" aria-controls="review-form">Yorum yazın</);
  assert.doesNotMatch(reviewsRoot.innerHTML, /★|☆|0 değerlendirme|review-summary|review-average/);
  assert.equal(hero.innerHTML, "");
  assert.match(root.innerHTML, /id="yorumlar" aria-labelledby="yorumlar-title"><h2 id="yorumlar-title">Müşteri Yorumları<\/h2>/);
});
test("reviews exist: real average, count, 5→1 distribution, approved items with text rating equivalents", async () => {
  const data = { summary: { count: 3, average: 4.3, distribution: { 5: 2, 4: 0, 3: 0, 2: 0, 1: 1 } }, reviews: [review({ rating: 5 }), review({ id: "r2", rating: 1, displayName: "Mehmet", body: "Beklediğim gibi değil." })], nextCursor: null };
  const { reviewsRoot, hero } = await page(data);
  const h = reviewsRoot.innerHTML;
  assert.match(h, /<span class="review-average-value">4,3<\/span>/);
  assert.match(h, /5 üzerinden 4,3 · 3 değerlendirme/);
  assert.deepEqual([...h.matchAll(/<span class="rd-label">(\d) yıldız<\/span>/g)].map((m) => m[1]), ["5", "4", "3", "2", "1"]);
  assert.match(h, /<span class="rd-count">2 <small>\(%67\)<\/small><\/span>/);
  assert.match(h, /<span class="review-score">5\/5<span class="pd-sr"> puan<\/span><\/span>/);
  assert.match(h, /<span class="review-score">1\/5/);
  assert.match(hero.innerHTML, /href="#yorumlar"[\s\S]*<b>4,3<\/b>[\s\S]*3 değerlendirme/);
});
test("verified badge appears only when the API says verifiedPurchase === true", async () => {
  const { reviewsRoot } = await page({ summary: { count: 3, average: 4, distribution: { 5: 1, 4: 1, 3: 1, 2: 0, 1: 0 } }, reviews: [review({ verifiedPurchase: true }), review({ id: "r2", verifiedPurchase: "true" }), review({ id: "r3", verifiedPurchase: 1 })], nextCursor: null });
  assert.equal((reviewsRoot.innerHTML.match(/Doğrulanmış satın alma/g) ?? []).length, 1);
});
test("review names and text are escaped; script/HTML never becomes markup", async () => {
  const { reviewsRoot } = await page({ summary: { count: 1, average: 5, distribution: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 } }, reviews: [review({ displayName: '<img src=x onerror=alert(1)>', body: "<script>alert(1)</script>\n\n<b>kalın</b>" })], nextCursor: null });
  assert.doesNotMatch(reviewsRoot.innerHTML, /<script>|<img src=x|<b>kalın/);
  assert.match(reviewsRoot.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(reviewsRoot.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
test("reviews load separately after the product; a failure is stated honestly and never fakes data", async () => {
  const ok = await page(zero);
  assert.equal(ok.store.fetchCalls.filter((u) => u === "/api/products/p1").length, 1);
  assert.ok(ok.store.fetchCalls.indexOf("/api/products/p1") < ok.store.fetchCalls.findIndex((u) => u.startsWith("/api/products/p1/reviews")));
  const failed = await page("fail");
  assert.match(failed.reviewsRoot.innerHTML, /Yorumlar şu anda yüklenemedi/);
  assert.doesNotMatch(failed.reviewsRoot.innerHTML, /★|değerlendirme/);
});
test("sorting and load-more request the API with sort and cursor and append real results", async () => {
  const calls: string[] = [];
  const first = { summary: { count: 2, average: 3, distribution: { 5: 0, 4: 1, 3: 0, 2: 1, 1: 0 } }, reviews: [review()], nextCursor: "CUR1" };
  const second = { ...first, reviews: [review({ id: "r2", displayName: "İkinci Yorumcu" })], nextCursor: null };
  const { store, reviewsRoot } = await page((url: string) => { calls.push(url); return url.includes("cursor=CUR1") ? second : first; });
  assert.match(reviewsRoot.innerHTML, /data-action="review-more"/);
  await store.fn<(reset: boolean) => Promise<void>>("loadProductReviews")(false);
  assert.match(calls.at(-1)!, /sort=newest&limit=10&cursor=CUR1/);
  assert.match(reviewsRoot.innerHTML, /Ayşe K\.[\s\S]*İkinci Yorumcu/);
  assert.doesNotMatch(reviewsRoot.innerHTML, /data-action="review-more"/);
  assert.match(js, /if\(e\.target\.matches\?\.\('\[data-review-sort\]'\)\)\{reviewState\.sort=e\.target\.value;void loadProductReviews\(true\)/);
});

// ---- form ------------------------------------------------------------------------------------------------
function fakeForm(values: Record<string, string>, rating: number | null) {
  const errors = new Map<string, { textContent: string; dataset: { errorFor: string } }>();
  for (const k of ["rating", "displayName", "body", "orderNumber", "contact"]) errors.set(k, { textContent: "", dataset: { errorFor: k } });
  const attrs = new Map<string, Record<string, string>>();
  const input = (name: string) => ({ name, value: values[name] ?? "", focus() {}, setAttribute(k: string, v: string) { attrs.set(name, { ...(attrs.get(name) ?? {}), [k]: v }); }, removeAttribute(k: string) { const a = attrs.get(name) ?? {}; delete a[k]; } });
  const box = { hidden: true, textContent: "" }, button = { disabled: false, textContent: "Yorumu gönder" };
  const form = {
    dataset: {} as Record<string, string>, attrs, errors, box, button,
    querySelector(sel: string) {
      if (sel === '[name="rating"]:checked') return rating ? { value: String(rating) } : null;
      const m = sel.match(/^\[name="(\w+)"\]$/); if (m) return input(m[1]);
      if (sel === "[data-review-errors]") return box; if (sel === "[data-review-submit]") return button;
      if (sel === ".review-rating") return input("rating"); if (sel === "[data-review-form] .review-radio" || sel === ".review-radio") return input("rating");
      return null;
    },
    querySelectorAll: (sel: string) => (sel === "[data-error-for]" ? [...errors.values()] : []),
  };
  return form;
}
const submit = (store: Awaited<ReturnType<typeof page>>["store"], form: ReturnType<typeof fakeForm>) => store.fn<(e: unknown) => Promise<void>>("submitReview")({ target: { closest: () => form }, preventDefault() {} });
const good = { displayName: "Ayşe K.", body: "Montajdan sonra sessiz çalışıyor." };

test("client validation: rating required, 0/6 impossible, short text and contact-only verification are caught before any request", async () => {
  const { store } = await page(zero);
  const v = store.fn<(x: Record<string, unknown>) => Record<string, string>>("validateReviewInput");
  assert.ok(v({ rating: 0, displayName: "Al", body: "x".repeat(20), orderNumber: "", contact: "" }).rating);
  assert.ok(v({ rating: 6, displayName: "Al", body: "x".repeat(20), orderNumber: "", contact: "" }).rating);
  assert.ok(v({ rating: 5, displayName: "A", body: "x".repeat(20), orderNumber: "", contact: "" }).displayName);
  assert.ok(v({ rating: 5, displayName: "ali@x.com", body: "x".repeat(20), orderNumber: "", contact: "" }).displayName);
  assert.ok(v({ rating: 5, displayName: "Ali", body: "kısa", orderNumber: "", contact: "" }).body);
  assert.ok(v({ rating: 5, displayName: "Ali", body: "x".repeat(20), orderNumber: "", contact: "0542" }).orderNumber);
  assert.equal(Object.keys(v({ rating: 5, displayName: "Ali", body: "x".repeat(20), orderNumber: "", contact: "" })).length, 0);
  const form = fakeForm(good, null);
  await submit(store, form);
  assert.equal(store.reviewBodies.length, 0, "no request without a rating");
  assert.match(form.errors.get("rating")!.textContent, /puan seçin/);
  assert.equal(form.box.hidden, false);
});
test("a valid guest submission sends only allowed fields with an idempotency key and shows the pending status", async () => {
  const { store, reviewsRoot } = await page(zero);
  store.fn<() => void>("openReviewForm")();
  const form = fakeForm({ ...good, website: "" }, 4);
  await submit(store, form);
  assert.equal(store.reviewBodies.length, 1);
  assert.deepEqual(Object.keys(store.reviewBodies[0].body as object).sort(), ["body", "displayName", "rating"]);
  assert.match(store.reviewBodies[0].headers["idempotency-key"], /^[0-9a-f-]{36}$/);
  assert.match(reviewsRoot.innerHTML, /<p class="review-sent" role="status">Yorumunuz alındı\. Yayınlanmadan önce incelenir\.<\/p>/);
  assert.doesNotMatch(reviewsRoot.innerHTML, /Montajdan sonra/, "the pending review is never shown on the page");
});
test("the client never sends verification flags; order number and contact are sent only for server-side checking", async () => {
  const { store } = await page(zero);
  await submit(store, fakeForm({ ...good, orderNumber: "ETS-20260101-ABC123", contact: "0542 795 75 60" }, 5));
  const body = store.reviewBodies[0].body as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["body", "contact", "displayName", "orderNumber", "rating"]);
  for (const forbidden of ["verified", "verifiedPurchase", "orderItemId", "status"]) assert.equal(forbidden in body, false);
});
test("server field errors and rate limiting are shown accessibly; the same idempotency key is reused on retry", async () => {
  let n = 0;
  const { store } = await page(zero, { reviewPost: () => (++n === 1 ? { status: 400, body: { error: "Lütfen form alanlarını kontrol edin.", fields: { body: "Yorum bağlantı içeremez." } } } : { status: 429, body: { error: "x" } }) });
  const form = fakeForm(good, 5);
  await submit(store, form);
  assert.equal(form.errors.get("body")!.textContent, "Yorum bağlantı içeremez.");
  assert.equal(form.attrs.get("body")?.["aria-invalid"], "true");
  await submit(store, form);
  assert.match(form.box.textContent, /Çok fazla yorum/);
  assert.equal(store.reviewBodies[0].headers["idempotency-key"], store.reviewBodies[1].headers["idempotency-key"]);
});

// ---- accessibility / responsive / honesty ----------------------------------------------------------------
test("rating control: fieldset + legend, five native radios with text labels, visible focus, text equivalent of the choice", async () => {
  const { store } = await page(zero);
  const html = store.fn<() => string>("reviewFormMarkup");
  store.fn<() => void>("openReviewForm")();
  const markup = html();
  assert.match(markup, /<fieldset class="review-rating" data-rating-value="0" aria-describedby="review-rating-help review-rating-error"><legend>Puanınız <span>\(zorunlu\)<\/span><\/legend>/);
  assert.equal((markup.match(/<input class="review-radio" type="radio" name="rating" id="review-rating-\d" value="\d" required>/g) ?? []).length, 5);
  for (const t of ["1 yıldız – Çok kötü", "3 yıldız – Orta", "5 yıldız – Çok iyi"]) assert.match(markup, new RegExp(t));
  for (const id of ["review-name-error", "review-body-error", "review-order-error", "review-contact-error"]) assert.match(markup, new RegExp(`aria-describedby="[^"]*${id}`));
  assert.match(markup, /data-review-errors role="alert"/);
  assert.match(markup, /Yorumunuz yayınlanmadan önce incelenir\./);
  assert.match(markup, /Sipariş numaranız ve iletişim bilginiz yorumda gösterilmez/);
  assert.match(markup, /data-kvkk-notice/, "reuses the existing KVKK notice slot");
  assert.match(css, /\.review-radio:focus-visible\+label\{outline:3px solid #0b7a55/);
  assert.match(js, /txt\.textContent=`Seçiminiz: \$\{n\}\/5 – \$\{REVIEW_LABELS\[n\]\}`/);
});
test("responsive rules: 44px controls, stacked summary on mobile, safe wrapping, no overflow-x:hidden", () => {
  assert.match(css, /\.review-stars-input label\{display:inline-grid;place-items:center;width:44px;height:44px/);
  assert.match(css, /\.review-sort select\{min-height:44px/);
  assert.match(css, /\.pd-rating-link\{[^}]*min-height:44px/);
  assert.match(css, /\.review-verify summary\{min-height:44px/);
  assert.match(css, /@media\(max-width:650px\)\{\.review-summary\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.review-body p\{[^}]*overflow-wrap:anywhere/);
  assert.doesNotMatch(css, /(html|body)[^{]*\{[^}]*overflow-x\s*:\s*(hidden|clip)/);
});
test("no fake ratings or reviews: every star, count and average comes from the API summary; no literals are shipped", () => {
  assert.doesNotMatch(js, /average\s*[:=]\s*[1-5](\.\d)?[,;}]|count\s*[:=]\s*[1-9]\d*[,;}]|"?rating"?\s*:\s*[1-5][,}]/);
  assert.match(js, /if\(!s\|\|!s\.count\)return `<p class="review-empty">Bu ürün için henüz müşteri yorumu bulunmuyor\.<\/p>/);
  assert.match(js, /function reviewHeroMarkup\(\)\{const s=reviewState\.summary;return s&&s\.count>0&&s\.average!=null\?/);
});
test("no review structured data is emitted anywhere in Phase 5A", () => {
  const files = [...readdirSync("public").filter((f) => /\.(html|js)$/.test(f)).map((f) => `public/${f}`), "lib/legal-render.ts"];
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), /application\/ld\+json|AggregateRating|"@type"\s*:\s*"Review"|schema\.org\/(Review|AggregateRating)/, f);
});
test("source files contain no raw bidi-override or zero-width characters (trojan-source guard)", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|css|html|sql)$/.test(f) ? [p] : []; });
  for (const f of [...walk("lib"), ...walk("app"), ...walk("public"), ...walk("tests"), ...walk("db"), ...walk("drizzle-pg")]) assert.doesNotMatch(readFileSync(f, "utf8"), /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\uFEFF]/, f);
});
