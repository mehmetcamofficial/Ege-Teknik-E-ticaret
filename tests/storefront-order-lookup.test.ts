/**
 * P3-A2: the storefront half of the guest order lookup - public/order-lookup.html plus the
 * renderOrderLookup() renderer in the shipped public/store-core.js (never a re-implementation).
 *
 * The static half proves the page's shape and that no proof ever travels in a link. The behavioural half
 * runs the real renderer in the storefront sandbox with a small DOM stub and asserts the two rules that
 * make the page safe to ship: the only request is a same-origin POST of exactly {orderNumber, email},
 * and every API-derived value is written with textContent on a created node - never as HTML.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { loadStorefront } from "./support/storefront-sandbox.ts";

const PAGE = "public/order-lookup.html";
const CORE = "public/store-core.js";
const coreSource = readFileSync(CORE, "utf8");
const html = existsSync(PAGE) ? readFileSync(PAGE, "utf8") : "";
const checkout = readFileSync("public/checkout.html", "utf8");
/** Exactly the lookup renderer, so a check about it is not satisfied by unrelated storefront code. */
const renderer = coreSource.slice(coreSource.indexOf("const ORDER_LOOKUP_URL"), coreSource.indexOf("renderOrderLookup()})"));

// ---- static: the page ------------------------------------------------------------------------------

test("the lookup page exists with one H1, the storefront shell and only the store.js script", () => {
  assert.ok(existsSync(PAGE), `${PAGE} must exist`);
  assert.match(html, /^<!doctype html><html lang="tr">/);
  assert.match(html, /<div data-site-header><\/div>/);
  assert.match(html, /<main id="main" class="store-shell">/);
  assert.match(html, /<div data-site-footer><\/div>/);
  assert.match(html, /<div class="toast"><\/div>/);
  assert.equal([...html.matchAll(/<h1[\s>]/g)].length, 1, "exactly one H1");
  assert.match(html, /<div class="page-head">[\s\S]*?<h1>/, "the H1 sits in the page-head");
  // (6)(7) only store.js, and no inline executable script at all.
  assert.deepEqual([...html.matchAll(/<script([^>]*)>/g)].map((match) => match[1].trim()), ["src=\"store.js\""]);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/);
});

test("both fields have a visible associated label and the submit button is explicitly typed", () => {
  for (const field of ["orderNumber", "email"]) {
    const label = html.match(new RegExp(`<label class="field">([\\s\\S]*?<input name="${field}"[^>]*>)`));
    assert.ok(label, `${field} must live inside a <label class="field">`);
    assert.match(label![1], /Takip numarası|E-posta adresi/, `${field} has visible label text`);
  }
  assert.match(html, /<input name="orderNumber"[^>]*\brequired\b[^>]*autocomplete="off"/);
  assert.match(html, /<input name="email"[^>]*\brequired\b[^>]*type="email"[^>]*autocomplete="email"/);
  // (5) an explicit type, so nothing in the form can submit implicitly.
  assert.match(html, /<button type="submit" class="primary"/);
  for (const button of html.matchAll(/<button(?![^>]*\stype=)[^>]*>/g)) assert.fail(`a button without an explicit type: ${button[0]}`);
});

test("the page announces its status, has a live result region, and a real no-JS fallback", () => {
  assert.match(html, /<p class="form-status" data-form-status role="status" hidden><\/p>/);
  assert.match(html, /<div data-order-lookup-result aria-live="polite"><\/div>/);
  assert.match(html, /<noscript>[\s\S]*?contact\.html[\s\S]*?<\/noscript>/, "no-JS visitors get a real contact route");
  assert.match(html, /tel:\+905427957560/);
  // The privacy note may only claim what the repository can prove: it is used to verify, nothing else.
  assert.match(html, /yalnızca siparişinizin size ait olduğunu doğrulamak için/);
  for (const forbidden of [/saklanmaz.{0,40}silinir/i, /retention policy/i, /\d+\s*gün\b/]) assert.doesNotMatch(html, forbidden);
});

