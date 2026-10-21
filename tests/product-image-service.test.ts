import assert from "node:assert/strict";
import test from "node:test";
import { uploadProductImage, type ProductImageDeps } from "../lib/product-image-service.ts";

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const ACTOR = { userId: "admin-1", email: "owner@egeteknik.test" };
const PRODUCT = { id: "prod-1", sku: "GWH09ALAXB-K6DNA2B", slug: "aphro-9000" };
const VALID_INPUT = { productId: PRODUCT.id, declaredMimeType: "image/jpeg", size: JPEG_BYTES.length, bytes: JPEG_BYTES };

type Call = { fn: string; args: unknown[] };

function makeDeps(overrides: Partial<ProductImageDeps> = {}) {
  const calls: Call[] = [];
  const deps: ProductImageDeps = {
    getAdmin: async () => ACTOR,
    findProduct: async (id) => (id === PRODUCT.id ? PRODUCT : null),
    updateProductImage: async (id, url) => {
      calls.push({ fn: "updateProductImage", args: [id, url] });
      return [{ id }];
    },
    insertAuditLog: async (entry) => {
      calls.push({ fn: "insertAuditLog", args: [entry] });
    },
    blobPut: async (pathname) => {
      calls.push({ fn: "blobPut", args: [pathname] });
      return { url: `https://ege-teknik-product-images.public.blob.vercel-storage.com/${pathname}` };
    },
    blobDelete: async (url) => {
      calls.push({ fn: "blobDelete", args: [url] });
    },
    ...overrides,
  };
  return { deps, calls };
}

test("no session is rejected with 403 and no side effects", async () => {
  const { deps, calls } = makeDeps({ getAdmin: async () => null });
  const outcome = await uploadProductImage(deps, VALID_INPUT);
  assert.equal(outcome.status, 403);
  assert.deepEqual(calls, []);
});

test("a role without catalog:write is rejected with 403 (getAdminUser already enforces the permission)", async () => {
  // getAdminUser(required) returns null itself when the session's role lacks the permission,
  // so from this orchestrator's point of view it is indistinguishable from "no session".
  const { deps, calls } = makeDeps({ getAdmin: async () => null });
  const outcome = await uploadProductImage(deps, VALID_INPUT);
  assert.equal(outcome.status, 403);
  assert.deepEqual(calls, []);
});

test("catalog_manager (or any permitted role) is allowed through", async () => {
  const { deps } = makeDeps();
  const outcome = await uploadProductImage(deps, VALID_INPUT);
  assert.equal(outcome.status, 200);
});

test("a nonexistent product is rejected with 404 before any upload is attempted", async () => {
  const { deps, calls } = makeDeps({ findProduct: async () => null });
  const outcome = await uploadProductImage(deps, VALID_INPUT);
  assert.equal(outcome.status, 404);
  assert.deepEqual(calls, []);
});

test("an empty/missing file is rejected with 400 before any upload is attempted", async () => {
  const { deps, calls } = makeDeps();
  const outcome = await uploadProductImage(deps, { ...VALID_INPUT, size: 0, bytes: new Uint8Array() });
  assert.equal(outcome.status, 400);
  assert.deepEqual(calls, []);
});

test("an invalid MIME type is rejected with 400", async () => {
  const { deps, calls } = makeDeps();
  const outcome = await uploadProductImage(deps, { ...VALID_INPUT, declaredMimeType: "image/gif" });
  assert.equal(outcome.status, 400);
  assert.deepEqual(calls, []);
});

test("a MIME/signature mismatch is rejected with 400", async () => {
  const { deps, calls } = makeDeps();
  const outcome = await uploadProductImage(deps, { ...VALID_INPUT, declaredMimeType: "image/png" });
  assert.equal(outcome.status, 400);
  assert.deepEqual(calls, []);
});

test("SVG is rejected with 400", async () => {
  const { deps, calls } = makeDeps();
  const svg = new TextEncoder().encode("<svg></svg>");
  const outcome = await uploadProductImage(deps, { ...VALID_INPUT, declaredMimeType: "image/svg+xml", size: svg.length, bytes: svg });
  assert.equal(outcome.status, 400);
  assert.deepEqual(calls, []);
});

