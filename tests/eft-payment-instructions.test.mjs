import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync("public/checkout.html","utf8");
const client=readFileSync("public/store-core.js","utf8");
const server=readFileSync("lib/order-domain.ts","utf8");

test("confirmation has an accessible EFT memo reference but no fabricated IBAN",()=>{
  assert.match(html,/data-bank-transfer-instructions/);
  assert.match(html,/data-bank-transfer-reference><\/code>/);
  assert.match(html,/data-bank-transfer-reference-copy/);
  assert.match(html,/aria-live="polite"/);
  assert.doesNotMatch(html,/TR\d{24}/);
  assert.match(html,/Şirket banka hesabı ekibimiz tarafından doğrulanıp size iletildiğinde/);
});
test("the memo is the server-issued order number, not browser-provided bank data",()=>{
  assert.match(server,/orderNumber: input\.orderNumber/);
  assert.match(client,/transferRef\.textContent=String\(data\.orderNumber\|\|''\)/);
  assert.match(client,/navigator\.clipboard\.writeText\(String\(data\.orderNumber\)\)/);
  assert.doesNotMatch(client,/transferRef\.innerHTML\s*=/);
});
test("checkout has no active bank card or iyzico option",()=>{
  assert.deepEqual([...html.matchAll(/name="provider" value="([^"]+)"/g)].map(m=>m[1]),["discovery"]);
  assert.match(html,/Havale \/ EFT — sipariş sonrası ödeme/);
  assert.match(html,/Banka sanal POS ve iyzico başvuruları sonuçlanmadığı/);
});
