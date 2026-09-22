import assert from "node:assert/strict";
import test from "node:test";
import { adminPermissions, adminRoles, roleHasPermission, type AdminPermission, type AdminRole } from "../lib/security-policy.ts";

const writePermissions: AdminPermission[] = ["catalog:write", "orders:write", "service:write", "content:write"];

// Mirrors the permission each admin API route demands, so a widened role is caught here.
const expected: Record<AdminRole, Record<AdminPermission, boolean>> = {
  owner: { "catalog:write": true, "orders:write": true, "service:write": true, "content:write": true, "admin:read": true },
  operations_manager: { "catalog:write": true, "orders:write": true, "service:write": true, "content:write": false, "admin:read": true },
  catalog_manager: { "catalog:write": true, "orders:write": false, "service:write": false, "content:write": true, "admin:read": true },
  support_agent: { "catalog:write": false, "orders:write": true, "service:write": true, "content:write": false, "admin:read": true },
  viewer: { "catalog:write": false, "orders:write": false, "service:write": false, "content:write": false, "admin:read": true },
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

test("only owner holds every permission", () => {
  const full = adminRoles.filter((role) => writePermissions.every((permission) => roleHasPermission(role, permission)));
  assert.deepEqual(full, ["owner"]);
});

test("every role can read the admin surface", () => {
  for (const role of adminRoles) assert.equal(roleHasPermission(role, "admin:read"), true);
});

test("unknown or spoofed roles hold no permissions", () => {
  for (const role of ["", "administrator", "superuser", "OWNER", "__proto__", "constructor"]) {
    for (const permission of [...writePermissions, "admin:read" as AdminPermission]) {
      assert.equal(roleHasPermission(role, permission), false, `${role || "(empty)"} must not hold ${permission}`);
    }
  }
});

test("the matrix defines exactly the five expected roles", () => {
  assert.deepEqual([...adminRoles].sort(), ["catalog_manager", "operations_manager", "owner", "support_agent", "viewer"]);
  assert.deepEqual(Object.keys(adminPermissions).sort(), ["catalog_manager", "operations_manager", "owner", "support_agent", "viewer"]);
});