test("a file over 4 MB is rejected with 400", async () => {
  const { deps, calls } = makeDeps();
  const outcome = await uploadProductImage(deps, { ...VALID_INPUT, size: 4 * 1024 * 1024 + 1 });
  assert.equal(outcome.status, 400);
  assert.deepEqual(calls, []);
});

test("a Blob upload failure results in no DB update and no audit log", async () => {
  const { deps, calls } = makeDeps({ blobPut: async () => { throw new Error("store unavailable"); } });
  const outcome = await uploadProductImage(deps, VALID_INPUT);
  assert.equal(outcome.status, 502);
  assert.deepEqual(calls.map((c) => c.fn), []);
});

test("a DB failure after a successful Blob upload attempts to delete the newly created Blob", async () => {
  const { deps, calls } = makeDeps({
    updateProductImage: async () => { throw new Error("connection reset"); },
  });
  const outcome = await uploadProductImage(deps, VALID_INPUT);
  assert.equal(outcome.status, 500);
  assert.deepEqual(calls.map((c) => c.fn), ["blobPut", "blobDelete"]);
});

test("zero rows updated (product vanished mid-flight) is treated as a DB failure and cleans up the Blob", async () => {
  const { deps, calls } = makeDeps({ updateProductImage: async () => [] });
  const outcome = await uploadProductImage(deps, VALID_INPUT);
  assert.equal(outcome.status, 500);
  assert.deepEqual(calls.map((c) => c.fn), ["blobPut", "blobDelete"]);
});

test("a Blob delete failure during cleanup is swallowed (best-effort) and the DB-failure status still returns", async () => {
  const { deps } = makeDeps({
    updateProductImage: async () => { throw new Error("connection reset"); },
    blobDelete: async () => { throw new Error("delete also failed"); },
  });
  const outcome = await uploadProductImage(deps, VALID_INPUT);
  assert.equal(outcome.status, 500);
});

test("a successful upload updates exactly one product, writes one audit event, and returns the resulting imageUrl", async () => {
  const { deps, calls } = makeDeps();
  const outcome = await uploadProductImage(deps, VALID_INPUT);
  assert.equal(outcome.status, 200);
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  assert.equal(outcome.imageUrl, `https://ege-teknik-product-images.public.blob.vercel-storage.com/products/${PRODUCT.sku}/primary.jpg`);
  assert.equal(outcome.auditLogged, true);
  const updateCalls = calls.filter((c) => c.fn === "updateProductImage");
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].args[0], PRODUCT.id);
  const auditCalls = calls.filter((c) => c.fn === "insertAuditLog");
  assert.equal(auditCalls.length, 1);
});

test("the deterministic object key is used verbatim for the Blob upload (SKU takes priority)", async () => {
  const { deps, calls } = makeDeps();
  await uploadProductImage(deps, VALID_INPUT);
  const putCalls = calls.filter((c) => c.fn === "blobPut");
  assert.equal(putCalls[0].args[0], `products/${PRODUCT.sku}/primary.jpg`);
});

test("an audit-log failure after a successful DB update does not report a silent full success", async () => {
  const { deps } = makeDeps({ insertAuditLog: async () => { throw new Error("audit table unavailable"); } });
  const outcome = await uploadProductImage(deps, VALID_INPUT);
  assert.equal(outcome.status, 200);
  assert.ok(outcome.ok);
  if (!outcome.ok) return;
  // The product mutation itself succeeded (must not be resubmitted), but the response
  // explicitly flags that the audit trail is incomplete instead of hiding it.
  assert.equal(outcome.auditLogged, false);
});

test("an existing previous image is never deleted by this flow", async () => {
  const { deps, calls } = makeDeps();
  await uploadProductImage(deps, VALID_INPUT);
  assert.equal(calls.filter((c) => c.fn === "blobDelete").length, 0);
});
