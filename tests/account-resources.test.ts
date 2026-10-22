import assert from "node:assert/strict";
import test from "node:test";
import {
  addressType,
  createAddress,
  deleteAddress,
  getAddress,
  getOrder,
  listAddresses,
  listOrders,
  updateAddress,
  updateProfile,
  type AddressStore,
  type CustomerAddress,
  type OrderDetail,
  type OrderStore,
  type ProfileStore,
} from "../lib/account-resources.ts";

const ALICE = { id: "cust-alice", clerkUserId: "user_alice" };
const BOB = { id: "cust-bob", clerkUserId: "user_bob" };

const ADDRESS_INPUT = { title: "Ev", recipientName: "Alice Wonderland", phone: "05001112233", city: "İzmir", district: "Karşıyaka", postalCode: "35600", line1: "Örnek Mahallesi No:1", line2: "", billing: false };

/**
 * In-memory stand-in for the addresses table that enforces the exact same
 * atomic contract lib/account-resources-db.ts must implement in real SQL:
 * every read/write matches id AND customer_id in one step, so ownership can
 * never be checked separately from the mutation it guards.
 */
function makeAddressStore(seed: CustomerAddress[] = []) {
  const rows: CustomerAddress[] = [...seed];
  const store: AddressStore = {
    listOwnedAddresses: async (customerId) => rows.filter((r) => r.customerId === customerId),
    createOwnedAddress: async (customerId, input, id) => {
      const row: CustomerAddress = { ...input, id, customerId, type: addressType(input) };
      rows.push(row);
      return row;
    },
    getOwnedAddress: async (customerId, addressId) => rows.find((r) => r.id === addressId && r.customerId === customerId) ?? null,
    updateOwnedAddress: async (customerId, addressId, input) => {
      const index = rows.findIndex((r) => r.id === addressId && r.customerId === customerId);
      if (index === -1) return null;
      rows[index] = { ...rows[index], ...input, type: addressType(input) };
      return rows[index];
    },
    deleteOwnedAddress: async (customerId, addressId) => {
      const index = rows.findIndex((r) => r.id === addressId && r.customerId === customerId);
      if (index === -1) return false;
      rows.splice(index, 1);
      return true;
    },
  };
  return { store, rows };
}

// 1. addresses: create always scopes to the resolved customer, never a client value
test("creating an address always attaches the authenticated customer, never a client-supplied one", async () => {
  const { store, rows } = makeAddressStore();
  const result = await createAddress(ALICE, { ...ADDRESS_INPUT, customerId: "cust-victim" } as unknown, "addr-1", store);
  assert.equal(result.ok, true);
  assert.equal(rows[0].customerId, "cust-alice");
  assert.equal(rows[0].type, "shipping");
});

test("billing:true derives type 'billing' consistently", async () => {
  const { store, rows } = makeAddressStore();
  await createAddress(ALICE, { ...ADDRESS_INPUT, billing: true }, "addr-1", store);
  assert.equal(rows[0].type, "billing");
});

test("a malformed or invalid address is rejected without being stored", async () => {
  const { store, rows } = makeAddressStore();
  const result = await createAddress(ALICE, { ...ADDRESS_INPUT, recipientName: "" }, "addr-1", store);
  assert.equal(result.ok, false);
  assert.equal(rows.length, 0);
});

// 2. IDOR: customer A cannot read, update or delete customer B's address
test("customer A cannot read customer B's address by id (IDOR)", async () => {
  const { store } = makeAddressStore([{ ...ADDRESS_INPUT, id: "addr-bob", customerId: BOB.id, type: "shipping" }]);
  assert.equal(await getAddress(ALICE, "addr-bob", store), null);
  assert.deepEqual(await getAddress(BOB, "addr-bob", store), { ...ADDRESS_INPUT, id: "addr-bob", customerId: BOB.id, type: "shipping" });
});

test("customer A cannot update customer B's address by id (IDOR)", async () => {
  const { store, rows } = makeAddressStore([{ ...ADDRESS_INPUT, id: "addr-bob", customerId: BOB.id, type: "shipping" }]);
  const result = await updateAddress(ALICE, "addr-bob", { ...ADDRESS_INPUT, city: "Hacked" }, store);
  assert.equal(result.ok, false);
  assert.equal(rows[0].city, "İzmir", "Bob's address must be unchanged");
});

test("customer A cannot delete customer B's address by id (IDOR)", async () => {
  const { store, rows } = makeAddressStore([{ ...ADDRESS_INPUT, id: "addr-bob", customerId: BOB.id, type: "shipping" }]);
  const result = await deleteAddress(ALICE, "addr-bob", store);
  assert.equal(result.ok, false);
  assert.equal(rows.length, 1, "Bob's address must not be deleted");
});

test("a customer can list, update and delete only their own addresses", async () => {
  const { store, rows } = makeAddressStore([
    { ...ADDRESS_INPUT, id: "addr-alice", customerId: ALICE.id, type: "shipping" },
    { ...ADDRESS_INPUT, id: "addr-bob", customerId: BOB.id, type: "shipping" },
  ]);
  const listed = await listAddresses(ALICE, store);
  assert.deepEqual(listed.map((a) => a.id), ["addr-alice"]);

  const updated = await updateAddress(ALICE, "addr-alice", { ...ADDRESS_INPUT, city: "Ankara" }, store);
  assert.equal(updated.ok, true);
  assert.equal(rows.find((r) => r.id === "addr-alice")!.city, "Ankara");

  const deleted = await deleteAddress(ALICE, "addr-alice", store);
  assert.equal(deleted.ok, true);
  assert.equal(rows.some((r) => r.id === "addr-alice"), false);
  assert.equal(rows.some((r) => r.id === "addr-bob"), true, "Bob's address survives Alice's own deletion");
});

