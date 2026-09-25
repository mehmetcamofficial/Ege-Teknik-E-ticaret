import assert from "node:assert/strict";
import { existsSync, globSync, readFileSync } from "node:fs";
import test from "node:test";
import { ADMIN_NAV, LOW_STOCK_THRESHOLD, activeNavHref, orderStatusLabel, orderStatusTone, serviceStatuses, stockLevel, visibleNav } from "../lib/admin-ui.ts";
import { orderStatuses } from "../lib/order-domain.ts";
import { adminRoles } from "../lib/security-policy.ts";

const PANEL = "app/admin/(panel)";
const hrefsFor = (role: string) => visibleNav(role).flatMap((s) => s.items.map((i) => i.href));
const read = (f: string) => readFileSync(f, "utf8");

// ---- navigation: permission-aware, driven by the existing RBAC -----------------------------------
test("owner sees every module; the deferred Customers and Audit Logs modules are not in the nav at all", () => {
  assert.deepEqual(hrefsFor("owner"), ["/admin", "/admin/orders", "/admin/service-requests", "/admin/products", "/admin/second-hand", "/admin/catalog-taxonomy", "/admin/inventory", "/admin/blog", "/admin/reviews", "/admin/legal", "/admin/analytics", "/admin/settings"]);
  const all = ADMIN_NAV.flatMap((s) => s.items.map((i) => i.href));
  assert.ok(!all.some((h) => /customers|audit/.test(h)), "no nav entry for a module without an existing safe read path");
});
test("write-gated modules follow the same permission their API enforces: Reviews needs content:write, Legal needs legal:write", () => {
  assert.ok(!hrefsFor("viewer").includes("/admin/reviews") && !hrefsFor("viewer").includes("/admin/legal"));
  assert.ok(!hrefsFor("support_agent").includes("/admin/reviews"));
  assert.ok(hrefsFor("catalog_manager").includes("/admin/reviews"), "catalog_manager holds content:write");
  for (const role of adminRoles.filter((r) => r !== "owner")) assert.ok(!hrefsFor(role).includes("/admin/legal"), `${role} must not see Legal`);
});
test("every role keeps every admin:read module it could already see on the old single-page admin", () => {
  for (const role of adminRoles) for (const h of ["/admin", "/admin/orders", "/admin/service-requests", "/admin/products", "/admin/second-hand", "/admin/catalog-taxonomy", "/admin/inventory", "/admin/blog", "/admin/analytics", "/admin/settings"]) assert.ok(hrefsFor(role).includes(h), `${role} -> ${h}`);
});
test("an unknown or prototype-polluting role gets no navigation at all (roleHasPermission own-property check)", () => {
  for (const role of ["", "admin", "__proto__", "constructor"]) assert.deepEqual(visibleNav(role), []);
});
test("sections with no permitted item are removed rather than rendered empty", () => {
  for (const role of adminRoles) for (const s of visibleNav(role)) assert.ok(s.items.length > 0);
});
test("active nav item is the longest matching prefix, and /admin only matches itself", () => {
  const nav = visibleNav("owner");
  assert.equal(activeNavHref("/admin", nav), "/admin");
  assert.equal(activeNavHref("/admin/products/new", nav), "/admin/products");
  assert.equal(activeNavHref("/admin/orders/abc-123", nav), "/admin/orders");
  assert.equal(activeNavHref("/admin/productsX", nav), null, "a prefix without a path boundary is not a match");
});

