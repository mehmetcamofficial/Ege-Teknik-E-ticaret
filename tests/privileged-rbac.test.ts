/**
 * Phase 6D.1 governance tests: the super_admin/admin role model, the grant rules,
 * the retired owner role, last-active-super-admin protection, invitation safety and
 * secret containment. These run against the repository only - no database is touched.
 */
import assert from "node:assert/strict";
import { existsSync, globSync, readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import {
  ADMIN_INVITE_MAX_TTL_HOURS,
  OPERATIONAL_GRANT_MAX_HOURS,
  OPERATIONAL_GRANT_PRESETS_HOURS,
  PRIVILEGED_GRANT_MAX_HOURS,
  PRIVILEGED_GRANT_PERMISSIONS,
  adminPermissions,
  adminRoles,
  canRemovePrivileged,
  findSecretLeak,
  isGrantActive,
  isPrivilegedRole,
  maxGrantTtlHours,
  roleHasPermission,
  type AdminPermission,
  type AdminRole,
} from "../lib/security-policy.ts";

const read = (f: string) => readFileSync(f, "utf8");
const privileged: AdminPermission[] = ["users:read", "users:write", "roles:write", "integrations:read", "integrations:write", "payments:configure", "security:write", "audit:read"];
const tsFilesIn = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const full = `${dir}/${entry}`;
  return statSync(full).isDirectory() ? tsFilesIn(full) : full.endsWith(".ts") ? [full] : [];
});

// ---- role model -------------------------------------------------------------------------------------
test("the matrix defines exactly seven roles: the two new ones plus the five frozen legacy ones", () => {
  assert.deepEqual([...adminRoles].sort(), ["admin", "catalog_manager", "operations_manager", "owner", "super_admin", "support_agent", "viewer"]);
  assert.deepEqual(Object.keys(adminPermissions).sort(), [...adminRoles].sort());
});

test("super_admin receives every privileged permission", () => {
  for (const permission of privileged) assert.equal(roleHasPermission("super_admin", permission), true, `super_admin -> ${permission}`);
});

test("only super_admin is privileged: the retired owner role gets no privileged permission", () => {
  assert.equal(isPrivilegedRole("super_admin"), true);
  for (const role of adminRoles.filter((r) => r !== "super_admin")) {
    assert.equal(isPrivilegedRole(role), false, `${role} must not be privileged`);
    for (const permission of privileged) assert.equal(roleHasPermission(role, permission), false, `${role} must not hold ${permission}`);
  }
});

test("admin is operational only: commerce writes yes, legal:write and every privileged permission no", () => {
  for (const permission of ["catalog:write", "orders:write", "service:write", "content:write", "admin:read"] as AdminPermission[]) {
    assert.equal(roleHasPermission("admin", permission), true, `admin -> ${permission}`);
  }
  assert.equal(roleHasPermission("admin", "legal:write"), false, "admin must NOT receive legal:write");
  for (const permission of privileged) assert.equal(roleHasPermission("admin", permission), false, `admin must not hold ${permission}`);
});

test("every role still holds admin:read, and unknown/prototype roles hold nothing", () => {
  for (const role of adminRoles) assert.equal(roleHasPermission(role, "admin:read"), true, role);
  for (const role of ["", "superadmin", "SUPER_ADMIN", "__proto__", "constructor", "toString"]) {
    for (const permission of [...privileged, "catalog:write" as AdminPermission, "admin:read" as AdminPermission]) {
      assert.equal(roleHasPermission(role, permission), false, `${role || "(empty)"} must not hold ${permission}`);
    }
  }
});

// ---- temporary grants -------------------------------------------------------------------------------
test("payments:configure is ungrantable and stays Super-Admin-only", () => {
  assert.equal(maxGrantTtlHours("payments:configure"), 0, "a 0 ceiling closes the grant path");
  assert.deepEqual([...PRIVILEGED_GRANT_PERMISSIONS], ["users:write", "roles:write", "security:write"]);
  for (const permission of PRIVILEGED_GRANT_PERMISSIONS) assert.ok(maxGrantTtlHours(permission) > 0);
});

test("grant ceilings: privileged 24h, operational 168h, presets 1/8/24/168 hours", () => {
  for (const permission of PRIVILEGED_GRANT_PERMISSIONS) assert.equal(maxGrantTtlHours(permission), PRIVILEGED_GRANT_MAX_HOURS, permission);
  assert.equal(maxGrantTtlHours("orders:write"), OPERATIONAL_GRANT_MAX_HOURS);
  assert.deepEqual([...OPERATIONAL_GRANT_PRESETS_HOURS], [1, 8, 24, 168]);
  assert.equal(ADMIN_INVITE_MAX_TTL_HOURS, 72);
});

