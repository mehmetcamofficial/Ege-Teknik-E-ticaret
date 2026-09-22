/**
 * A <button> with no type attribute defaults to type="submit". The cart's
 * remove-"×" controls are rendered by store.js into [data-cart-items], which
 * lives inside checkout.html's <form data-checkout-form> - so without an
 * explicit type="button" a remove click also submits the order form, placing
 * a real order for whatever is left in the cart (found in the Phase 3A.3E
 * final review).
 *
 * These tests assert the invariant at the composition point that actually
 * broke: the REAL generated markup from public/store.js injected into the
 * REAL checkout form markup - not just a grep for the literal fix.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const storeJsSource = readFileSync(path.join(PUBLIC_DIR, "store.js"), "utf8");

/** Buttons that perform a JS action (data-action) must never be implicit submit buttons. */
function implicitSubmitActionButtons(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /\bdata-action=/.test(tag) && !/\btype="button"/.test(tag));
}

function formBodies(html: string): string[] {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map((m) => m[1]);
}

function renderCartItems(cart: { productId: string; quantity: number }[]): string {
  const root = { innerHTML: "", querySelector: () => null };
  const storage = new Map<string, string>([["ege-cart", JSON.stringify(cart)]]);
  const context: Record<string, unknown> = {
    console,
    URLSearchParams,
    crypto,
    Intl,
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, String(v)); },
      removeItem: (k: string) => { storage.delete(k); },
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { search: "", href: "" },
    fetch: async () => ({ ok: false }),
    document: {
      title: "",
      head: { insertAdjacentHTML() {} },
      querySelector: (sel: string) => (sel === "[data-cart-items]" ? root : null),
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
  };
  vm.createContext(context);
  new vm.Script(storeJsSource, { filename: "store.js" }).runInContext(context);
  (context.renderCheckout as () => void)();
  return root.innerHTML;
}

test("the real rendered cart rows expose a remove control per line, and none of them is a submit button", () => {
  // Two lines so the regression scenario (remove one, the other would have been ordered) is covered.
  const html = renderCartItems([{ productId: "aphro-09", quantity: 2 }, { productId: "pular-12", quantity: 1 }]);
  const removeButtons = [...html.matchAll(/<button\b[^>]*data-action="remove-cart"[^>]*>/g)].map((m) => m[0]);
  assert.equal(removeButtons.length, 2, `expected one remove control per cart line, got: ${html}`);
  for (const tag of removeButtons) {
    assert.match(tag, /\btype="button"/, `cart remove control would submit the checkout form: ${tag}`);
    assert.match(tag, /data-id="(aphro-09|pular-12)"/, `remove control lost its product id: ${tag}`);
  }
});

test("real generated cart markup, injected into the real checkout form, contains no implicit-submit action button", () => {
  const checkout = readFileSync(path.join(PUBLIC_DIR, "checkout.html"), "utf8");
  const container = /<[a-z]+\b[^>]*\bdata-cart-items\b[^>]*>/.exec(checkout);
  assert.ok(container, "checkout.html no longer has a [data-cart-items] container");

  // Compose exactly what the browser ends up with: the static form + the generated rows.
  const composed = checkout.replace(container[0], container[0] + renderCartItems([{ productId: "aphro-09", quantity: 1 }]));
  const insideForms = formBodies(composed);
  assert.ok(insideForms.some((body) => /data-action="remove-cart"/.test(body)), "the generated cart rows should land inside the checkout <form> - that is what makes the button type matter");

  for (const body of insideForms) {
    const offenders = implicitSubmitActionButtons(body);
    assert.deepEqual(offenders, [], `implicit-submit action button inside the checkout form: ${offenders.join(", ")}`);
  }
});

test("the checkout form still has its own intentional submit control", () => {
  const checkout = readFileSync(path.join(PUBLIC_DIR, "checkout.html"), "utf8");
  const [body] = formBodies(checkout);
  assert.ok(body, "checkout.html has no <form>");
  const submitButtons = [...body.matchAll(/<button\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => !/\bdata-action=/.test(tag) && !/\btype="button"/.test(tag));
  assert.ok(submitButtons.length >= 1, "the checkout form lost its submit button - orders could no longer be placed");
});

test("no static storefront page has an implicit-submit action button inside a form", () => {
  for (const page of readdirSync(PUBLIC_DIR).filter((e) => e.endsWith(".html"))) {
    const html = readFileSync(path.join(PUBLIC_DIR, page), "utf8");
    for (const body of formBodies(html)) {
      const offenders = implicitSubmitActionButtons(body);
      assert.deepEqual(offenders, [], `${page}: action button inside a <form> would submit it: ${offenders.join(", ")}`);
    }
  }
});
