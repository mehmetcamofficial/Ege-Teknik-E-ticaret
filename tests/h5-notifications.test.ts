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

test("H5-A worker route is GET-only, delegates to the tested handler and never reads a request body", () => {
  const route = readFileSync("app/api/internal/notifications/dispatch/route.ts", "utf8"), handler = readFileSync("lib/notifications/dispatch-handler.ts", "utf8");
  assert.doesNotMatch(route, /export (?:async function|const) POST/, "GET only (cron style); no body is read");
  assert.match(route, /handleDispatch\(/);
  assert.match(handler, /cache-control": "no-store"/);
  assert.doesNotMatch(handler, /request\.(?:json|text|formData|arrayBuffer)/);
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

// ---- PR #37: dedicated scoped notification worker (source-level locks; the live behaviour is proven by scripts/test-pr37-worker-http.mjs) ----
const outboxSource = () => readFileSync("lib/notifications/outbox.ts", "utf8");
/** Code only: block and line comments are removed so that explanations may name a table without counting as a use of it. */
const codeOnly = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("PR37 the worker route can reach no database connection other than the dedicated worker one", () => {
  const route = readFileSync("app/api/internal/notifications/dispatch/route.ts", "utf8");
  assert.deepEqual([...route.matchAll(/import \{([^}]*)\} from "@\/db"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim())), ["getNotificationWorkerDb"]);
  assert.doesNotMatch(route, /\bgetDb\b|getAdminDb|getStorefrontDb|getCheckoutDb|getPool|getScopedPool|process\.env\.(?:DATABASE_URL|ADMIN_DATABASE_URL|STOREFRONT_DATABASE_URL)/);
});

test("R-03 every worker result is fenced by the claim token and its audit line is part of the same statement", () => {
  const outbox = codeOnly(outboxSource());
  const worker = outbox.slice(0, outbox.indexOf("export async function operationsSummary"));
  assert.match(worker, /claim_token = replace\(gen_random_uuid\(\)::text, '-', ''\)/, "every claim writes a fresh random token");
  assert.match(worker, /RETURNING id, kind, order_id AS "orderId", dedupe_key AS "dedupeKey", attempts, claim_token AS "claimToken"/, "and gets it back");
  assert.match(worker, /WHERE id = \$\{row\.id\} AND status = 'sending' AND claim_token = \$\{row\.claimToken\} RETURNING id\)/, "a result is applied only to the claim that owns the row");
  assert.match(worker, /WITH moved AS \([\s\S]*?UPDATE notification_outbox SET \$\{change\}, locked_until = NULL, claim_token = NULL[\s\S]*?logged AS \(\s*INSERT INTO public\.audit_logs[\s\S]*?FROM moved\)\s*SELECT id FROM moved/, "state change and audit insert are one statement");
  assert.doesNotMatch(worker, /db\.update\(notificationOutbox\)|\baudit\(/, "no unfenced update and no separate audit insert remain in the worker path");
  assert.match(worker, /claim_token_invalid/, "a claim whose token cannot be proven is never sent (fail closed)");
  assert.ok(worker.indexOf("holdClaim()") > 0 && worker.indexOf("holdClaim()") < worker.indexOf("provider.send("), "ownership is checked and the lease renewed immediately before the provider call");
  assert.match(worker, /SET status = 'dead', last_error_code = 'stalled', locked_until = NULL, claim_token = NULL/, "the stalled sweep drops the token (the CHECK ties it to 'sending')");
  assert.doesNotMatch(worker, /attempts = \$\{row\.attempts\}/, "attempts is not the fence: a requeue resets it");
});

test("R-03 migration 0024 is additive and the worker gets exactly one new column privilege pair", () => {
  const sql = readFileSync("drizzle-pg/0024_notification_claim_token.sql", "utf8");
  assert.match(sql, /ADD COLUMN "claim_token" text;/);
  assert.match(sql, /"claim_token" IS NULL OR \("notification_outbox"\."status" = 'sending' AND "notification_outbox"\."claim_token" ~ '\^\[0-9a-f\]\{32\}\$'\)/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|GRANT|REVOKE)\b/i, "no data change, no drop, no grant in the migration");
  const operator = readFileSync("docs/ops/notification-worker-grants-20261024.sql", "utf8");
  const grant = (privilege: string) => operator.match(new RegExp(`GRANT ${privilege} \\(([^)]*)\\)\\s+ON public\\.notification_outbox`))?.[1].split(",").map((c) => c.trim()) ?? [];
  assert.ok(grant("SELECT").includes("claim_token") && grant("UPDATE").includes("claim_token"), "the worker reads and writes the token");
  assert.ok(!grant("INSERT").includes("claim_token"), "but cannot choose a token at insert time");
});

test("PR37 the worker has no admin_users fallback and reads orders ONLY through the notification_orders view (R-01)", () => {
  const outbox = codeOnly(outboxSource());
  assert.doesNotMatch(outbox, /adminUsers|admin_users/, "the worker role has no access to admin_users, so the code must not touch it");
  assert.doesNotMatch(outbox, /\.select\(\)\.from\((?:orders|orderItems)\)/, "select() without a column list would need table-level SELECT");
  const workerPart = outbox.slice(0, outbox.indexOf("export async function operationsSummary"));   // operationsSummary is the ADMIN summary (admin connection), not the worker
  assert.match(workerPart, /FROM public\.notification_orders WHERE id = \$\{orderId\}/, "an order is loaded from the view");
  assert.match(workerPart, /FROM public\.notification_orders o CROSS JOIN/, "the sweep reads the view too");
  assert.doesNotMatch(workerPart, /(?:FROM|JOIN)\s+(?:public\.)?orders\b|\.from\(orders\)|\borders\.[a-zA-Z]/, "the worker code never names the orders table");
  assert.doesNotMatch(workerPart, /shippingAddressSnapshot|shipping_address_snapshot/, "the snapshot (it holds the phone and the street address) is never read by the worker");
  const withoutProviderField = workerPart.replace(/idempotencyKey: row\.dedupeKey/g, "");   // the e-mail provider's own message field, not orders.idempotency_key
  for (const sensitive of ["phone", "address", "notes", "billing_address_snapshot", "billingAddressSnapshot", "request_fingerprint", "requestFingerprint", "idempotency_key", "idempotencyKey"]) {
    assert.ok(!new RegExp(`\\b${sensitive}\\b`).test(withoutProviderField), `${sensitive} is never read by the worker`);
  }
});

test("PR37 audit INSERT names exactly the seven granted columns and binds every value as a parameter", () => {
  const outbox = outboxSource();
  const block = /INSERT INTO public\.audit_logs \(([\s\S]*?)\)\s*SELECT ([\s\S]*?) FROM moved\)/.exec(outbox);
  assert.ok(block, "explicit audit INSERT present (it reads the fenced UPDATE's RETURNING)");
  assert.deepEqual(block[1].split(",").map((c) => c.trim()).filter(Boolean), ["id", "actor_user_id", "actor_email", "action", "entity_type", "entity_id", "payload"]);
  assert.equal((block[2].match(/\$\{/g) ?? []).length, 5, "five bound parameters (id, actor user, actor e-mail, action, payload); the entity type is a fixed literal and the entity id comes from the UPDATE; no string concatenation");
  assert.doesNotMatch(block[0], /request_id|ip_hash|created_at/);
  assert.match(block[2], /JSON\.stringify\(payload\)\}::jsonb/);
});

test("PR37 the operator SQL grants exactly the minimal set, gives the worker NOTHING on orders and exposes only the whitelisted view (R-01)", () => {
  const sql = readFileSync("docs/ops/notification-worker-grants-20261024.sql", "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.doesNotMatch(sql, /GRANT\s+ALL|(?<!NO)SUPERUSER|(?<!NO)BYPASSRLS|(?<!NO)CREATEROLE|(?<!NO)CREATEDB|(?<!NO)REPLICATION|WITH GRANT OPTION|TO PUBLIC/i);
  assert.match(sql, /NOSUPERUSER[^;]*NOBYPASSRLS/);
  assert.match(sql, /WITH INHERIT TRUE, SET FALSE/);
  for (const table of ["admin_users", "customers", "payments", "drizzle"]) assert.ok(!sql.includes(table), `${table} is not granted`);
  const grants = [...sql.matchAll(/GRANT\s+(SELECT|INSERT|UPDATE)\s*\(([^)]*)\)\s+ON\s+public\.(\w+)/g)].map((m) => `${m[3]}:${m[1]}:${m[2].split(",").map((c) => c.trim()).sort().join(",")}`).sort();
  assert.deepEqual(grants.map((g) => g.split(":").slice(0, 2).join(":")), ["audit_logs:INSERT", "notification_outbox:INSERT", "notification_outbox:SELECT", "notification_outbox:UPDATE", "order_items:SELECT"], "column-level grants: no orders entry any more");
  const tableLevel = [...sql.matchAll(/GRANT\s+(?!\w+\s*\()([A-Z, ]+?)\s+ON\s+(?:TABLE\s+)?public\.(\w+)\s+TO/g)].map((m) => `${m[1].trim()} ON ${m[2]}`);
  assert.deepEqual(tableLevel, ["SELECT ON notification_orders"], "the only table-level grant is SELECT on the view");
  assert.ok(!/GRANT[^;]*\bpublic\.orders\b/.test(sql) && !/GRANT[^;]*\bON\s+orders\b/.test(sql), "nothing is granted on the orders table itself");
  const view = /CREATE VIEW public\.notification_orders WITH \(([^)]*)\) AS([\s\S]*?);/.exec(sql);
  assert.ok(view, "the view is created by the operator SQL");
  assert.match(view[1], /security_barrier = true/); assert.match(view[1], /security_invoker = false/);
  assert.doesNotMatch(view[2], /\b(phone|address|notes|billing_address_snapshot|request_fingerprint|idempotency_key|customer_id|legal_evidence_version)\b/, "the view selects no sensitive column");
  assert.equal((view[2].match(/shipping_address_snapshot/g) ?? []).length, 2, "the snapshot is referenced twice, only to extract the district and the method");
  assert.match(view[2], /shipping_address_snapshot ->> 'district' AS district/); assert.match(view[2], /shipping_address_snapshot -> 'delivery' ->> 'method' AS delivery_method/);
  assert.match(view[2], /FROM public\.orders AS o/, "every reference is schema-qualified");
  assert.match(sql, /REVOKE ALL ON public\.notification_orders FROM PUBLIC;/);
  assert.ok(!/DELETE|TRUNCATE|TRIGGER|REFERENCES/i.test(sql.replace(/NOCREATEROLE/g, "")), "no DELETE/TRUNCATE/TRIGGER/REFERENCES");
  const raw = readFileSync("docs/ops/notification-worker-grants-20261024.sql", "utf8");
  assert.match(raw, /DROP VIEW public\.notification_orders;/, "the rollback block removes the view, which is owned by the operator, not by the worker");
  assert.doesNotMatch(raw, /no phone, street address/, "the old, wrong claim that a column grant hid the street address is gone");
});
