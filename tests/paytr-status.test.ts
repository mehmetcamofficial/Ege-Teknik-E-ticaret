import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPaytrAdminStatus, maskMerchantId, paytrFrameAllowedByCsp } from "../lib/paytr-status.ts";
import { ADMIN_NAV, visibleNav } from "../lib/admin-ui.ts";
import { roleHasPermission } from "../lib/security-policy.ts";

/** Read-only PayTR admin status: every value is fake; the point is that key and salt can never come back out. */
const read = (f: string) => readFileSync(f, "utf8");
const KEY = "FAKE_MERCHANT_KEY_value_9f8e7d", SALT = "FAKE_MERCHANT_SALT_value_1a2b3c", ID = "1234567890";
const full = { PAYTR_ENABLED: "true", PAYTR_MERCHANT_ID: ID, PAYTR_MERCHANT_KEY: KEY, PAYTR_MERCHANT_SALT: SALT, PAYTR_OK_URL: "https://x.test/payment/success", PAYTR_FAIL_URL: "https://x.test/payment/fail" };

test("status: Kapalı unless PAYTR_ENABLED is exactly 'true'", () => {
  for (const v of [undefined, "false", "TRUE", "1"]) assert.equal(buildPaytrAdminStatus({ ...full, PAYTR_ENABLED: v }).state, "disabled", String(v));
});
test("status: Yapılandırma eksik when enabled with any required value missing, listing names only", () => {
  for (const drop of ["PAYTR_MERCHANT_ID", "PAYTR_MERCHANT_KEY", "PAYTR_MERCHANT_SALT", "PAYTR_OK_URL", "PAYTR_FAIL_URL"] as const) {
    const s = buildPaytrAdminStatus({ ...full, [drop]: "" });
    assert.equal(s.state, "misconfigured", drop);
    assert.ok(s.missing.includes(drop), drop);
  }
});
test("status: Test modu when complete and test mode not explicitly off; Aktif only when PAYTR_TEST_MODE=false", () => {
  assert.equal(buildPaytrAdminStatus(full).state, "test");
  assert.equal(buildPaytrAdminStatus({ ...full, PAYTR_TEST_MODE: "true" }).state, "test");
  assert.equal(buildPaytrAdminStatus({ ...full, PAYTR_TEST_MODE: "false" }).state, "live");
});
test("merchant id is masked; short ids are fully masked; empty is null", () => {
  assert.equal(maskMerchantId("1234567890"), "12••••90");
  assert.equal(maskMerchantId("1234"), "••••");
  assert.equal(maskMerchantId("  "), null);
  assert.equal(maskMerchantId(undefined), null);
});
test("the status object carries key/salt as booleans only - no secret or full merchant id in any state", () => {
  for (const env of [full, { ...full, PAYTR_TEST_MODE: "false" }, { ...full, PAYTR_OK_URL: "" }, { ...full, PAYTR_ENABLED: "false" }]) {
    const json = JSON.stringify(buildPaytrAdminStatus(env));
    assert.doesNotMatch(json, new RegExp(KEY)); assert.doesNotMatch(json, new RegExp(SALT)); assert.doesNotMatch(json, new RegExp(ID));
    const s = buildPaytrAdminStatus(env);
    assert.equal(typeof s.merchantKeyConfigured, "boolean"); assert.equal(typeof s.merchantSaltConfigured, "boolean");
  }
  assert.deepEqual(Object.keys(buildPaytrAdminStatus(full)).sort(), ["callbackPath", "cspFrameAllowed", "enabled", "failPath", "failUrlConfigured", "merchantIdMasked", "merchantKeyConfigured", "merchantSaltConfigured", "missing", "okUrlConfigured", "provider", "state", "successPath", "testMode"].sort());
});
test("CSP readiness is read from the real policy: not ready today, ready only with PayTR's exact origin in frame-src", () => {
  assert.equal(buildPaytrAdminStatus(full).cspFrameAllowed, false);
  assert.equal(paytrFrameAllowedByCsp("default-src 'self'; frame-src https://www.paytr.com"), true);
  assert.equal(paytrFrameAllowedByCsp("default-src 'self'; frame-src *"), false);
  assert.equal(paytrFrameAllowedByCsp("default-src 'self'; frame-src https://www.paytr.com.evil.test"), false);
});
test("RBAC: read-only API and page both require integrations:read; there is no write method", () => {
  const route = read("app/api/admin/integrations/paytr/route.ts");
  assert.match(route, /getAdminUser\("integrations:read"\)/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(read("app/admin/(panel)/integrations/payments/page.tsx"), /requireAdminPage\("integrations:read"\)/);
  assert.equal(ADMIN_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/integrations/payments")?.permission, "integrations:read");
  for (const role of ["admin", "operations_manager", "catalog_manager", "support_agent", "viewer"]) {
    assert.equal(roleHasPermission(role, "integrations:read"), false, role);
    assert.ok(!visibleNav(role).flatMap((s) => s.items).some((i) => i.href === "/admin/integrations/payments"), role);
  }
  assert.ok(visibleNav("super_admin").flatMap((s) => s.items).some((i) => i.href === "/admin/integrations/payments"));
});
test("secrets never reach a response, props, client code or logs", () => {
  const route = read("app/api/admin/integrations/paytr/route.ts");
  assert.doesNotMatch(route, /PAYTR_MERCHANT_(KEY|SALT)|console\./);
  assert.match(route, /Response\.json\(\{ status, metrics \}/);
  const page = read("app/admin/(panel)/integrations/payments/page.tsx");
  assert.match(page, /<PaymentProvidersView \/>/, "no configuration is passed as server component props");
  assert.doesNotMatch(page, /process\.env/);
  const view = read("app/admin/(panel)/integrations/payments/payment-providers-view.tsx");
  assert.match(view, /^"use client"/);
  assert.doesNotMatch(view, /lib\/paytr|process\.env|merchantKey"|merchantSalt"|@\/db/);
  assert.doesNotMatch(read("lib/paytr-status.ts"), /console\./);
});
test("metrics count money from paid PayTR rows only and read no payload or customer field", () => {
  const src = read("lib/paytr-db.ts");
  const fn = src.slice(src.indexOf("export async function loadPaytrAdminMetrics"));
  assert.match(fn, /paidAmount: sql<string>`coalesce\(sum\(\$\{payments\.amount\}\) filter \(where \$\{payments\.status\} = 'paid'\), 0\)::bigint`/);
  assert.match(fn, /where\(eq\(payments\.provider, PAYTR_PROVIDER\)\)/);
  assert.doesNotMatch(fn, /auditLogs\.payload|customerName|orders\.email|orders\.phone|failureMessage|iframeToken/);
});
