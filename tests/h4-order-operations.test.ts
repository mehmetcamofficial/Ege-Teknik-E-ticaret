/**
 * H4-B order operations: contracts the admin order workflow must keep. Source-level and pure-logic checks only
 * (no database); the database-backed behaviour is exercised by the disposable PostgreSQL suites listed in docs/h4.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { cancellationBlockedByCollection, derivePaymentStatus, ledgerCoversOrder } from "../lib/finance.ts";
import { canTransitionOrder, orderStatuses } from "../lib/order-domain.ts";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const routes = walk("app/api/admin/orders").filter((f) => f.endsWith("route.ts"));
const handlers = (file: string) => [...readFileSync(file, "utf8").matchAll(/export (?:async )?function (GET|POST|PATCH|PUT|DELETE)\b[\s\S]*?(?=\nexport |\n\/\*\*|$)/g)].map((m) => ({ method: m[1], body: m[0] }));

test("H4-B every admin order handler authenticates first, reads need admin:read and writes need orders:write", () => {
  assert.ok(routes.length >= 4, "orders, order, payments and refunds routes exist");
  for (const file of routes) for (const { method, body } of handlers(file)) {
    const permission = /getAdminUser\("([a-z:]+)"\)/.exec(body)?.[1];
    // H5-B: money and "paid" need their own finance permission, checked right after authentication (see tests/h5-rbac.test.ts).
    const financeRoute = /payments|refunds/.test(file);
    const paidAware = /permissionForOrderStatus/.test(body);
    if (method === "GET" || financeRoute || paidAware) assert.equal(permission, "admin:read", `${file} ${method}`);
    else assert.equal(permission, "orders:write", `${file} ${method}`);
    if (financeRoute && method !== "GET") assert.match(body, /payments:(?:record|refund)/, `${file}: finance permission required`);
    const parse = [body.indexOf("readJson("), body.indexOf("request.json(")].filter((i) => i >= 0);
    if (parse.length) assert.ok(body.indexOf("getAdminUser(") < Math.min(...parse), `${file} ${method}: auth precedes body parsing`);
    assert.match(body, /Yetkisiz erişim/, `${file} ${method}: a missing permission is refused (403), not hidden in the UI`);
  }
});

test("H4-B no admin order route writes payment_status; it is derived from the payment ledger", () => {
  for (const file of routes) assert.doesNotMatch(readFileSync(file, "utf8"), /\.set\(\{[^}]*paymentStatus|payment_status\s*=/, file);
  assert.equal(derivePaymentStatus({ total: 1000, orderStatus: "pending_payment", collected: 0, refunded: 0 }), "pending", "an unpaid order is 'pending', never 'paid'");
  assert.equal(derivePaymentStatus({ total: 1000, orderStatus: "pending_payment", collected: 400, refunded: 0 }), "partially_paid");
  assert.equal(derivePaymentStatus({ total: 1000, orderStatus: "paid", collected: 1000, refunded: 0 }), "paid");
  assert.equal(derivePaymentStatus({ total: 1000, orderStatus: "cancelled", collected: 1000, refunded: 1000 }), "refunded");
});

test("H4-B an order cannot be marked paid without a ledger entry covering the full total, and cannot skip payment", () => {
  assert.equal(ledgerCoversOrder(1000, 0, 0), false);
  assert.equal(ledgerCoversOrder(1000, 999, 0), false);
  assert.equal(ledgerCoversOrder(1000, 1000, 0), true);
  assert.equal(ledgerCoversOrder(1000, 1000, 1), false, "a refund after payment un-covers the order");
  assert.deepEqual(orderStatuses.filter((to) => canTransitionOrder("pending_payment", to)), ["paid", "cancelled"], "an unpaid order can only be paid or cancelled");
  for (const to of ["preparing", "shipped", "delivery", "delivered", "installation", "completed"] as const) assert.equal(canTransitionOrder("pending_payment", to), false, `pending_payment -> ${to}`);
  assert.equal(orderStatuses.filter((from) => canTransitionOrder(from, "paid")).join(), "pending_payment", "'paid' is reachable only from pending_payment");
  assert.deepEqual(orderStatuses.filter((to) => canTransitionOrder("cancelled", to)), [], "cancelled is terminal");
});

test("H4-B cancelling an order that still holds collected money is refused until it is refunded", () => {
  assert.equal(cancellationBlockedByCollection(1000, 0), true);
  assert.equal(cancellationBlockedByCollection(1000, 1000), false);
  assert.equal(cancellationBlockedByCollection(0, 0), false, "nothing collected: cancel freely");
  const route = readFileSync("app/api/admin/orders/[id]/route.ts", "utf8");
  assert.match(route, /code==="REFUND_REQUIRED"\)return Response\.json\([^)]*\{status:409\}/);
  assert.match(route, /code==="PAYMENT_NOT_RECORDED"\)return Response\.json\([^)]*\{status:409\}/);
  assert.match(route, /expectedStatus/, "status changes are compare-and-set against the status the admin saw");
});

test("H4-B status changes, payments and refunds are audited inside the same transaction", () => {
  assert.match(readFileSync("lib/order-transition-db.ts", "utf8"), /insertAudit:\(\{actor,orderId,from,to,paymentStatus,stockReleased\}\)=>audit\(tx,actor,"status","order"/);
  const finance = readFileSync("lib/finance-db.ts", "utf8");
  assert.match(finance, /audit\(tx, input\.actor, "payment_recorded", "order"/);
  assert.match(finance, /audit\(tx, input\.actor, full \? "refund_full" : "refund_partial", "order"/);
  assert.match(readFileSync("app/api/admin/audit/route.ts", "utf8"), /getAdminUser\("audit:read"\)/, "reading the audit trail is its own permission");
});

test("H4-B customer order lookup is POST-only (the e-mail is a credential), rate limited and never lists orders", () => {
  const route = readFileSync("app/api/orders/lookup/route.ts", "utf8");
  assert.match(route, /export const POST = publicRoute/);
  assert.doesNotMatch(route, /export (?:async function|const) GET\b/);
  assert.match(route, /rateLimit\(request, "order-lookup", 10, 15 \* 60_000\)/);
});

test("H4-B/H5-A customer e-mail never happens inline in checkout: the legacy mailer stays admin-only, orders only enqueue", () => {
  // H5-A replaced "no customer e-mail exists" by an outbox: checkout only enqueues (savepoint); a separate worker sends.
  const importers = walk("app").concat(walk("lib")).filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => /from "(?:@\/lib\/|\.\.?\/(?:lib\/)?)mail(?:\.ts)?"/.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers, ["lib/admin-auth.ts"], "lib/mail.ts is still used only by admin invitation/reset flows");
  for (const f of ["app/api/orders/route.ts", "lib/checkout-authority.ts", "lib/order-transition.ts", "lib/finance-db.ts"]) assert.doesNotMatch(readFileSync(f, "utf8"), /sendMail|lib\/mail|notifications\/provider|resendProvider|twilio|netgsm|sms/i, f);
  assert.match(readFileSync("app/api/orders/route.ts", "utf8"), /await enqueueOrderNotifications\(tx, id\);/);
  const copy = readFileSync("public/checkout.html", "utf8");
  assert.match(copy, /gönderilmeye çalışılır ve ulaşması garanti edilmez; SMS gönderilmez/, "checkout copy promises neither an e-mail nor an SMS");
  assert.doesNotMatch(copy, /e-posta(?:nıza| adresinize) gönderildi|e-postası gönderildi/i);
});
