import assert from "node:assert/strict";
import test from "node:test";
import { adminPermissions, adminRoles, roleHasPermission, type AdminPermission, type AdminRole } from "../lib/security-policy.ts";

const writePermissions: AdminPermission[] = ["catalog:write", "orders:write", "service:write", "content:write", "legal:write"];
const privilegedPermissions: AdminPermission[] = ["users:read", "users:write", "roles:write", "integrations:read", "integrations:write", "payments:configure", "security:write", "audit:read"];

// Mirrors the permission each admin API route demands, so a widened role is caught here.
// "owner" is the frozen legacy role: identical to its pre-6D.1 matrix, no privileged permission.
const expected: Record<AdminRole, Record<AdminPermission, boolean>> = {
  super_admin: { "catalog:write": true, "orders:write": true, "service:write": true, "content:write": true, "legal:write": true, "admin:read": true, "users:read": true, "users:write": true, "roles:write": true, "integrations:read": true, "integrations:write": true, "payments:configure": true, "security:write": true, "audit:read": true },
  admin: { "catalog:write": true, "orders:write": true, "service:write": true, "content:write": true, "legal:write": false, "admin:read": true, "users:read": false, "users:write": false, "roles:write": false, "integrations:read": false, "integrations:write": false, "payments:configure": false, "security:write": false, "audit:read": false },
  owner: { "catalog:write": true, "orders:write": true, "service:write": true, "content:write": true, "legal:write": true, "admin:read": true, "users:read": false, "users:write": false, "roles:write": false, "integrations:read": false, "integrations:write": false, "payments:configure": false, "security:write": false, "audit:read": false },
  operations_manager: { "catalog:write": true, "orders:write": true, "service:write": true, "content:write": false, "legal:write": false, "admin:read": true, "users:read": false, "users:write": false, "roles:write": false, "integrations:read": false, "integrations:write": false, "payments:configure": false, "security:write": false, "audit:read": false },
  catalog_manager: { "catalog:write": true, "orders:write": false, "service:write": false, "content:write": true, "legal:write": false, "admin:read": true, "users:read": false, "users:write": false, "roles:write": false, "integrations:read": false, "integrations:write": false, "payments:configure": false, "security:write": false, "audit:read": false },
  support_agent: { "catalog:write": false, "orders:write": true, "service:write": true, "content:write": false, "legal:write": false, "admin:read": true, "users:read": false, "users:write": false, "roles:write": false, "integrations:read": false, "integrations:write": false, "payments:configure": false, "security:write": false, "audit:read": false },
  viewer: { "catalog:write": false, "orders:write": false, "service:write": false, "content:write": false, "legal:write": false, "admin:read": true, "users:read": false, "users:write": false, "roles:write": false, "integrations:read": false, "integrations:write": false, "payments:configure": false, "security:write": false, "audit:read": false },
};

test("the role/permission matrix matches the documented Phase 3A matrix", () => {
  for (const role of adminRoles) {
    for (const [permission, allowed] of Object.entries(expected[role]) as [AdminPermission, boolean][]) {
      assert.equal(roleHasPermission(role, permission), allowed, `${role} -> ${permission} should be ${allowed}`);
    }
  }
});

test("viewer cannot perform any privileged mutation", () => {
  for (const permission of writePermissions) assert.equal(roleHasPermission("viewer", permission), false, `viewer must not hold ${permission}`);
});

test("support_agent cannot write catalog or content", () => {
  assert.equal(roleHasPermission("support_agent", "catalog:write"), false);
  assert.equal(roleHasPermission("support_agent", "content:write"), false);
});

test("catalog_manager cannot write orders or service records", () => {
  assert.equal(roleHasPermission("catalog_manager", "orders:write"), false);
  assert.equal(roleHasPermission("catalog_manager", "service:write"), false);
});

test("operations_manager cannot publish content", () => {
  assert.equal(roleHasPermission("operations_manager", "content:write"), false);
});

test("only super_admin holds every privileged permission", () => {
  const privileged = adminRoles.filter((role) => privilegedPermissions.every((permission) => roleHasPermission(role, permission)));
  assert.deepEqual(privileged, ["super_admin"]);
  const legacy = adminRoles.filter((role) => role === "owner");
  for (const role of legacy) for (const permission of privilegedPermissions) assert.equal(roleHasPermission(role, permission), false, `${role} -> ${permission}`);
});

test("every role can read the admin surface", () => {
  for (const role of adminRoles) assert.equal(roleHasPermission(role, "admin:read"), true);
});

test("unknown or spoofed roles hold no permissions", () => {
  for (const role of ["", "administrator", "superuser", "SUPER_ADMIN", "__proto__", "constructor"]) {
    for (const permission of [...writePermissions, ...privilegedPermissions, "admin:read" as AdminPermission]) {
      assert.equal(roleHasPermission(role, permission), false, `${role || "(empty)"} must not hold ${permission}`);
    }
  }
});

test("the matrix defines exactly the seven expected roles", () => {
  assert.deepEqual([...adminRoles].sort(), ["admin", "catalog_manager", "operations_manager", "owner", "super_admin", "support_agent", "viewer"]);
  assert.deepEqual(Object.keys(adminPermissions).sort(), ["admin", "catalog_manager", "operations_manager", "owner", "super_admin", "support_agent", "viewer"]);
});
