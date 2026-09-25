import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (f: string) => readFileSync(f, "utf8");

test("Taxonomy DELETE endpoint verifies products FK dependencies before deleting", () => {
  const code = read("app/api/admin/taxonomy/route.ts");
  assert.match(code, /products\.brandId/);
  assert.match(code, /products\.categoryId/);
  assert.match(code, /status:\s*409/);
  assert.match(code, /getAdminUser\("catalog:write"\)/);
  assert.match(code, /action:\s*"delete"/);
});

test("Second-hand DELETE endpoint checks reservations before hard delete", () => {
  const code = read("app/api/admin/second-hand/[id]/route.ts");
  assert.match(code, /secondHandReservations\.productId/);
  assert.match(code, /status:\s*409/);
  assert.match(code, /url\.searchParams\.get\("hard"\)/);
  assert.match(code, /action:\s*"delete"/);
  assert.match(code, /action:\s*"archive"/);
  assert.match(code, /getAdminUser\("catalog:write"\)/);
});

test("Blog DELETE endpoint supports both archive and hard delete", () => {
  const code = read("app/api/admin/blog/[id]/route.ts");
  assert.match(code, /url\.searchParams\.get\("hard"\)/);
  assert.match(code, /action:\s*"delete"/);
  assert.match(code, /action:\s*"archive"/);
  assert.match(code, /getAdminUser\("content:write"\)/);
});

test("Orders endpoint disallows hard delete and enforces state machine", () => {
  const code = read("app/api/admin/orders/[id]/route.ts");
  assert.doesNotMatch(code, /export async function DELETE/);
  assert.match(code, /canTransitionOrder/);
  assert.match(code, /status:\s*409/);
});

test("Products endpoint preserves FK integrity by soft-archiving instead of hard-deleting", () => {
  const code = read("app/api/admin/products/[id]/route.ts");
  assert.match(code, /action:\s*"archive"/);
  assert.match(code, /status:\s*"draft"/);
  assert.match(code, /saleMode:\s*"out_of_stock"/);
  assert.doesNotMatch(code, /db\.delete\(products\)/);
});

test("Admin panel layout includes Sonner toaster and ConfirmDialog exists", () => {
  const layout = read("app/admin/(panel)/layout.tsx");
  assert.match(layout, /<Toaster/);
  const confirmDialog = read("components/admin/confirm-dialog.tsx");
  assert.match(confirmDialog, /AlertDialog/);
});