test("the grant write path refuses >24h privileged, >168h operational, and every payments:configure grant", () => {
  const auth = read("lib/admin-auth.ts");
  const create = auth.slice(auth.indexOf("export async function createAdminGrant"), auth.indexOf("export async function revokeAdminGrant"));
  assert.match(create, /const ceiling = maxGrantTtlHours\(input\.permission\);/);
  assert.match(create, /if \(ceiling === 0\) return \{ ok: false as const, code: "UNGRANTABLE" as const \}/, "ungrantable is refused before any write");
  assert.match(create, /ttlHours > ceiling/);
  const db = read("lib/privileged-admin-db.ts");
  const grantTtlError = db.slice(db.indexOf("export function grantTtlError"), db.indexOf("export function inviteTtlError"));
  assert.match(grantTtlError, /maxGrantTtlHours\(permission\)/, "the ceiling is derived from the policy, not hard-coded");
  assert.match(grantTtlError, /ttlHours > ceiling/);
  const sql = read("drizzle-pg/0011_admin_governance.sql");
  // drizzle-kit qualifies the column inside the CHECK, hence the optional "admin_grants"." prefix.
  assert.match(sql, /admin_grants_no_payments_configure_ck" CHECK \((?:"admin_grants"\.)?"permission" <> 'payments:configure'\)/, "the DB refuses it too");
});

test("expired and revoked grants do not authorize; a live one does (server clock, per request)", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const live = { revokedAt: null, expiresAt: new Date("2026-09-26T13:00:00Z") };
  assert.equal(isGrantActive(live, now), true);
  assert.equal(isGrantActive({ ...live, expiresAt: new Date("2026-09-26T11:59:59Z") }, now), false, "expired");
  assert.equal(isGrantActive({ ...live, expiresAt: now }, now), false, "expiresAt == now is already expired");
  assert.equal(isGrantActive({ ...live, revokedAt: new Date("2026-09-26T10:00:00Z") }, now), false, "revoked");
});