test("(9)(10)(11) both discoverability links exist and carry no proof, query or hash", () => {
  assert.match(coreSource, /<b class="footer-sub">Hesap<\/b><a href="\/account">Hesabım<\/a><a href="order-lookup\.html">Sipariş takibi<\/a>/, "one footer link under the existing Hesap group");
  assert.match(checkout, /<a href="order-lookup\.html">Siparişimi görüntüle<\/a>/, "one link under the confirmation tracking number");
  // (11) no order number, e-mail, hash or order-lookup query anywhere in this page's links. A plain
  // contact.html?subject= link is the storefront's own existing pattern and carries no proof.
  for (const href of [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1])) {
    assert.doesNotMatch(href, /@|#|ETS-/i, `the lookup page must not link credentials: ${href}`);
    assert.doesNotMatch(href, /order-lookup\.html\?/);
  }
  assert.equal([...coreSource.matchAll(/href="order-lookup\.html[^"]*"/g)].length, 1, "exactly one footer link");
  assert.doesNotMatch(coreSource, /order-lookup\.html\?/);
  assert.doesNotMatch(checkout, /order-lookup\.html\?/);
});

test("(14)(38)(39)(40) the renderer invents nothing and depends on nothing new", () => {
  assert.doesNotMatch(renderer, /paymentStatus|merchantOid|provider|tracking|kargo takip|shipment/i, "no payment, provider or shipment data");
  // (40) same-origin only: one absolute path, no external origin, no CDN, no CSP-relevant change.
  assert.equal([...renderer.matchAll(/https?:\/\//g)].length, 0);
  assert.match(renderer, /const ORDER_LOOKUP_URL='\/api\/orders\/lookup';/);
  // (14) the same claim words the storefront claim audit bans, scanned the way that audit reads a page:
  // visible text plus content/title/alt/aria-label/placeholder - a style attribute is CSS, not a claim.
  const readable = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|style="[^"]*"/g, "");
  for (const banned of [/ücretsiz/i, /taksit/i, /kampanya/i, /aynı\s*gün/i, /\d+\s?%/, /sertifikal/i, /yetkili\s+(bayi|satıcı|servis)/i, /güvencesi/i, /orijinal/i, /\d+\s*yıl/]) {
    assert.doesNotMatch(renderer, banned, `banned storefront claim: ${banned}`);
    assert.doesNotMatch(readable, banned, `banned storefront claim on the page: ${banned}`);
  }
});

// ---- behavioural: the shipped renderer, driven in the storefront sandbox ---------------------------------

type StubNode = {
  tagName: string; textContent: string; className: string; children: StubNode[]; attributes: Record<string, string>;
  focused: boolean; hidden?: boolean; disabled?: boolean; innerHTML?: string;
  setAttribute: (name: string, value: string) => void; focus: () => void; append: (...nodes: StubNode[]) => void; replaceChildren: (...nodes: StubNode[]) => void;
};
const node = (tagName = "div"): StubNode => ({
  tagName, textContent: "", className: "", children: [], attributes: {}, focused: false,
  setAttribute(name, value) { this.attributes[name] = value; },
  focus() { this.focused = true; },
  append(...nodes) { this.children.push(...nodes); },
  replaceChildren(...nodes) { this.children = [...nodes]; },
});
/** Everything a rendered node carries as one string - the assertion reads what a customer would read. */
const textOf = (value: StubNode): string => [value.textContent, ...value.children.map(textOf)].join(" ").replace(/\s+/g, " ").trim();

const CONFIRMATION = {
  orderNumber: "ETS-20260203-AB12CD", status: "pending_payment", statusLabel: "Ödeme Bekleniyor", createdAt: "2026-02-03T04:05:06.000Z",
  items: [{ productName: "Airy 12000", quantity: 2, unitPrice: 6000, lineTotal: 12000 }],
  subtotal: 10000, vatTotal: 2000, shippingTotal: 0, installationTotal: 0, total: 12000,
  delivery: { name: "Ada Lovelace", phone: "05001112233", email: "ada@example.com", city: "İzmir", district: "Kuşadası", address: "Mahalle 1 Sokak No 1", installation: "included_standard", method: "dealer" },
};

type Outcome = { ok: boolean; status: number; body?: unknown };
function mount(options: { response?: () => Promise<Outcome>; reject?: boolean; valid?: boolean } = {}) {
  const result = node();
  const status = Object.assign(node("p"), { className: "form-status", hidden: true, textContent: "" });
  const button = Object.assign(node("button"), { textContent: "Siparişimi görüntüle" });
  const inputs: Record<string, { value: string }> = { orderNumber: { value: "  ETS-20260203-AB12CD  " }, email: { value: " Ada@Example.com " } };
  const handlers: Record<string, (event: unknown) => unknown> = {};
  let reported = 0;
  const form = Object.assign(node("form"), {
    checkValidity: () => options.valid ?? true,
    reportValidity: () => { reported += 1; },
    addEventListener: (type: string, handler: (event: unknown) => unknown) => { handlers[type] = handler; },
    querySelector: (selector: string) => {
      if (selector === "[data-form-status]") return status;
      if (selector === "button[type=submit]") return button;
      const match = selector.match(/\[name=(orderNumber|email)\]/);
      return match ? inputs[match[1]!] : null;
    },
  }) as unknown as StubNode;
  const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
  const store = loadStorefront({ path: "order-lookup.html", elements: { "[data-order-lookup]": form, "[data-order-lookup-result]": result } as never });
  Object.assign(store.context.document as object, { createElement: (tag: string) => node(tag) });
  Object.assign(store.context, {
    fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      calls.push({ url, init });
      if (options.reject) throw new TypeError("network down");
      const outcome = await (options.response?.() ?? (async () => ({ ok: true, status: 200, body: { ok: true, order: CONFIRMATION } }))());
      return { ok: outcome.ok, status: outcome.status, json: async () => outcome.body ?? {} };
    },
  });
  store.fn<() => void>("renderOrderLookup")();
  return { result, status, button, calls, storage: store.storage, get reported() { return reported; }, submit: async () => { let prevented = false; await handlers.submit!({ preventDefault: () => { prevented = true; } }); return prevented; } };
}

test("(12)(13)(14)(15) a valid submit POSTs exactly the two proof fields, same-origin, and nothing else", async () => {
  const session = mount();
  assert.equal(await session.submit(), true, "the default submit is prevented");
  assert.equal(session.calls.length, 1);
  assert.equal(session.calls[0]!.url, "/api/orders/lookup", "same-origin path: no query string, no hash");
  assert.equal(session.calls[0]!.init?.method, "POST");
  assert.equal(session.calls[0]!.init?.headers?.["content-type"], "application/json");
  assert.deepEqual(JSON.parse(session.calls[0]!.init?.body ?? "{}"), { orderNumber: "ETS-20260203-AB12CD", email: "Ada@Example.com" }, "trimmed, and nothing else in the body");
  assert.doesNotMatch(session.calls[0]!.url, /@|\?|#|ETS-/i);
});

test("(16) an invalid form never reaches the network", async () => {
  const session = mount({ valid: false });
  await session.submit();
  assert.equal(session.reported, 1, "the browser reports validity");
  assert.equal(session.calls.length, 0, "no request for an invalid form");
});

test("(17)(18) the button shows progress while asking and is restored afterwards", async () => {
  const session = mount();
  const pending = session.submit();
  assert.equal(session.button.disabled, true, "disabled while in flight");
  assert.equal(session.button.textContent, "Sipariş sorgulanıyor…");
  await pending;
  assert.equal(session.button.disabled, false);
  assert.equal(session.button.textContent, "Siparişimi görüntüle");
});

test("(19)(20)(21)(22)(23)(24)(37) a success renders the order, and the result is focusable and focused", async () => {
  const session = mount();
  await session.submit();
  const rendered = textOf(session.result);
  assert.match(rendered, /ETS-20260203-AB12CD/, "order number");
  assert.match(rendered, /Ödeme Bekleniyor/, "the public status label");
  assert.match(rendered, /3 Şubat 2026/, "the order date, formatted for Turkish");
  assert.match(rendered, /Airy 12000/, "the purchased item");
  assert.match(rendered, /₺12\.000/, "money uses the storefront's own Turkish formatter");
  assert.match(rendered, /2 adet/);
  assert.match(rendered, /Ada Lovelace/, "delivery name");
  assert.match(rendered, /Kuşadası/, "delivery place");
  assert.match(rendered, /Adrese teslim · Standart montaj dahil/, "the storefront's own delivery wording is reused");
  assert.equal(session.result.children.length, 1);
  const panel = session.result.children[0]!;
  assert.equal(panel.tagName, "section");
  assert.equal(panel.attributes.tabindex, "-1", "the result is programmatically focusable");
  assert.equal(panel.focused, true, "focus moves to the result");
  assert.equal(session.status.textContent, "Sipariş bilgileriniz doğrulandı.");
  assert.equal(session.status.hidden, false);
});

test("(25)(26) every API-derived value is written as text, never as HTML", async () => {
  // (26) structural: the renderer has no HTML-string path at all.
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|\.html\s*=/);
  assert.match(renderer, /document\.createElement\(/);
  assert.match(renderer, /element\.textContent=String\(text\)/);
  // (25) behavioural: a hostile stored value becomes text, and no markup is produced anywhere.
  const hostile = { ...CONFIRMATION, items: [{ productName: '<img src=x onerror="alert(1)">', quantity: 1, unitPrice: 1, lineTotal: 1 }], delivery: { ...CONFIRMATION.delivery, address: "<script>bad()</script>" } };
  const session = mount({ response: async () => ({ ok: true, status: 200, body: { ok: true, order: hostile } }) });
  await session.submit();
  const rendered = textOf(session.result);
  assert.match(rendered, /<img src=x/, "the value is present as TEXT");
  assert.equal(session.result.innerHTML, undefined, "no innerHTML is ever assigned to the result");
  assert.equal(rendered.includes('onerror="alert(1)"'), true, "the characters are stored unparsed, never interpreted");
});

test("(27)(28)(29)(31) 400, 404 and 429 all render one UI-owned sentence and never the API's text", async () => {
  const generic = "Sipariş bilgileri doğrulanamadı. Sipariş numarası ve e-posta adresini kontrol edip tekrar deneyin.";
  for (const status of [400, 404, 429]) {
    const secret = `API-SECRET-${status}`;
    const session = mount({ response: async () => ({ ok: false, status, body: { error: secret, code: "ORDER_NOT_FOUND" } }) });
    await session.submit();
    assert.equal(session.status.textContent, generic, `status ${status} must use the page's own message`);
    assert.doesNotMatch(session.status.textContent, new RegExp(secret), "the API's error text is never displayed");
    assert.doesNotMatch(session.status.textContent, /ORDER_NOT_FOUND|json|stack|at /i, "no code, provider body or stack detail");
    assert.equal(session.result.children.length, 0, "a refusal renders no order");
    assert.equal(session.status.hidden, false, "the message is announced");
    assert.equal(session.button.disabled, false, "the customer can try again");
    assert.equal(session.button.textContent, "Siparişimi görüntüle");
  }
});

test("(30) a 5xx and a network failure use the operational message, not the verification one", async () => {
  for (const session of [mount({ response: async () => ({ ok: false, status: 503, body: { error: "boom" } }) }), mount({ reject: true })]) {
    await session.submit();
    assert.equal(session.status.textContent, "Sipariş bilgileri şu anda alınamıyor. Lütfen daha sonra tekrar deneyin.");
    assert.equal(session.result.children.length, 0);
    assert.equal(session.button.disabled, false);
  }
});

test("(32)(33)(34)(35)(36) the proof is never stored, logged, or put in a URL", async () => {
  const session = mount();
  await session.submit();
  // Scoped to the lookup renderer: the rest of store-core.js legitimately keeps a cart and a service
  // idempotency key, so only the lookup path is required to touch no storage at all.
  assert.doesNotMatch(renderer, /localStorage|sessionStorage|document\.cookie/, "the lookup stores nothing");
  assert.doesNotMatch(renderer, /console\.(log|info|warn|error)/, "the lookup logs nothing");
  assert.doesNotMatch(renderer, /sendAnalyticsEvent|analytics/i, "the lookup is never reported to analytics");
  assert.doesNotMatch(renderer, /URLSearchParams/, "no proof in a query string");
  assert.equal(session.storage.size, 0, "a lookup writes nothing to storage");
  assert.equal(session.calls[0]!.url, "/api/orders/lookup", "and the credential stays in the body");
});

test("(2)(3)(4)(5)(42) the page is a usable form first: labelled, typed, and operable without scripts", () => {
  assert.equal([...html.matchAll(/<h1[^>]*>/g)].length, 1);
  assert.match(html, /<form data-order-lookup novalidate>/, "a real form element");
  assert.match(html, /<label class="field">Takip numarası<input name="orderNumber"/);
  assert.match(html, /<label class="field">E-posta adresi<input name="email"/);
  assert.match(html, /<button type="submit" class="primary"/);
  assert.match(html, /<noscript>[\s\S]*?0542 795 75 60[\s\S]*?<\/noscript>/);
  // No inline event handler anywhere on the page (the CSP forbids them).
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
});