// ---- route registration + server-side authorization on every page ----------------------------
test("every nav entry is backed by a real page under the (panel) route group", () => {
  for (const item of ADMIN_NAV.flatMap((s) => s.items)) {
    const rel = item.href === "/admin" ? "" : item.href.replace("/admin/", "") + "/";
    assert.ok(existsSync(`${PANEL}/${rel}page.tsx`), `${item.href} has no page`);
  }
});
test("every admin page authorizes itself server-side (a layout is not an authorization boundary in the App Router)", () => {
  const pages = globSync(`${PANEL}/**/page.tsx`);
  assert.ok(pages.length >= 19);
  for (const p of pages) assert.match(read(p), /await requireAdminPage\(/, `${p} must call requireAdminPage`);
  assert.match(read(`${PANEL}/layout.tsx`), /await requireAdminPage\(\)/);
});
test("write-only screens require the same permission as the API they call", () => {
  const expect: Record<string, string> = {
    "legal/page.tsx": "legal:write", "reviews/page.tsx": "content:write",
    "products/new/page.tsx": "catalog:write", "products/[id]/page.tsx": "catalog:write",
    "second-hand/new/page.tsx": "catalog:write", "second-hand/[id]/page.tsx": "catalog:write",
    "blog/new/page.tsx": "content:write", "blog/[id]/page.tsx": "content:write",
  };
  for (const [page, perm] of Object.entries(expect)) assert.match(read(`${PANEL}/${page}`), new RegExp(`requireAdminPage\\("${perm}"\\)`), page);
});
test("requireAdminPage: no session -> login, missing permission -> dashboard, one getAdminUser per render", () => {
  const guard = read("lib/admin-page.ts");
  assert.match(guard, /import "server-only"/);
  assert.match(guard, /export const currentAdmin = cache\(\(\) => getAdminUser\(\)\)/);
  assert.match(guard, /if \(!admin\) redirect\("\/admin\/login"\)/);
  assert.match(guard, /if \(!roleHasPermission\(admin\.role, permission\)\) redirect\("\/admin"\)/);
});
test("the redesign added no admin API endpoint (no new data exposure): the route set is unchanged", () => {
  assert.deepEqual(globSync("app/api/admin/**/route.ts").sort(), [
    "app/api/admin/analytics/route.ts", "app/api/admin/blog/[id]/route.ts", "app/api/admin/blog/route.ts", "app/api/admin/catalog/import/route.ts",
    "app/api/admin/legal/documents/[slug]/versions/route.ts", "app/api/admin/legal/documents/route.ts", "app/api/admin/legal/versions/[id]/preview/route.ts",
    "app/api/admin/legal/versions/[id]/publish/route.ts", "app/api/admin/legal/versions/[id]/route.ts", "app/api/admin/media/route.ts",
    "app/api/admin/orders/[id]/route.ts", "app/api/admin/overview/route.ts", "app/api/admin/products/[id]/image/route.ts", "app/api/admin/products/[id]/route.ts",
    "app/api/admin/products/route.ts", "app/api/admin/reviews/[id]/route.ts", "app/api/admin/reviews/route.ts", "app/api/admin/second-hand/[id]/route.ts",
    "app/api/admin/second-hand/route.ts", "app/api/admin/service-requests/[id]/route.ts", "app/api/admin/taxonomy/route.ts",
  ].sort());
});
test("no client-side admin code reads environment variables or server-only modules (e.g. Resend configuration)", () => {
  const clientFiles = [...globSync("app/admin/**/*.tsx"), ...globSync("components/admin/*.{ts,tsx}")].filter((f) => /^["']use client["']/.test(read(f)));
  assert.ok(clientFiles.length >= 10);
  for (const f of clientFiles) {
    assert.doesNotMatch(read(f), /process\.env|RESEND|@\/lib\/mail|@\/db|@\/lib\/admin-auth|drizzle-orm/, `${f} must not touch server-only code or secrets`);
  }
});

// ---- vocabulary stays in sync with the domain ----------------------------------------------------
test("order status labels and tones cover exactly the domain's order statuses", () => {
  assert.deepEqual(Object.keys(orderStatusLabel).sort(), [...orderStatuses].sort());
  assert.deepEqual(Object.keys(orderStatusTone).sort(), [...orderStatuses].sort());
});
test("service request statuses match the PATCH route's accepted enum exactly", () => {
  const route = read("app/api/admin/service-requests/[id]/route.ts");
  const m = route.match(/z\.enum\(\[([^\]]+)\]\)/);
  assert.ok(m);
  assert.deepEqual(m![1].split(",").map((s) => s.trim().replace(/"/g, "")), [...serviceStatuses]);
});
test("stock is only tracked for published online-sale products (matching store.js purchasability)", () => {
  assert.equal(stockLevel({ stock: 0, status: "draft", saleMode: "online" }), "untracked");
  assert.equal(stockLevel({ stock: 0, status: "published", saleMode: "quote" }), "untracked");
  assert.equal(stockLevel({ stock: 0, status: "published", saleMode: "online" }), "out");
  assert.equal(stockLevel({ stock: LOW_STOCK_THRESHOLD, status: "published", saleMode: "online" }), "low");
  assert.equal(stockLevel({ stock: LOW_STOCK_THRESHOLD + 1, status: "published", saleMode: "online" }), "ok");
  assert.match(read("public/store.js"), /sale:p\.saleMode==='online'/, "the rule mirrors the storefront");
});

// ---- shell accessibility -------------------------------------------------------------------------
test("shell: skip link, labelled nav, aria-current on the active item, and an accessible drawer", () => {
  const shell = read("components/admin/admin-shell.tsx");
  assert.match(shell, /href="#admin-main"[^>]*>İçeriğe geç</);
  assert.match(shell, /<nav aria-label="Yönetim menüsü"/);
  assert.match(shell, /aria-current=\{current \? "page" : undefined\}/);
  assert.match(shell, /<SheetTitle className="sr-only">Yönetim menüsü<\/SheetTitle>/, "the Radix dialog has an accessible name");
  assert.match(shell, /<SheetTrigger aria-label="Menüyü aç"/, "a real Radix trigger: aria-expanded/aria-controls come from Radix and focus returns to it on close");
  assert.match(shell, /<span className="sr-only">Menüyü kapat<\/span>/);
  assert.match(shell, /motion-reduce:!animate-none/, "drawer animation respects reduced motion");
});
test("every admin control gets a 44px minimum from one scoped rule, and the admin palette is pinned to light", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.admin-theme :is\(\[data-slot="button"\], \[data-slot="input"\], select\) \{\s*min-height: 2\.75rem;/);
  assert.match(css, /\.admin-theme \{\s*color-scheme: light;/);
});

// ---- auth screens keep their exact contract with the unchanged auth routes -----------------------
test("auth forms post the same fields to the same routes as before the redesign", () => {
  const login = read("app/admin/login/page.tsx"), forgot = read("app/admin/forgot-password/page.tsx"), reset = read("app/admin/reset-password/page.tsx");
  const authForm = read("components/admin/auth-form.tsx");
  // AuthForm/AuthField/AuthPasswordField (components/admin/auth-form.tsx) are the only place the
  // real <form>/<input> elements are rendered now; the pages just choose action/name/props.
  assert.match(authForm, /<form method="post" action=\{action\} onSubmit=\{onSubmit\}>/, "a real, un-intercepted POST navigation - onSubmit only sets cosmetic state, never preventDefault");
  assert.doesNotMatch(authForm, /preventDefault|fetch\(/, "the form is never hijacked into a fetch() submission");
  assert.match(authForm, /type=\{visible \? "text" : "password"\}/, "the show/hide toggle only ever switches between password and text, never another type");
  assert.match(authForm, /required minLength=\{minLength\} maxLength=\{maxLength\}/);
  assert.match(login, /<AuthForm action="\/api\/auth\/login"/);
  assert.match(login, /<AuthField id="login-email" name="email" label="E-posta" type="email" autoComplete="username" required maxLength=\{254\}/);
  assert.match(login, /<AuthPasswordField id="login-password" name="password" label="Parola" autoComplete="current-password" minLength=\{12\} maxLength=\{200\}/);
  assert.doesNotMatch(login + forgot + reset, /fetch\(|"use client"/, "auth screens stay plain server-rendered forms");
});
test("login never distinguishes which credential was wrong; only rate limiting gets its own message", () => {
  const login = read("app/admin/login/page.tsx");
  assert.match(login, /error === "429" \? "Çok fazla giriş denemesi/);
  assert.match(login, /: "Giriş bilgileri doğrulanamadı\."/);
  assert.doesNotMatch(login, /parola yanlış|e-posta bulunamadı|kullanıcı bulunamadı/i);
});
test("the storefront still exposes no admin entry point", () => {
  for (const f of [...globSync("public/*.html"), "public/store.js"]) assert.doesNotMatch(read(f), /href=["']\/admin|['"]\/admin(\/|['"])/, f);
});
