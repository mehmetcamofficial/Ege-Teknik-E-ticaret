/** H5-B role and payment security: policy, service-layer enforcement and escalation paths (no database). */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { recordManualPayment, recordRefund, type FinanceDb } from "../lib/finance-db.ts";
import { orderStatuses } from "../lib/order-domain.ts";
import { transitionOrder, type OrderTransitionDependencies } from "../lib/order-transition.ts";
import { FINANCE_PERMISSIONS, adminPermissions, adminRoles, maxGrantTtlHours, permissionForOrderStatus, roleHasPermission, type AdminPermission, type AdminRole } from "../lib/security-policy.ts";

const read = (f: string) => readFileSync(f, "utf8");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

test("H5-B only super_admin and finance_manager hold money permissions as part of their role", () => {
  const holders = (permission: AdminPermission) => adminRoles.filter((r) => roleHasPermission(r, permission)).sort();
  for (const permission of FINANCE_PERMISSIONS) assert.deepEqual(holders(permission), ["finance_manager", "super_admin"], permission);
  for (const role of ["admin", "operations_manager", "support_agent", "catalog_manager", "viewer", "owner"] as AdminRole[]) {
    for (const permission of FINANCE_PERMISSIONS) assert.equal(roleHasPermission(role, permission), false, `${role} must not hold ${permission}`);
  }
});

test("H5-B finance_manager is a money role, not a fulfilment role; staff keep fulfilment", () => {
  assert.deepEqual([...adminPermissions.finance_manager].sort(), ["admin:read", "payments:record", "payments:refund"]);
  for (const permission of ["orders:write", "catalog:write", "legal:write", "users:write", "roles:write", "payments:configure", "security:write"] as AdminPermission[]) assert.equal(roleHasPermission("finance_manager", permission), false, permission);
  for (const role of ["admin", "operations_manager", "support_agent"] as AdminRole[]) assert.equal(roleHasPermission(role, "orders:write"), true, `${role} still does fulfilment`);
});

test("H5-B the permission a status change needs: 'paid' is money, everything else is fulfilment", () => {
  for (const status of orderStatuses) assert.equal(permissionForOrderStatus(status), status === "paid" ? "payments:record" : "orders:write", status);
});

const explodingDb = new Proxy({}, { get() { throw new Error("DATABASE TOUCHED BEFORE THE PERMISSION CHECK"); } }) as unknown as FinanceDb;
const deps: OrderTransitionDependencies = { transaction: async () => { throw new Error("DATABASE TOUCHED BEFORE THE PERMISSION CHECK"); } };
const actor = (permissions: string[]) => ({ userId: "u1", email: "u1@example.test", permissions });

test("H5-B services refuse before touching the database when the caller lacks the finance permission", async () => {
  const body = { amount: 100, method: "cash" as const, reference: "", note: "" };
  const pay = await recordManualPayment(explodingDb, { orderId: "o", body, actor: actor(["orders:write"]), idempotencyKey: "k" });
  assert.deepEqual(pay.ok ? null : [pay.refusal.status, pay.refusal.code], [403, "FORBIDDEN"]);
  const refund = await recordRefund(explodingDb, { orderId: "o", body: { paymentId: "p", amount: 1, reason: "gerekçe" }, actor: actor(["orders:write", "payments:record"]), idempotencyKey: "k" });
  assert.deepEqual(refund.ok ? null : [refund.refusal.status, refund.refusal.code], [403, "FORBIDDEN"], "payments:record does not imply refund");
  const noPermissions = await recordManualPayment(explodingDb, { orderId: "o", body, actor: actor([]), idempotencyKey: "k" });
  assert.equal(noPermissions.ok, false);
});

test("H5-B transitionOrder refuses 'paid' without payments:record and fulfilment without orders:write, before any database work", async () => {
  assert.deepEqual(await transitionOrder({ orderId: "o", expectedStatus: "pending_payment", nextStatus: "paid", actor: actor(["orders:write"]) }, deps), { ok: false, code: "FORBIDDEN" });
  assert.deepEqual(await transitionOrder({ orderId: "o", expectedStatus: "paid", nextStatus: "preparing", actor: actor(["payments:record", "payments:refund"]) }, deps), { ok: false, code: "FORBIDDEN" });
  assert.deepEqual(await transitionOrder({ orderId: "o", expectedStatus: "paid", nextStatus: "preparing", actor: actor([]) }, deps), { ok: false, code: "FORBIDDEN" });
});