test("the session lookup resolves a permission as base role OR an active grant, with no scattered super_admin check", () => {
  const auth = read("lib/admin-auth.ts");
  const head = auth.slice(0, auth.indexOf("/** Authorization boundary PayTR"));
  assert.match(head, /adminGrants/, "the grant table is joined into the session lookup");
  assert.match(head, /isGrantActive\(/, "expiry/revocation is decided by the pure helper, not by a stored boolean");
  assert.doesNotMatch(head, /role === "super_admin"/, "no role==='super_admin' shortcut in the auth path");
});

// ---- last active super_admin -----------------------------------------------------------------------
test("the last active super_admin cannot be deactivated or demoted", () => {
  assert.equal(canRemovePrivileged({ activeSuperAdminCount: 1, targetIsActiveSuperAdmin: true }), false);
  assert.equal(canRemovePrivileged({ activeSuperAdminCount: 2, targetIsActiveSuperAdmin: true }), true);
  assert.equal(canRemovePrivileged({ activeSuperAdminCount: 1, targetIsActiveSuperAdmin: false }), true, "a non-privileged target is not blocked by this guard");
});

test("deactivation and demotion both consult the guard, lock the row, and revoke sessions atomically", () => {
  const auth = read("lib/admin-auth.ts");
  const from = auth.indexOf("export async function deactivateAdminUser");
  const to = auth.indexOf("export async function hashWithSecret");
  const both = auth.slice(from, to);
  assert.equal((both.match(/canRemovePrivileged\(/g) ?? []).length, 2, "both operations consult the guard");
  assert.equal((both.match(/\.for\("update"\)/g) ?? []).length >= 2, true, "both lock the target row");
  // 3 calls: deactivate, reactivate, and the role change. A reactivation must be audited too.
  assert.equal((both.match(/auditPrivileged\(/g) ?? []).length, 3, "every deactivation, reactivation and role change writes its audit record");
  const deactivate = both.slice(0, both.indexOf("export async function changeAdminRole"));
  assert.match(deactivate, /adminSessions\)\.set\(\{ revokedAt: now \}\)/, "deactivation revokes every live session");
  const roleChange = both.slice(both.indexOf("export async function changeAdminRole"));
  assert.match(roleChange, /if \(demotingPrivileged\)\s*\{[\s\S]{0,300}adminSessions/, "a privilege drop also revokes live sessions");
});

// ---- invitation: hash-only, single-use, delivered by e-mail only ---------------------------------
test("the invitation stores only a sha256 hash and delivers the raw token through the existing Resend mail path", () => {
  const auth = read("lib/admin-auth.ts");
  const create = auth.slice(auth.indexOf("export async function createAdminInvite"), auth.indexOf("export type InviteAcceptResult"));
  assert.match(create, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(create, /tokenHash: sha256\(token\)/, "only the hash is persisted");
  assert.match(create, /sendMail\(/, "delivery goes through lib/mail.ts (Resend)");
  assert.match(read("lib/mail.ts"), /api\.resend\.com\/emails/, "the existing provider path is reused, not a second mailer");
  assert.match(create, /ttlHours > ADMIN_INVITE_MAX_TTL_HOURS/, "the 72-HOUR ceiling is enforced before the insert");
});
test("the raw invitation token is never returned by any API route or rendered by the admin UI", () => {
  for (const f of globSync("app/api/admin/users/**/*.ts")) {
    assert.doesNotMatch(read(f), /tokenHash|rawToken|inviteUrl/, `${f} must not expose an invitation token`);
  }
  const view = read("app/admin/(panel)/users/users-view.tsx");
  // Comments may explain that the token never reaches the browser; the rendered/sent code may not carry one.
  const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(viewCode, /token/i, "the UI never displays or submits an invitation token");
  assert.doesNotMatch(read("app/api/auth/accept-invite/route.ts"), /Response\.json\(\{[^}]*token/, "acceptance never echoes the token back");
});
test("invitation acceptance is single-use: the claiming UPDATE requires accepted_at and revoked_at to still be NULL", () => {
  const auth = read("lib/admin-auth.ts");
  const accept = auth.slice(auth.indexOf("export async function acceptAdminInvite"), auth.indexOf("// ---- Phase 6D.1: time-boxed grants"));
  assert.match(accept, /isNull\(adminInvites\.acceptedAt\), isNull\(adminInvites\.revokedAt\)/, "a replay or a race finds 0 rows");
  assert.match(accept, /if \(!claimed\.length\) return \{ ok: false as const, code: "INVALID" as const \}/);
  assert.match(accept, /expiresAt\.getTime\(\) <= now\.getTime\(\)/, "expiry is server-enforced at acceptance time");
});

// ---- the retired owner role, at the database level -------------------------------------------------
test("migration 0011 retires the owner role without ever failing on a grandfathered owner row", () => {
  const sql = read("drizzle-pg/0011_admin_governance.sql");
  // The allow-list keeps 'owner' precisely so existing (inactive) owner rows validate - the
  // enforcement is a trigger, which a value-excluding CHECK could not provide.
  assert.match(sql, /CHECK \("role" IN \('super_admin','admin','owner','operations_manager','catalog_manager','support_agent','viewer'\)\)/);
  assert.doesNotMatch(sql, /CHECK \("role" <> 'owner'\)/, "a value-excluding CHECK would fail on the existing legacy owner row");
  const trigger = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION \"admin_users_retire_owner_guard\""));
  assert.match(trigger, /TG_OP = 'INSERT' AND NEW\."role" = 'owner'[\s\S]*RAISE EXCEPTION/, "no new owner account can be created");
  assert.match(trigger, /NEW\."role" = 'owner' AND OLD\."role" IS DISTINCT FROM 'owner'[\s\S]*RAISE EXCEPTION/, "no conversion back to owner");
  assert.match(trigger, /OLD\."active" = false AND NEW\."active" = true[\s\S]*RAISE EXCEPTION/, "an inactive legacy owner cannot be reactivated as owner - it must be converted first");
  assert.match(trigger, /convert to super_admin\/admin first/, "the error names the two-step recovery path");
});
test("the owner count guard inside 0011 is fail-closed and still present verbatim", () => {
  const sql = read("drizzle-pg/0011_admin_governance.sql");
  // The whole guard block (from its first declaration to the promotion block) must stay verbatim.
  const guard = sql.slice(sql.indexOf("DO $$ DECLARE"), sql.indexOf("Block 1:"));
  assert.match(sql, /active_owner_count = 1 THEN/, "exactly one active owner is the only promoting case");
  assert.match(guard, /RAISE EXCEPTION 'abort 0011: 0 active owners found; refusing to invent a privileged identity/, "zero owners stops instead of bootstrapping a privileged identity");
  assert.match(guard, /refusing bulk promotion/, "2+ owners stops instead of promoting all of them");
  assert.match(sql, /consolidation_count >= 1 THEN/, "a retried run after a partial failure may resume");
  assert.match(sql, /'phase_6d1_owner_consolidation'/, "the promotion is a reasoned, auditable data change");
  assert.match(sql, /ON CONFLICT \("id"\) DO NOTHING/, "the audit id is deterministic, so a retry cannot double-write");
});
test("migration 0011 stays additive except for the reviewed owner promotion, and ships no PayTR credential", () => {
  const sql = read("drizzle-pg/0011_admin_governance.sql");
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|RENAME/i, "nothing existing is dropped or renamed");
  assert.doesNotMatch(sql, /paytr|merchant.?key|api.?key|secret|credential/i, "PayTR remains out of scope: no credential value, column or row");
  assert.doesNotMatch(sql, /INSERT INTO "integration_configs"/i, "no integration row is seeded");
  for (const table of ["admin_invites", "admin_grants", "integration_configs"]) assert.match(sql, new RegExp(`CREATE TABLE "${table}"`), table);
  // payments:configure is closed at the database level too, not merely in application code.
  // Drizzle renders CHECKs table-qualified, so the assertion allows the optional "table". prefix.
  assert.match(sql, /CONSTRAINT "admin_grants_no_payments_configure_ck" CHECK \((?:"admin_grants"\.)?"permission" <> 'payments:configure'\)/);
  assert.match(sql, /make_interval\(hours => 72\)/, "the invitation lifetime is capped at 72 HOURS in the database as well");
  assert.match(sql, /make_interval\(hours => 168\)/, "the grant lifetime has a database backstop of 168 hours");
  const entries = (JSON.parse(read("drizzle-pg/meta/_journal.json")) as { entries: { tag: string; idx: number }[] }).entries;
  const at = (tag: string) => entries.find((e) => e.tag === tag);
  assert.equal(at("0011_admin_governance")?.idx, at("0010_admin_password_resets")!.idx + 1);
  assert.ok(existsSync("drizzle-pg/meta/0011_snapshot.json"));
});

// ---- secret containment ------------------------------------------------------------------------------
test("no privileged module or route carries a secret shape into a response, an audit payload or the client", () => {
  // The runtime guard itself: any secret-shaped key is refused before the audit row is written.
  for (const key of ["password", "passwordHash", "tokenHash", "apiKey", "secret", "merchantKey", "privateKey", "ciphertext"]) {
    assert.equal(findSecretLeak({ [key]: "x" }), key, `${key} must be caught by findSecretLeak`);
  }
  assert.equal(findSecretLeak({ email: "a@b.test", role: "admin", ttlHours: 24 }), null, "ordinary metadata is allowed");

  // Statically: the privileged HTTP surface must not hand a secret column to a response or a log.
  const routes = [...tsFilesIn("app/api/admin/users"), "app/api/admin/audit/route.ts", "lib/privileged-admin-db.ts"];
  assert.ok(routes.length >= 4, "the privileged surface exists to scan");
  for (const f of routes) {
    const src = read(f);
    assert.doesNotMatch(src, /passwordHash|tokenHash|inviteUrl|rawToken|console\.log\([^)]*token/i, `${f} must not surface a secret`);
  }
  // lib/admin-auth.ts is the one module that legitimately WRITES password/token hashes, so the rule
  // there is directional: a hash may be stored, but it may never be returned or logged.
  const auth = read("lib/admin-auth.ts");
  for (const line of auth.split("\n")) {
    if (/Response\.json|console\.(log|info|warn|error)/.test(line)) {
      assert.doesNotMatch(line, /passwordHash|tokenHash|rawToken/i, `a hash or raw token must never be returned or logged: ${line.trim()}`);
    }
  }
  assert.doesNotMatch(auth, /payload:\s*\{[^}]*(tokenHash|passwordHash|rawToken)/, "no secret may enter an audit payload literal");
  assert.match(auth, /tokenHash: sha256\(token\)/, "the stored invite credential is a hash of the raw token, never the token itself");

  // The audit insert path itself is guarded, so a future route cannot forget the check.
  const helper = auth.slice(auth.indexOf("export async function auditPrivileged"), auth.indexOf("type Tx ="));
  assert.match(helper, /findSecretLeak\(payload\)/);
  assert.match(helper, /throw new Error\(`audit payload refused/, "the refusal throws, so the caller's transaction rolls back with it");
  // Every privileged mutation writes through that helper rather than a raw insert.
  const mutations = tsFilesIn("app/api/admin/users");
  for (const f of mutations) assert.doesNotMatch(read(f), /insert\(auditLogs\)/, `${f} must go through auditPrivileged`);
});

test("the privileged role list a Super Admin can assign excludes the retired owner role", () => {
  const assignable = (roleHasPermission("super_admin", "roles:write") ? ["super_admin", "admin"] : []) as AdminRole[];
  assert.ok(assignable.includes("super_admin"));
  // The invite/role Zod enums in the routes carry the real list; owner must be absent from all of them.
  for (const f of tsFilesIn("app/api/admin/users")) {
    const enums = [...read(f).matchAll(/z\.enum\(\[([^\]]+)\]/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().replace(/["']/g, "")));
    for (const role of enums) assert.notEqual(role, "owner", `${f} must not offer the retired owner role`);
  }
});

