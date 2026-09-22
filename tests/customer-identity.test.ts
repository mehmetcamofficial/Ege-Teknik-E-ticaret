import assert from "node:assert/strict";
import test from "node:test";
import {
  CustomerIdentityError,
  customerOwnsResource,
  isValidClerkUserId,
  profileSeedFromClerkUser,
  resolveAuthenticatedCustomer,
  resolveOrCreateAuthenticatedCustomer,
  type CustomerIdentityDeps,
  type CustomerIdentityStore,
  type NewLinkedCustomer,
} from "../lib/customer-identity.ts";

type Row = NewLinkedCustomer | (Omit<NewLinkedCustomer, "clerkUserId"> & { clerkUserId: string | null });

/**
 * In-memory stand-in for the customers table that enforces the same rule as
 * customers_clerk_user_uq: clerk_user_id is unique among non-null values, and
 * any number of guest rows may have it null. insertIfAbsent is atomic (no
 * await between the check and the push), like INSERT ... ON CONFLICT DO NOTHING.
 */
function makeStore(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  const calls = { find: 0, insert: 0 };
  const store: CustomerIdentityStore = {
    findByClerkUserId: async (clerkUserId) => {
      calls.find++;
      const row = rows.find((r) => r.clerkUserId === clerkUserId);
      return row ? { id: row.id, clerkUserId: row.clerkUserId! } : null;
    },
    insertIfAbsent: async (row) => {
      calls.insert++;
      if (rows.some((r) => r.clerkUserId !== null && r.clerkUserId === row.clerkUserId)) return null;
      rows.push(row);
      return { id: row.id, clerkUserId: row.clerkUserId };
    },
  };
  return { store, rows, calls };
}

const PROFILE = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "" };
let idCounter = 0;
function makeDeps(clerkUserId: string | null | undefined, store: CustomerIdentityStore, overrides: Partial<CustomerIdentityDeps> = {}): CustomerIdentityDeps {
  return { getVerifiedClerkUserId: async () => clerkUserId, loadProfile: async () => PROFILE, store, newId: () => `cust-${++idCounter}`, ...overrides };
}

const GUEST = { id: "guest-1", clerkUserId: null, firstName: "Ada", lastName: "Lovelace", phone: "05001112233", email: "ada@example.test" };

// 1. unauthenticated identity resolution is rejected
test("no verified Clerk session resolves no customer and touches nothing", async () => {
  for (const userId of [null, undefined, ""]) {
    const { store, rows, calls } = makeStore([GUEST]);
    let profileLoaded = false;
    const deps = makeDeps(userId, store, { loadProfile: async () => { profileLoaded = true; return PROFILE; } });
    assert.equal(await resolveOrCreateAuthenticatedCustomer(deps), null);
    assert.equal(await resolveAuthenticatedCustomer(deps), null);
    assert.deepEqual(calls, { find: 0, insert: 0 });
    assert.equal(profileLoaded, false);
    assert.equal(rows.length, 1);
  }
});

test("a malformed Clerk user id is never trusted or persisted", async () => {
  for (const userId of ["admin-1", "user_", "user_abc'; drop table customers;--", "USER_abc", " user_abc", `user_${"a".repeat(65)}`]) {
    const { store, rows } = makeStore();
    assert.equal(await resolveOrCreateAuthenticatedCustomer(makeDeps(userId, store)), null, userId);
    assert.equal(rows.length, 0);
  }
  assert.equal(isValidClerkUserId("user_2abcDEF123"), true);
  assert.equal(isValidClerkUserId(42), false);
});

// 2. verified Clerk user resolves an already-linked customer
test("a verified Clerk user resolves the customer already linked to it", async () => {
  const { store, calls } = makeStore([GUEST, { ...PROFILE, id: "cust-linked", clerkUserId: "user_alice" }]);
  let profileLoaded = false;
  const deps = makeDeps("user_alice", store, { loadProfile: async () => { profileLoaded = true; return PROFILE; } });
  assert.deepEqual(await resolveAuthenticatedCustomer(deps), { id: "cust-linked", clerkUserId: "user_alice" });
  assert.deepEqual(await resolveOrCreateAuthenticatedCustomer(deps), { id: "cust-linked", clerkUserId: "user_alice" });
  assert.equal(calls.insert, 0);
  assert.equal(profileLoaded, false, "an existing link must not re-read or re-copy the Clerk profile");
});