const routes = walk("app/api/admin/orders").filter((f) => f.endsWith("route.ts"));
test("H5-B routes authenticate, then check the specific permission, answer 403 identically and audit the denial", () => {
  for (const [file, permission] of [["app/api/admin/orders/[id]/payments/route.ts", "payments:record"], ["app/api/admin/orders/[id]/refunds/route.ts", "payments:refund"]] as const) {
    const src = read(file), post = src.slice(src.indexOf("export async function POST"));
    assert.match(post, /getAdminUser\("admin:read"\)/);
    assert.match(post, new RegExp(`permissions\\.includes\\("${permission}"\\)`));
    assert.match(post, new RegExp(`auditPermissionDenied\\(admin, "${permission}"`));
    assert.ok(post.indexOf("permissions.includes") < post.indexOf("readJson("), "permission is checked before the body is read");
    assert.ok(post.indexOf("permissions.includes") < post.indexOf("idempotencyKey(request)"), "and before anything else");
    assert.match(post, /actor: \{ userId: admin\.userId, email: admin\.email, permissions \}/, "the service receives the effective set");
  }
  const patch = read("app/api/admin/orders/[id]/route.ts");
  assert.match(patch, /permissionForOrderStatus\(parsed\.data\.status\)/);
  assert.match(patch, /actor:\{userId:user\.userId,email:user\.email,permissions\}/);
  assert.match(patch, /result\.code==="FORBIDDEN"\)return Response\.json\(\{error:"Yetkisiz erişim"\},\{status:403\}\)/);
  assert.ok(routes.length >= 4);
});

test("H5-B no code path sets a payment as collected or an order as paid outside the ledger-guarded services", () => {
  const writers = walk("app").concat(walk("lib")).filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => /status\s*:\s*["']paid["']|paymentStatus\s*:\s*["']paid["']|set\(\{[^}]*status:\s*["']paid["']/.test(read(f)));
  assert.deepEqual(writers.sort(), writers.filter((f) => /^lib\/(finance-db|paytr-db|order-transition-db|finance)\.ts$/.test(f)).sort(), `unexpected writers of 'paid': ${writers}`);
});

test("H5-B escalation paths: only super_admin can grant, invite or change roles, and finance grants are short and audited", () => {
  const holders = (permission: AdminPermission) => adminRoles.filter((r) => roleHasPermission(r, permission));
  assert.deepEqual(holders("roles:write"), ["super_admin"]);
  assert.deepEqual(holders("users:write"), ["super_admin"]);
  assert.match(read("app/api/admin/users/[id]/grants/route.ts"), /getAdminUser\("roles:write"\)/);
  // privileged-admin-db.ts is server-only (not importable here): its rules are derived from the policy and read from source.
  const privileged = read("lib/privileged-admin-db.ts");
  assert.match(privileged, /adminPermissions\["super_admin"\] as readonly string\[\]\)\.includes\(permission\)/, "known permissions = those super_admin holds (finance included)");
  assert.ok((adminPermissions.super_admin as readonly string[]).includes("payments:record"));
  assert.ok(!(adminPermissions.super_admin as readonly string[]).includes("payments:everything"));
  for (const permission of FINANCE_PERMISSIONS) assert.equal(maxGrantTtlHours(permission), 24, `${permission}: finance grants are capped at 24 hours`);
  assert.equal(maxGrantTtlHours("payments:configure"), 0, "payments:configure stays ungrantable");
  assert.match(privileged, /INVITABLE_ROLES: readonly string\[\] = \[[^\]]*"finance_manager"/);
  assert.match(privileged, /role !== "owner"/, "the retired owner role is never assignable");
  const grant = read("lib/admin-auth.ts");
  assert.match(grant, /auditPrivileged\(tx, actor, "grant", "admin_grant"/, "a grant is audited in the same transaction");
});

test("H5-B migration 0023 widens three CHECK lists and touches no user, role assignment, grant or invitation row", () => {
  const sql = read("drizzle-pg/0023_finance_permissions.sql");
  const code = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE)\b/i, "no data change: nobody is promoted");
  for (const needle of ["admin_users_role_ck", "admin_invites_role_ck", "admin_grants_permission_ck", "finance_manager", "payments:record", "payments:refund"]) assert.ok(code.includes(needle), needle);
  assert.match(sql, /UYGULANMADI/);
  const journal = JSON.parse(read("drizzle-pg/meta/_journal.json")).entries;
  const tags = journal.map((e: { tag: string }) => e.tag);
  assert.deepEqual(tags.slice(tags.indexOf("0022_notification_outbox"), tags.indexOf("0022_notification_outbox") + 2), ["0022_notification_outbox", "0023_finance_permissions"], "0022 and 0023 stay adjacent and in order; later migrations may follow");
});

test("H5-B the refund card needs the refund flag and the collect card the record flag", () => {
  const panel = read("app/admin/(panel)/orders/order-payments-panel.tsx");
  assert.match(panel, /\{canRefund && refundable\.length > 0 && \(/);
  assert.match(panel, /const canCollect = canRecord && collectable\(ledger\);/);
});

test("H5-B the order screen offers only what the caller may do, and the page derives that from effective permissions", () => {
  const page = read("app/admin/(panel)/orders/[id]/page.tsx");
  assert.match(page, /effectivePermissions\(admin\.userId, admin\.role\)/);
  assert.match(page, /canRecordPayment=\{permissions\.includes\("payments:record"\)\}/);
  assert.match(page, /canRefund=\{permissions\.includes\("payments:refund"\)\}/);
  const view = read("app/admin/(panel)/orders/order-detail-view.tsx");
  assert.match(view, /v === "paid" \? canRecordPayment : canWrite/, "'Ödendi' is offered only to finance, fulfilment states only to staff");
  assert.match(view, /\{canWrite && order\.status !== "cancelled"/, "cancel is staff-only");
});
