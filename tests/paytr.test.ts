import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTokenRequest, isMerchantOid, kurusToTlString, mapPaytrStatus, newMerchantOid, parsePaytrCallback, paytrCallbackHash, paytrTokenHash,
  readPaytrConfig, resultUrl, sanitizeProviderText, tlToKurus, verifyPaytrCallbackHash,
} from "../lib/paytr.ts";
import { renderPaymentForm, renderPaymentFrame, renderPaymentResult, renderPaymentUnavailable } from "../lib/payment-pages.ts";
import { requiresSameOrigin } from "../lib/security-policy.ts";
import { validateRefund } from "../lib/finance.ts";

/** PayTR foundation without credentials: every value below is a fake used only in tests. */
const read = (f: string) => readFileSync(f, "utf8");
const KEY = "TEST_KEY_not_a_real_merchant_key", SALT = "TEST_SALT_not_a_real_salt";
const env = { PAYTR_ENABLED: "true", PAYTR_MERCHANT_ID: "123456", PAYTR_MERCHANT_KEY: KEY, PAYTR_MERCHANT_SALT: SALT, PAYTR_OK_URL: "https://preview.example.test/payment/success", PAYTR_FAIL_URL: "https://preview.example.test/payment/fail" };
const enabled = () => { const c = readPaytrConfig(env); assert.equal(c.state, "enabled"); if (c.state !== "enabled") throw new Error("unreachable"); return c.config; };

// ---- config / feature flag -------------------------------------------------------------------------------------------
test("PayTR is off unless PAYTR_ENABLED is exactly 'true'", () => {
  for (const value of [undefined, "", "false", "TRUE", "1", "yes"]) assert.deepEqual(readPaytrConfig({ ...env, PAYTR_ENABLED: value }), { state: "disabled" }, String(value));
});
test("missing or malformed env is reported by NAME only - never a value", () => {
  const c = readPaytrConfig({ PAYTR_ENABLED: "true", PAYTR_MERCHANT_KEY: KEY, PAYTR_MERCHANT_ID: "abc", PAYTR_OK_URL: "http://evil.example/ok" });
  assert.equal(c.state, "misconfigured");
  assert.deepEqual(c.state === "misconfigured" && [...c.missing].sort(), ["PAYTR_FAIL_URL", "PAYTR_MERCHANT_ID(format)", "PAYTR_MERCHANT_SALT", "PAYTR_OK_URL(https)"].sort());
  assert.doesNotMatch(JSON.stringify(c), new RegExp(KEY));
});
test("test mode stays on unless explicitly 'false'; iframe v2 flag is read", () => {
  assert.equal(enabled().testMode, true);
  const live = readPaytrConfig({ ...env, PAYTR_TEST_MODE: "false", PAYTR_IFRAME_V2: "false" });
  assert.equal(live.state === "enabled" && live.config.testMode, false);
  assert.equal(live.state === "enabled" && live.config.iframeV2, false);
});
test("no .env or source file ships a real PayTR credential or a public (NEXT_PUBLIC_) PayTR variable", () => {
  const files = globSync("{app,lib,components,public,db,drizzle-pg,scripts}/**/*.{ts,tsx,js,mjs,sql,json,html}");
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /NEXT_PUBLIC_PAYTR/i, f);
    assert.doesNotMatch(src, /PAYTR_MERCHANT_(KEY|SALT)\s*[=:]\s*["'][^"']+["']/, f);
  }
  // "Committed" means tracked by git: an ignored, machine-local file such as .env.sentry-build-plugin is not a committed file.
  const tracked = execFileSync("git", ["ls-files", "--", ".env*"], { encoding: "utf8" }).split("\n").filter(Boolean);
  assert.equal(tracked.filter((f) => !/\.example$/.test(f)).length, 0, "no committed .env file");
});

// ---- money ----------------------------------------------------------------------------------------------------------
test("TL -> kuruş is exact and float-free", () => {
  assert.equal(tlToKurus(167000), 16_700_000);
  assert.equal(tlToKurus("99.99"), 9999);
  assert.equal(tlToKurus("99,9"), 9990);
  assert.equal(tlToKurus("0.01"), 1);
  assert.equal(kurusToTlString(9999), "99.99");
  assert.equal(kurusToTlString(16_700_000), "167000.00");
  for (const bad of [1.5, -1, Number.NaN, 2 ** 53]) assert.throws(() => tlToKurus(bad), String(bad));
  for (const bad of ["1.234", "abc", "-5", "1e3", ""]) assert.throws(() => tlToKurus(bad), bad);
});

// ---- merchant_oid ---------------------------------------------------------------------------------------------------
test("merchant_oid is alphanumeric, <= 64, carries the order number, and is unique per attempt", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(newMerchantOid("ETS-20260924-91D9F0"));
  assert.equal(seen.size, 2000);
  for (const oid of seen) { assert.ok(isMerchantOid(oid), oid); assert.ok(oid.startsWith("ETS2026092491D9F0P"), oid); }
  assert.equal(newMerchantOid("ETS-1", () => Buffer.alloc(8, 0xab)), "ETS1PABABABABABABABAB");
  for (const bad of ["", "a-b", "x".repeat(65), "ab cd", null]) assert.equal(isMerchantOid(bad), false, String(bad));
});

