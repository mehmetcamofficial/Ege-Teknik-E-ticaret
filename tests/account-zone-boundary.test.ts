import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { adminPermissions, adminRoles } from "../lib/security-policy.ts";

/**
 * These are static/structural checks, not behavioral ones: the actual Clerk
 * sign-in flow and admin cookie flow both need a running Next.js server to
 * exercise end to end, which this project's plain `node --test` suite
 * deliberately never does for next/server-dependent code (see
 * tests/admin-auth.test.ts, which likewise never imports lib/admin-auth.ts
 * directly - only the framework-free pieces it's built from). What's
 * checked here is the architectural invariant that actually enforces the
 * security boundary: no admin file imports Clerk, and no admin role is a
 * customer-identity concept.
 */

const ADMIN_FILES = [
  "lib/admin-auth.ts",
  "lib/security-policy.ts",
  "app/api/admin/products/route.ts",
  "app/api/admin/products/[id]/route.ts",
  "app/api/admin/products/[id]/image/route.ts",
  "app/api/admin/orders/[id]/route.ts",
];

function listFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? listFilesRecursive(full) : [full];
  });
}

// 5. A Clerk customer session must never be able to satisfy admin authorization.
// The strongest static proof available without a live server: nothing under the
// admin surface even references @clerk/*, so there is no code path where a Clerk
// session object could be read, let alone accepted, by admin auth.
test("no file under app/admin or app/api/admin imports @clerk/*", () => {
  const files = [...listFilesRecursive("app/admin"), ...listFilesRecursive("app/api/admin")];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(/@clerk\//.test(source), false, `${file} must not import @clerk/*`);
  }
});

for (const file of ADMIN_FILES) {
  test(`${file} does not import @clerk/*`, () => {
    const source = readFileSync(file, "utf8");
    assert.equal(/@clerk\//.test(source), false);
  });
}

// The admin role/permission model (already exercised behaviorally in
// tests/rbac.test.ts) has no customer-identity concept for a Clerk session to
// accidentally map onto.
test("admin roles contain no customer/Clerk-shaped role", () => {
  for (const role of adminRoles) {
    assert.equal(/clerk|customer/i.test(role), false, `unexpected role shape: ${role}`);
  }
  assert.deepEqual(new Set(Object.keys(adminPermissions)), new Set(adminRoles));
});

// 1. /account must actually enforce auth before rendering anything, via Clerk's own
// resource-based auth.protect() (the current recommended pattern - see proxy.ts).
test("app/account/layout.tsx calls auth.protect() before rendering children", () => {
  const source = readFileSync("app/account/layout.tsx", "utf8");
  assert.match(source, /auth\.protect\(\)/);
  const protectIndex = source.indexOf("auth.protect()");
  const childrenIndex = source.indexOf("{children}");
  assert.ok(protectIndex >= 0 && childrenIndex >= 0 && protectIndex < childrenIndex, "auth.protect() must run before children render");
});

// ClerkProvider must be scoped to the account zone only - never the root layout,
// which is also shared by /admin.
test("ClerkProvider is not used in the root layout", () => {
  const source = readFileSync("app/layout.tsx", "utf8");
  assert.equal(/ClerkProvider/.test(source), false);
});

test("ClerkProvider wraps only the account zone's own layout", () => {
  const source = readFileSync("app/account/layout.tsx", "utf8");
  assert.match(source, /ClerkProvider/);
});
