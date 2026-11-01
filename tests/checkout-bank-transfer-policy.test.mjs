import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path,"utf8");
test("checkout offers only the pending bank transfer-compatible legacy order path",()=>{
  const html=read("public/checkout.html");
  const options=[...html.matchAll(/<input\b[^>]*\bname="provider"[^>]*>/g)].map(x=>x[0]);
  assert.equal(options.length,1,"bank POS and iyzico must not be selectable");
  assert.match(options[0],/value="discovery"/);
  assert.match(options[0],/checked/);
  assert.match(html,/Havale \/ EFT — sipariş sonrası ödeme/);
  assert.match(html,/Banka sanal POS ve iyzico başvuruları sonuçlanmadığı/);
  assert.match(html,/ödeme bekliyor durumunda/);
});
test("bank transfer copy refuses to invent bank account or claim automatic payment",()=>{
  const html=read("public/checkout.html");
  assert.doesNotMatch(html,/TR\d{24}/);
  assert.match(html,/Havale\/EFT hesaba geçip yetkili görevli tarafından doğrulanmadan sipariş ödenmiş sayılmaz/);
  assert.match(html,/bu adımda ödeme tahsil edilmedi/);
});
test("existing server order schema is not misrepresented as verified EFT settlement",()=>{
  const schema=read("lib/order-domain.ts");
  assert.match(schema,/paymentProvider: z\.enum\(\["PayTR", "iyzico", "discovery"\]\)/);
  const orders=read("app/api/orders/route.ts");
  assert.match(orders,/loadRequiredCheckoutLegalDocuments/);
  assert.match(orders,/LEGAL_DOCUMENTS_UNAVAILABLE/);
});