// ---- hashes ---------------------------------------------------------------------------------------------------------
test("token hash follows PayTR's field order and is deterministic", () => {
  const fields = { merchantId: "123456", userIp: "1.2.3.4", merchantOid: "ETS1PAB", email: "a@b.test", paymentAmount: 9999, userBasket: "W10=", noInstallment: 1 as const, maxInstallment: 0, currency: "TL" as const, testMode: 1 as const };
  const expected = createHmac("sha256", KEY).update("1234561.2.3.4ETS1PABa@b.test9999W10=10TL1" + SALT).digest("base64");
  assert.equal(paytrTokenHash(fields, { merchantKey: KEY, merchantSalt: SALT }), expected);
  assert.equal(paytrTokenHash(fields, { merchantKey: KEY, merchantSalt: SALT }), expected);
  assert.notEqual(paytrTokenHash({ ...fields, paymentAmount: 10000 }, { merchantKey: KEY, merchantSalt: SALT }), expected);
});
test("the token request carries amount in kuruş and the hash - never the key or salt", () => {
  const config = enabled();
  const body = buildTokenRequest(config, { merchantOid: "ETS1PAB", userIp: "1.2.3.4", email: "a@b.test", paymentAmountKurus: 16_700_000, basket: [{ name: "Klima", unitPriceKurus: 16_700_000, quantity: 1 }], userName: "Ada", userAddress: "Adres", userPhone: "05000000000", okUrl: config.okUrl, failUrl: config.failUrl });
  assert.equal(body.payment_amount, "16700000");
  assert.equal(body.test_mode, "1");
  assert.deepEqual(JSON.parse(Buffer.from(body.user_basket, "base64").toString()), [["Klima", "167000.00", 1]]);
  const all = JSON.stringify(body);
  assert.doesNotMatch(all, new RegExp(KEY));
  assert.doesNotMatch(all, new RegExp(SALT));
});
test("callback hash: valid passes; tampered status, amount, oid or hash fails; comparison is timing-safe", () => {
  const secrets = { merchantKey: KEY, merchantSalt: SALT };
  const good = { merchantOid: "ETS1PAB", status: "success", totalAmount: "9999" };
  const hash = paytrCallbackHash(good, secrets);
  assert.equal(verifyPaytrCallbackHash({ ...good, hash }, secrets), true);
  for (const bad of [{ ...good, status: "failed" }, { ...good, totalAmount: "1" }, { ...good, merchantOid: "ETS1PAC" }]) assert.equal(verifyPaytrCallbackHash({ ...bad, hash }, secrets), false);
  for (const h of ["", hash.slice(1), hash + "A", "x".repeat(hash.length)]) assert.equal(verifyPaytrCallbackHash({ ...good, hash: h }, secrets), false);
  assert.equal(verifyPaytrCallbackHash({ ...good, hash }, { merchantKey: "other", merchantSalt: SALT }), false);
  assert.match(read("lib/paytr.ts"), /timingSafeEqual\(received, expected\)/);
});

// ---- status mapping / callback parsing -------------------------------------------------------------------------------
test("provider status maps to the internal payment status; anything else is rejected", () => {
  assert.equal(mapPaytrStatus("success"), "paid");
  assert.equal(mapPaytrStatus("failed"), "failed");
  for (const s of ["", "SUCCESS", "refunded", "paid"]) assert.equal(mapPaytrStatus(s), null, s);
});
test("only the known notification fields are read; provider text is bounded and control-free", () => {
  const cb = parsePaytrCallback(new URLSearchParams({ merchant_oid: "X1", status: "success", total_amount: "100", hash: "h", payment_amount: "100", card_pan: "4111111111111111", cvv: "123" }));
  assert.deepEqual(Object.keys(cb).sort(), ["currency", "failedReasonCode", "failedReasonMsg", "hash", "merchantOid", "paymentAmount", "paymentType", "status", "testMode", "totalAmount"].sort());
  assert.doesNotMatch(JSON.stringify(cb), /4111|"123"/);
  assert.equal(sanitizeProviderText("a\u0000b\nc".padEnd(400, "x")).length, 200);
});
test("result URLs carry only the attempt reference", () => {
  assert.equal(resultUrl("https://x.test/payment/success", "ETS1PAB"), "https://x.test/payment/success?ref=ETS1PAB");
});

