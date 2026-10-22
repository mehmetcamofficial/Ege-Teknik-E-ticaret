/**
 * Customer identity boundary: verified Clerk userId -> internal customers.id.
 *
 * Framework-free on purpose (no next/*, @clerk/*, or db import) so the whole
 * resolution flow can be unit tested under plain `node --test`; the real
 * Clerk + Drizzle wiring lives in lib/customer-auth.ts.
 *
 * Invariants:
 * - The only identity input is deps.getVerifiedClerkUserId(), which must come
 *   from server-verified Clerk auth. Nothing here accepts a request, body,
 *   header, customerId or email - so no client value can steer resolution.
 * - Lookup is by customers.clerk_user_id only. Email/phone never link or
 *   claim a customer: first login always creates a new internal customer,
 *   even when a guest customer with the same email already exists.
 * - First-login creation is INSERT ... ON CONFLICT DO NOTHING against the
 *   partial unique index on clerk_user_id, then a reselect when another
 *   request won the race. The database constraint is the final authority.
 * - Customer-owned resources are authorized by customers.id, never by the
 *   Clerk userId or email (see customerOwnsResource).
 */

export type AuthenticatedCustomer = { id: string; clerkUserId: string };

/** Initial profile data only - never used for identity or authorization. */
export type CustomerProfileSeed = { firstName: string; lastName: string; email: string; phone: string };

export type NewLinkedCustomer = CustomerProfileSeed & { id: string; clerkUserId: string };

export type CustomerIdentityStore = {
  findByClerkUserId: (clerkUserId: string) => Promise<AuthenticatedCustomer | null>;
  /** Must insert atomically against the clerk_user_id unique constraint and return null (not throw) when a row for that clerkUserId already exists. */
  insertIfAbsent: (row: NewLinkedCustomer) => Promise<AuthenticatedCustomer | null>;
};

export type CustomerIdentityDeps = {
  /** Returns the userId from a server-verified Clerk session, or null when signed out. */
  getVerifiedClerkUserId: () => Promise<string | null | undefined>;
  /** Server-side Clerk profile lookup; only called when a new customer must be created. */
  loadProfile: () => Promise<CustomerProfileSeed>;
  store: CustomerIdentityStore;
  newId: () => string;
};

export class CustomerIdentityError extends Error {}

// Clerk user ids are "user_" + base62. Anything else is rejected outright rather
// than being written to the database as an identity.
const CLERK_USER_ID = /^user_[A-Za-z0-9]{1,64}$/;
export function isValidClerkUserId(value: unknown): value is string {
  return typeof value === "string" && CLERK_USER_ID.test(value);
}

async function verifiedClerkUserId(deps: CustomerIdentityDeps) {
  const userId = await deps.getVerifiedClerkUserId();
  return isValidClerkUserId(userId) ? userId : null;
}

function assertLinkedTo(customer: AuthenticatedCustomer, clerkUserId: string) {
  if (customer.clerkUserId !== clerkUserId) throw new CustomerIdentityError("Customer identity mismatch.");
  return customer;
}

/** Resolves the already-linked customer for the verified Clerk session. Never creates one. */
export async function resolveAuthenticatedCustomer(deps: CustomerIdentityDeps): Promise<AuthenticatedCustomer | null> {
  const clerkUserId = await verifiedClerkUserId(deps);
  if (!clerkUserId) return null;
  const customer = await deps.store.findByClerkUserId(clerkUserId);
  return customer ? assertLinkedTo(customer, clerkUserId) : null;
}

/** Resolves the linked customer for the verified Clerk session, creating it race-safely on first login. */
export async function resolveOrCreateAuthenticatedCustomer(deps: CustomerIdentityDeps): Promise<AuthenticatedCustomer | null> {
  const clerkUserId = await verifiedClerkUserId(deps);
  if (!clerkUserId) return null;
  const existing = await deps.store.findByClerkUserId(clerkUserId);
  if (existing) return assertLinkedTo(existing, clerkUserId);

  const profile = await deps.loadProfile();
  const created = await deps.store.insertIfAbsent({ ...profile, id: deps.newId(), clerkUserId });
  if (created) return assertLinkedTo(created, clerkUserId);

  // A concurrent request linked this Clerk user first; the unique index kept it to one row.
  const winner = await deps.store.findByClerkUserId(clerkUserId);
  if (!winner) throw new CustomerIdentityError("Customer identity could not be resolved.");
  return assertLinkedTo(winner, clerkUserId);
}

/**
 * The ownership rule for every future customer-owned resource: the resource's
 * customer_id must equal the resolved internal customer id. A guest order's
 * customer_id points at its own guest customer, never a clerk-linked one, so
 * it can never equal an authenticated customer's id and stays unclaimable.
 * A resource with no owner at all (customerId: null) is likewise unclaimable.
 */
export function customerOwnsResource(customer: AuthenticatedCustomer | null, resource: { customerId: string | null }) {
  return !!customer && resource.customerId !== null && resource.customerId === customer.id;
}

const clip = (value: string | null | undefined, max: number) => (value ?? "").trim().slice(0, max);

type ClerkContact = { emailAddress?: string; phoneNumber?: string; verification: { status: string } | null } | null;
export type ClerkProfileSource = {
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: ClerkContact;
} | null;

/**
 * Minimal profile copied from the server-side Clerk user: names plus the
 * primary email only when Clerk reports it verified. No tokens, external
 * account data or phone are copied; missing values stay empty rather than
 * being invented.
 */
export function profileSeedFromClerkUser(user: ClerkProfileSource): CustomerProfileSeed {
  const email = user?.primaryEmailAddress;
  return {
    firstName: clip(user?.firstName, 100),
    lastName: clip(user?.lastName, 100),
    email: email?.verification?.status === "verified" ? clip(email.emailAddress, 150) : "",
    phone: "",
  };
}