test("the read-only resolver never creates a customer", async () => {
  const { store, rows } = makeStore();
  assert.equal(await resolveAuthenticatedCustomer(makeDeps("user_new", store)), null);
  assert.equal(rows.length, 0);
});

// 3. first authenticated login creates an internal customer
test("first login creates one internal customer linked to the Clerk user", async () => {
  const { store, rows } = makeStore();
  const customer = await resolveOrCreateAuthenticatedCustomer(makeDeps("user_bob", store, { newId: () => "cust-bob" }));
  assert.deepEqual(customer, { id: "cust-bob", clerkUserId: "user_bob" });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { ...PROFILE, id: "cust-bob", clerkUserId: "user_bob" });
});

// 4. repeated login resolves the same internal customer
test("repeated logins resolve the same internal customer", async () => {
  const { store, rows } = makeStore();
  const first = await resolveOrCreateAuthenticatedCustomer(makeDeps("user_carol", store));
  const second = await resolveOrCreateAuthenticatedCustomer(makeDeps("user_carol", store));
  const third = await resolveAuthenticatedCustomer(makeDeps("user_carol", store));
  assert.ok(first);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(rows.length, 1);
});

// 5. concurrent first-login attempts cannot produce duplicate authenticated identities
test("concurrent first logins that both miss the lookup still produce exactly one customer", async () => {
  const { store, rows, calls } = makeStore();
  // Hold every caller's first lookup until all of them have observed "no customer",
  // forcing the worst-case interleaving: N inserts racing for the same Clerk user.
  const racers = 5;
  let waiting = 0;
  let release!: () => void;
  const allMissed = new Promise<void>((resolve) => (release = resolve));
  const racingStore: CustomerIdentityStore = {
    ...store,
    findByClerkUserId: async (clerkUserId) => {
      const result = await store.findByClerkUserId(clerkUserId);
      if (result === null && waiting < racers) {
        if (++waiting === racers) release();
        await allMissed;
      }
      return result;
    },
  };
  const results = await Promise.all(Array.from({ length: racers }, () => resolveOrCreateAuthenticatedCustomer(makeDeps("user_dave", racingStore))));
  assert.equal(rows.length, 1, "exactly one customer row for the Clerk user");
  assert.equal(calls.insert, racers, "every racer really attempted the insert");
  for (const result of results) assert.deepEqual(result, { id: rows[0].id, clerkUserId: "user_dave" });
});

test("a lost insert race with no winning row fails closed instead of returning nobody's customer", async () => {
  const store: CustomerIdentityStore = { findByClerkUserId: async () => null, insertIfAbsent: async () => null };
  await assert.rejects(resolveOrCreateAuthenticatedCustomer(makeDeps("user_erin", store)), CustomerIdentityError);
});

test("a store row linked to a different Clerk user is rejected, not returned", async () => {
  const store: CustomerIdentityStore = {
    findByClerkUserId: async () => ({ id: "cust-other", clerkUserId: "user_other" }),
    insertIfAbsent: async () => null,
  };
  await assert.rejects(resolveAuthenticatedCustomer(makeDeps("user_frank", store)), CustomerIdentityError);
  await assert.rejects(resolveOrCreateAuthenticatedCustomer(makeDeps("user_frank", store)), CustomerIdentityError);
});

// 6. client-provided customerId cannot override authenticated identity
test("identity comes only from the verified Clerk user id, never from a caller-supplied value", async () => {
  const { store } = makeStore([
    { ...PROFILE, id: "cust-alice", clerkUserId: "user_alice" },
    { ...PROFILE, id: "cust-victim", clerkUserId: "user_victim" },
  ]);
  // The resolvers take no request/customerId/email parameter at all; extra arguments are ignored.
  const resolve = resolveOrCreateAuthenticatedCustomer as (...args: unknown[]) => ReturnType<typeof resolveOrCreateAuthenticatedCustomer>;
  const customer = await resolve(makeDeps("user_alice", store), { customerId: "cust-victim", clerkUserId: "user_victim", email: "victim@example.test" });
  assert.deepEqual(customer, { id: "cust-alice", clerkUserId: "user_alice" });
  assert.equal(resolveOrCreateAuthenticatedCustomer.length, 1);
  assert.equal(resolveAuthenticatedCustomer.length, 1);
});