// ---- pages ----------------------------------------------------------------------------------------------------------
test("the success page never claims payment before the verified callback; pending refreshes itself", () => {
  const pending = renderPaymentResult({ page: "success", attempt: { orderNumber: "ETS-1", status: "pending" } });
  assert.match(pending, /doğrulanıyor/);
  assert.doesNotMatch(pending, /Ödemeniz alındı/);
  assert.match(pending, /http-equiv="refresh"/);
  assert.match(renderPaymentResult({ page: "success", attempt: { orderNumber: "ETS-1", status: "paid" } }), /Ödemeniz alındı/);
  for (const status of ["failed", "cancelled"]) assert.doesNotMatch(renderPaymentResult({ page: "success", attempt: { orderNumber: "ETS-1", status } }), /alındı/);
  const unknown = renderPaymentResult({ page: "success", attempt: null });
  assert.doesNotMatch(unknown, /alındı/);
});
test("the fail page offers retry and a way back, and shows no provider text", () => {
  const fail = renderPaymentResult({ page: "fail", attempt: { orderNumber: "ETS-1", status: "failed" } });
  assert.match(fail, /Tekrar dene/);
  assert.match(fail, /href="\/payment\?order=ETS-1"/);
  assert.match(fail, /Siparişiniz silinmedi/);
});
test("payment pages carry no script, no card field, and escape every value", () => {
  const pages = [renderPaymentUnavailable(), renderPaymentForm({ orderNumber: `"><script>x</script>`, error: "<b>e</b>" }), renderPaymentFrame({ iframeUrl: "https://www.paytr.com/odeme/guvenli/abc", orderNumber: "<i>" }), renderPaymentResult({ page: "fail", attempt: { orderNumber: "<x>", status: "failed" } })];
  for (const html of pages) {
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /name="(card|pan|cvv|cvc|expiry|cc_?number)[^"]*"/i);
  }
  assert.match(pages[1], /&quot;&gt;&lt;script&gt;/);
  assert.match(pages[1], /&lt;b&gt;e&lt;\/b&gt;/);
});

// ---- routes: flag, secrets, boundary --------------------------------------------------------------------------------
test("with the flag off, every PayTR route answers before any database or provider work", () => {
  const token = read("app/api/payments/paytr/token/route.ts");
  assert.ok(token.indexOf('config.state !== "enabled"') < token.indexOf("rateLimit(") && token.indexOf('config.state !== "enabled"') < token.indexOf("getDb()"));
  const callback = read("app/api/payments/paytr/callback/route.ts");
  assert.ok(callback.indexOf('config.state !== "enabled"') < callback.indexOf("getDb()"));
  const page = read("app/payment/route.ts");
  assert.match(page, /if \(readPaytrConfig\(process\.env\)\.state !== "enabled"\) return html\(renderPaymentUnavailable\(\)\)/);
  assert.match(read("lib/paytr-db.ts"), /if \(input\.config\.state !== "enabled"\) return refuse\(503/);
});
test("the token endpoint returns only the iframe URL; no secret, config or provider payload reaches a response or log", () => {
  const token = read("app/api/payments/paytr/token/route.ts");
  assert.match(token, /Response\.json\(\{ ok: true, iframeUrl: result\.iframeUrl \}/);
  for (const f of ["app/api/payments/paytr/token/route.ts", "app/api/payments/paytr/callback/route.ts", "app/payment/route.ts", "lib/paytr.ts", "lib/paytr-db.ts"]) {
    const src = read(f);
    // Only the payload after the fixed event name is checked: it may carry an error NAME or missing-variable NAMES only.
    for (const call of src.match(/console\.\w+\([^;]*\)/g) ?? []) assert.doesNotMatch(call.replace(/^console\.\w+\("[a-z_]+"/, ""), /merchantKey|merchantSalt|config\.config|callback|raw|body|email|message/i, `${f}: ${call}`);
    assert.doesNotMatch(src, /Response\.json\([^)]*(merchantKey|merchantSalt|merchantId)/, f);
  }
});
test("no client component imports PayTR code", () => {
  const client = [...globSync("app/**/*.tsx"), ...globSync("components/**/*.tsx"), ...globSync("public/*.js")].filter((f) => /^["']use client["']/.test(read(f)) || f.startsWith("public/"));
  for (const f of client) assert.doesNotMatch(read(f), /lib\/paytr|payment-pages/, f);
});
test("only the exact callback path skips the same-origin check", () => {
  assert.equal(requiresSameOrigin("/api/payments/paytr/callback"), false);
  for (const p of ["/api/payments/paytr/token", "/api/payments/paytr/callback/", "/api/payments/paytr/callbackX", "/api/orders", "/api/admin/orders/x/payments"]) assert.equal(requiresSameOrigin(p), true, p);
  assert.match(read("proxy.ts"), /if \(!requiresSameOrigin\(request\.nextUrl\.pathname\)\) return null;/);
});
test("CSP is not loosened for PayTR in this phase", () => {
  const csp = read("lib/security-headers.ts");
  assert.doesNotMatch(csp, /paytr|frame-src \*|script-src \*|unsafe-eval/i);
});
test("checkout stays untouched: no PayTR option or iframe is shown there while the provider is off", () => {
  assert.doesNotMatch(read("public/checkout.html"), /paytr|iframe/i);
});

// ---- refund boundary ------------------------------------------------------------------------------------------------
test("an online (PayTR) payment cannot be refunded through the manual refund path", () => {
  const r = validateRefund({ payment: { status: "paid", amount: 1000, method: "online" }, refundedOnPayment: 0, amount: 100 });
  assert.equal(!r.ok && r.refusal.code, "PROVIDER_REFUND_UNAVAILABLE");
  assert.match(read("app/admin/(panel)/orders/order-payments-panel.tsx"), /p\.method !== "online"/);
});
