import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const api = readFileSync("app/api/admin/eft-reconciliation/route.ts","utf8");
const service = readFileSync("lib/eft-review-db.ts","utf8");
const ui = readFileSync("app/admin/(panel)/eft-reconciliation/review-view.tsx","utf8");
const page = readFileSync("app/admin/(panel)/eft-reconciliation/page.tsx","utf8");

test("EFT review endpoint requires authenticated financial permission and is cache-safe",()=>{
  assert.match(api,/getAdminUser\("admin:read"\)/);
  assert.match(api,/effectivePermissions\(/);
  assert.match(api,/permissions\.includes\("payments:record"\)/);
  assert.match(api,/permissions\.includes\("payments:configure"\)/);
  assert.match(api,/auditPermissionDenied\(/);
  assert.match(api,/no-store/);
});
test("EFT review endpoint exposes GET only and cannot write finance ledger",()=>{
  assert.match(api,/export async function GET\(/);
  assert.doesNotMatch(api,/export async function (?:POST|PUT|PATCH|DELETE)\(/);
  assert.doesNotMatch(api,/recordManualPayment|recordRefund|\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(service,/\.insert\(|\.update\(|\.delete\(/);
  assert.match(service,/settlementEnabled: false/);
  assert.match(service,/paymentsWritten: false/);
});
test("admin review page is session gated and has no payment mutation controls",()=>{
  assert.match(page,/requireAdminPage\(\)/);
  assert.match(ui,/useAdminJson<Queue>/);
  assert.match(ui,/data\.movements\.map/);
  assert.doesNotMatch(ui,/sendAdmin\(|method: "POST"|method: "PATCH"|recordManualPayment/);
  assert.match(ui,/mutabakat karar/i);
});
test("queue caps returned movements and includes bank account mask only",()=>{
  assert.match(service,/EFT_REVIEW_LIMIT = 50/);
  assert.match(service,/\.limit\(EFT_REVIEW_LIMIT\)/);
  assert.match(service,/ibanLast4:/);
  assert.doesNotMatch(service,/\biban:(?!Last4)/i);
});