// 3. malformed resource ids fail safely, never throw, never crash
test("malformed, empty or absurdly long address ids resolve to nothing instead of throwing", async () => {
  const { store } = makeAddressStore([{ ...ADDRESS_INPUT, id: "addr-alice", customerId: ALICE.id, type: "shipping" }]);
  for (const badId of ["", "a".repeat(500), "' OR '1'='1", "../../etc/passwd", "\u0000"]) {
    assert.equal(await getAddress(ALICE, badId, store), null, badId);
    const updateResult = await updateAddress(ALICE, badId, ADDRESS_INPUT, store);
    assert.equal(updateResult.ok, false, badId);
    const deleteResult = await deleteAddress(ALICE, badId, store);
    assert.equal(deleteResult.ok, false, badId);
  }
});

// 4. profile: ownership-scoped, and the schema itself cannot carry email/clerkUserId
test("profile update is scoped to the authenticated customer and cannot change email or clerkUserId", async () => {
  const calls: { customerId: string; patch: unknown }[] = [];
  const store: ProfileStore = {
    getOwnedProfile: async () => { throw new Error("must not be called"); },
    updateOwnedProfile: async (customerId, patch) => {
      calls.push({ customerId, patch });
      return { id: customerId, firstName: patch.firstName, lastName: patch.lastName, phone: patch.phone, email: "unchanged@example.test" };
    },
  };
  const result = await updateProfile(ALICE, { firstName: "Alice", lastName: "Wonderland", phone: "05001112233", email: "attacker@evil.test", clerkUserId: "user_bob" } as unknown, store);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].customerId, "cust-alice");
  assert.deepEqual(Object.keys(calls[0].patch as object).sort(), ["firstName", "lastName", "phone"], "email/clerkUserId must never reach the store's patch");
});

test("an empty or oversized profile field is rejected", async () => {
  const store: ProfileStore = { getOwnedProfile: async () => { throw new Error("must not be called"); }, updateOwnedProfile: async () => { throw new Error("must not be called"); } };
  const result = await updateProfile(ALICE, { firstName: "", lastName: "Wonderland", phone: "05001112233" }, store);
  assert.equal(result.ok, false);
});

// 5. orders: read-only, scoped, never by email/phone/order-number alone
function makeOrderStore(seed: (OrderDetail & { customerId: string })[] = []) {
  const orderStore: OrderStore = {
    listOwnedOrders: async (customerId) => seed.filter((o) => o.customerId === customerId).map(({ id, orderNumber, status, total, currency, createdAt }) => ({ id, orderNumber, status, total, currency, createdAt })),
    getOwnedOrder: async (customerId, orderId) => {
      const found = seed.find((o) => o.id === orderId && o.customerId === customerId);
      if (!found) return null;
      const detail: OrderDetail = { ...found };
      return detail;
    },
  };
  return orderStore;
}

const ORDER_BASE = { orderNumber: "ETS-20260101-AAAAAA", status: "paid", total: 10000, currency: "TRY", createdAt: new Date("2026-01-01"), subtotal: 8333, vatTotal: 1667, shippingTotal: 0, paymentStatus: "paid", shippingAddressSnapshot: {}, billingAddressSnapshot: {}, items: [] };

test("customer A cannot read customer B's order by id, even knowing the order id (IDOR)", async () => {
  const store = makeOrderStore([{ ...ORDER_BASE, id: "order-bob", customerId: BOB.id }]);
  assert.equal(await getOrder(ALICE, "order-bob", store), null);
  assert.ok(await getOrder(BOB, "order-bob", store));
});

test("a customer's order list never includes another customer's orders", async () => {
  const store = makeOrderStore([{ ...ORDER_BASE, id: "order-alice", customerId: ALICE.id }, { ...ORDER_BASE, id: "order-bob", customerId: BOB.id }]);
  const listed = await listOrders(ALICE, store);
  assert.deepEqual(listed.map((o) => o.id), ["order-alice"]);
});

test("a guest order (no owning customer) is never returned to any authenticated customer", async () => {
  // Guest orders have their own guest customer id, never the authenticated customer's - simulate by
  // simply never seeding a row for ALICE/BOB, matching how a guest order can never match either.
  const store = makeOrderStore([{ ...ORDER_BASE, id: "order-guest", customerId: "guest-1" }]);
  assert.equal(await getOrder(ALICE, "order-guest", store), null);
  assert.equal(await getOrder(BOB, "order-guest", store), null);
  assert.deepEqual(await listOrders(ALICE, store), []);
});

test("malformed order ids resolve to nothing instead of throwing", async () => {
  const store = makeOrderStore([{ ...ORDER_BASE, id: "order-alice", customerId: ALICE.id }]);
  for (const badId of ["", "a".repeat(500), "' OR '1'='1"]) assert.equal(await getOrder(ALICE, badId, store), null, badId);
});
