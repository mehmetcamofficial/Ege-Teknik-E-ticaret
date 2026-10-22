/** H5-A notification architecture: pure and injected-provider tests (no database, no network, no real e-mail). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAX_ATTEMPTS, OUTBOX_KINDS, RETRY_DELAYS_SECONDS, dedupeKeyFor, parseRecipientList, retryDelaySeconds } from "../lib/notifications/outbox.ts";
import { providerStatus, resendBase, resendProvider } from "../lib/notifications/provider.ts";
import { describeNotifications } from "../lib/notifications/summary-view.ts";
import { escapeHtml, maskEmail, oneLine, renderAdminNewOrder, renderCustomerOrderReceived, type OrderEmailData } from "../lib/notifications/templates.ts";

const order: OrderEmailData & { orderId: string } = {
  orderId: "11111111-1111-4111-8111-111111111111", orderNumber: "ETS-20261022-000001", createdAt: new Date("2026-10-22T09:30:00Z"),
  items: [{ productName: "Airy 12000 BTU/h", quantity: 2, unitPrice: 58_400, lineTotal: 116_800 }], subtotal: 97_333, vatTotal: 19_467, shippingTotal: 0, installationTotal: 0, total: 116_800,
  customerName: "Ada Yılmaz", deliveryMethod: "dealer", installationIncluded: true, city: "Aydın", district: "Kuşadası", paymentStatus: "pending", status: "pending_payment",
};
const links = { siteOrigin: "https://egeteknik.tr", adminOrigin: "https://admin.egeteknik.tr" };

test("H5-A customer mail states the facts the server holds and makes no false promise", () => {
  const { subject, text, html } = renderCustomerOrderReceived(order, links);
  assert.equal(subject, "Siparişiniz alındı — ETS-20261022-000001");
  for (const part of [text, html]) {
    assert.match(part, /ETS-20261022-000001/);
    assert.match(part, /Airy 12000 BTU\/h/);
    assert.match(part, /Tahsil edilmedi/, "payment status: not collected");
    assert.match(part, /₺116\.800/);
    assert.match(part, /order-lookup\.html/, "tracking link follows the existing lookup model (order number + e-mail)");
    assert.match(part, /0542 795 75 60/);
    assert.match(part, /info@egeteknik\.tr/);
    assert.doesNotMatch(part, /ödemeniz alındı|ödeme alındı|tahsil edildi|kargoya verildi|montaj randevu|teslim tarihi: /i, "never claims payment, shipment or an appointment");
  }
  assert.match(text, /kesinleşmiş bir tarih bu e-postada verilmemiştir/);
  assert.doesNotMatch(text + html, /@[^ ]+\?|[?&]email=/, "no e-mail address in any link");
});

test("H5-A every interpolated value is HTML-escaped and a subject can never be split into headers", () => {
  const evil = { ...order, customerName: '"><script>alert(1)</script>', orderNumber: "ETS-1\r\nBcc: attacker@example.test", items: [{ productName: "<img src=x onerror=alert(1)>", quantity: 1, unitPrice: 1, lineTotal: 1 }] };
  const customer = renderCustomerOrderReceived(evil, links), admin = renderAdminNewOrder(evil, links);
  for (const r of [customer, admin]) {
    assert.doesNotMatch(r.html, /<script|<img /i, "no raw tag from user input");
    assert.doesNotMatch(r.subject, /[\r\n]/);
  }
  assert.match(customer.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(oneLine("a\r\nb c"), "a b c");
});

test("H5-A admin mail has the order number, total, time, payment status and detail link, and no customer data", () => {
  const { subject, text, html } = renderAdminNewOrder(order, links);
  assert.match(subject, /Yeni sipariş ETS-20261022-000001 — ₺116\.800 — ödeme: Tahsil edilmedi/);
  assert.match(text, /Zaman: 22 Ekim 2026/);
  assert.match(text, /https:\/\/admin\.egeteknik\.tr\/admin\/orders\/11111111-1111-4111-8111-111111111111/);
  for (const part of [text, html]) assert.doesNotMatch(part, /Ada Yılmaz|Kuşadası|Aydın/, "no customer name or address in the alert");
  assert.match(renderAdminNewOrder(order, { siteOrigin: "https://egeteknik.tr" }).text, /yönetim panelinden sipariş numarasıyla bulunur/, "no admin origin configured: no invented link");
});

test("H5-A recipient addresses are masked and recipient lists are validated and capped", () => {
  assert.equal(maskEmail("ada@example.com"), "a***@e***.com");
  assert.equal(maskEmail("not-an-address"), "***");
  assert.deepEqual(parseRecipientList(" Ops@Example.test, bad, ops@example.test ,x y@z.test, boss@example.test "), ["ops@example.test", "boss@example.test"]);
  assert.equal(parseRecipientList(Array.from({ length: 30 }, (_, i) => `u${i}@example.test`).join(",")).length, 10);
});

test("H5-A the idempotency key and the outbox kinds are exactly what migration 0022 enforces", () => {
  const migration = readFileSync("drizzle-pg/0022_notification_outbox.sql", "utf8");
  assert.deepEqual([...OUTBOX_KINDS], ["order_customer_received", "order_admin_new"]);
  for (const kind of OUTBOX_KINDS) assert.ok(migration.includes(`'${kind}'`));
  assert.equal(dedupeKeyFor("abc", "order_admin_new"), "order:abc:order_admin_new");
  assert.match(migration, /"dedupe_key" = 'order:' \|\| "notification_outbox"\."order_id" \|\| ':' \|\| "notification_outbox"\."kind"/);
  assert.match(migration, /CREATE UNIQUE INDEX "notification_outbox_dedupe_uq"/);
  assert.match(migration, /UYGULANMADI/);
  assert.doesNotMatch(migration.split("\n").filter((l) => !l.startsWith("--")).join("\n"), /email|subject|body|recipient/i, "the outbox columns store no address, subject or body");
});

test("H5-A retry schedule: five attempts, growing delays, then dead", () => {
  assert.equal(MAX_ATTEMPTS, 5);
  assert.deepEqual([...RETRY_DELAYS_SECONDS], [60, 300, 1800, 7200]);
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => retryDelaySeconds(n)), [60, 300, 1800, 7200, null]);
});

const call = async (status: number | "throw" | "timeout") => {
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    if (status === "timeout") throw Object.assign(new Error("t"), { name: "TimeoutError" });
    if (status === "throw") throw new Error("socket");
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  const provider = resendProvider({ RESEND_API_KEY: "test-key", MAIL_FROM: "Ege Teknik <noreply@example.test>" }, fakeFetch)!;
  return { result: await provider.send({ to: ["a@example.test"], subject: "s", text: "t", html: "<p>t</p>", idempotencyKey: "order:1:order_admin_new" }), seen };
};

test("H5-A provider failures are classified and the dedupe key is the provider idempotency key", async () => {
  const ok = await call(200);
  assert.deepEqual(ok.result, { ok: true });
  assert.equal(ok.seen[0].url, "https://api.resend.com/emails");
  assert.equal(ok.seen[0].headers["idempotency-key"], "order:1:order_admin_new");
  assert.deepEqual((await call(429)).result, { ok: false, retryable: true, code: "rate_limited" });
  assert.deepEqual((await call(503)).result, { ok: false, retryable: true, code: "provider_5xx" });
  assert.deepEqual((await call(422)).result, { ok: false, retryable: false, code: "invalid_recipient" });
  assert.deepEqual((await call(401)).result, { ok: false, retryable: false, code: "rejected" });
  assert.deepEqual((await call("timeout")).result, { ok: false, retryable: true, code: "timeout" });
  assert.deepEqual((await call("throw")).result, { ok: false, retryable: true, code: "send_failed" });
});

test("H5-A the provider is null without both keys, and the base URL cannot be redirected in production", () => {
  assert.equal(resendProvider({}), null);
  assert.deepEqual(providerStatus({ MAIL_FROM: "x@example.test" }), { configured: false, provider: "none", reason: "RESEND_API_KEY_missing" });
  assert.deepEqual(providerStatus({ RESEND_API_KEY: "k" }), { configured: false, provider: "none", reason: "MAIL_FROM_missing" });
  assert.equal(resendBase({ APP_ENV: "production", RESEND_API_BASE: "http://127.0.0.1:1" }), "https://api.resend.com");
  assert.equal(resendBase({ APP_ENV: "preview", RESEND_API_BASE: "https://evil.example" }), "https://api.resend.com");
  assert.equal(resendBase({ APP_ENV: "development", RESEND_API_BASE: "http://127.0.0.1:4010" }), "http://127.0.0.1:4010");
});

test("H5-A the admin banner says so when e-mail is disabled and never claims delivery it cannot make", () => {
  const off = describeNotifications({ providerConfigured: false, providerReason: "RESEND_API_KEY_missing", adminRecipientsConfigured: false, byStatus: { pending: 3 }, oldestWaitingSeconds: 40 });
  assert.equal(off.tone, "danger");
  assert.equal(off.headline, "E-posta bildirimleri devre dışı");
  assert.match(off.details.join(" "), /Müşteriye otomatik e-posta GİTMİYOR/);
  assert.match(off.details.join(" "), /3 bildirim kuyrukta bekliyor/);
  const on = describeNotifications({ providerConfigured: true, providerReason: null, adminRecipientsConfigured: true, byStatus: { sent: 9 }, oldestWaitingSeconds: null });
  assert.deepEqual([on.tone, on.headline, on.details], ["ok", "E-posta bildirimleri çalışıyor", []]);
  assert.equal(describeNotifications({ providerConfigured: true, providerReason: null, adminRecipientsConfigured: true, byStatus: { dead: 2 }, oldestWaitingSeconds: null }).tone, "danger");
  assert.equal(describeNotifications({ providerConfigured: true, providerReason: null, adminRecipientsConfigured: true, byStatus: { pending: 1 }, oldestWaitingSeconds: 1200 }).tone, "warning");
});

test("H5-A worker route requires a long secret (404 when absent, 401 when wrong) and returns counts only", () => {
  const route = readFileSync("app/api/internal/notifications/dispatch/route.ts", "utf8");
  assert.match(route, /secret\.length < 32\) return Response\.json\(\{ error: "not_configured" \}, \{ status: 404/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /status: 401/);
  assert.doesNotMatch(route, /export (?:async function|const) POST/, "GET only (cron style); no body is read");
  assert.match(route, /cache-control": "no-store"/);
});

test("H5-A the worker never logs or audits a raw address, subject or body", () => {
  const outbox = readFileSync("lib/notifications/outbox.ts", "utf8"), provider = readFileSync("lib/notifications/provider.ts", "utf8");
  for (const source of [outbox, provider]) {
    assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^)]*(?:email|recipient|subject|body|to\b|html|text)\b/i);
  }
  assert.match(outbox, /recipient: masked/);
  assert.doesNotMatch(outbox, /recipient: (?:to|order\.email)/);
  assert.match(outbox, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  assert.match(outbox, /FOR UPDATE SKIP LOCKED/);
  assert.match(outbox, /tx\.transaction\(async \(savepoint\)/, "enqueue runs in a SAVEPOINT");
});