test("resource ownership is decided by internal customer id only (IDOR/BOLA rule)", () => {
  const alice = { id: "cust-alice", clerkUserId: "user_alice" };
  assert.equal(customerOwnsResource(alice, { customerId: "cust-alice" }), true);
  // A request claiming another customer's id, or any id, does not change who alice is.
  assert.equal(customerOwnsResource(alice, { customerId: "cust-victim" }), false);
  // The Clerk user id is not a customer id.
  assert.equal(customerOwnsResource(alice, { customerId: "user_alice" }), false);
  // Guest resources (no owner) are never claimable, and nobody owns anything when signed out.
  assert.equal(customerOwnsResource(alice, { customerId: null }), false);
  assert.equal(customerOwnsResource(null, { customerId: "cust-alice" }), false);
  assert.equal(customerOwnsResource(null, { customerId: null }), false);
});

// 7. email matching alone cannot claim an existing guest customer
test("first login with an email matching a guest customer creates a new customer and leaves the guest untouched", async () => {
  const { store, rows } = makeStore([{ ...GUEST }]);
  const customer = await resolveOrCreateAuthenticatedCustomer(makeDeps("user_ada", store, { newId: () => "cust-ada" }));
  assert.deepEqual(customer, { id: "cust-ada", clerkUserId: "user_ada" });
  assert.notEqual(customer!.id, GUEST.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], GUEST, "the guest row must not be linked or modified");
  assert.equal(customerOwnsResource(customer, { customerId: GUEST.id }), false, "guest resources stay unclaimed");
});

test("multiple guest customers sharing an email all stay unlinked", async () => {
  const guests = [{ ...GUEST, id: "guest-a" }, { ...GUEST, id: "guest-b" }];
  const { store, rows } = makeStore(guests.map((g) => ({ ...g })));
  await resolveOrCreateAuthenticatedCustomer(makeDeps("user_ada", store));
  assert.deepEqual(rows.slice(0, 2), guests);
  assert.equal(rows.filter((r) => r.clerkUserId === "user_ada").length, 1);
});

// 8. uniqueness prevents duplicate Clerk identity linkage
test("a second customer can never be linked to an already-linked Clerk user", async () => {
  const { store, rows } = makeStore([{ ...PROFILE, id: "cust-1", clerkUserId: "user_gina" }]);
  assert.equal(await store.insertIfAbsent({ ...PROFILE, id: "cust-2", clerkUserId: "user_gina" }), null);
  assert.equal(rows.filter((r) => r.clerkUserId === "user_gina").length, 1);
});

test("different Clerk users with the same email get different customers", async () => {
  const { store, rows } = makeStore();
  const a = await resolveOrCreateAuthenticatedCustomer(makeDeps("user_one", store));
  const b = await resolveOrCreateAuthenticatedCustomer(makeDeps("user_two", store));
  assert.notEqual(a!.id, b!.id);
  assert.equal(rows.length, 2);
});

test("the Clerk profile seed copies only names and a verified primary email", () => {
  const verified = { emailAddress: " ada@example.test ", verification: { status: "verified" } };
  assert.deepEqual(profileSeedFromClerkUser({ firstName: " Ada ", lastName: "Lovelace", primaryEmailAddress: verified }), { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: "" });
  const unverified = { emailAddress: "ada@example.test", verification: { status: "unverified" } };
  assert.equal(profileSeedFromClerkUser({ firstName: "Ada", lastName: null, primaryEmailAddress: unverified }).email, "");
  assert.equal(profileSeedFromClerkUser({ firstName: "Ada", lastName: null, primaryEmailAddress: { emailAddress: "x@y.test", verification: null } }).email, "");
  assert.deepEqual(profileSeedFromClerkUser(null), { firstName: "", lastName: "", email: "", phone: "" });
  // Extra Clerk fields (tokens, external accounts, metadata) never reach the seed.
  const seed = profileSeedFromClerkUser({ firstName: "A", lastName: "B", primaryEmailAddress: verified, externalAccounts: [{ token: "secret" }], privateMetadata: { x: 1 } } as never);
  assert.deepEqual(Object.keys(seed).sort(), ["email", "firstName", "lastName", "phone"]);
  assert.equal(profileSeedFromClerkUser({ firstName: "x".repeat(500), lastName: null, primaryEmailAddress: null }).firstName.length, 100);
});
