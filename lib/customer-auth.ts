import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import {
  profileSeedFromClerkUser,
  resolveAuthenticatedCustomer,
  resolveOrCreateAuthenticatedCustomer,
  type CustomerIdentityDeps,
  type CustomerIdentityStore,
} from "@/lib/customer-identity";

/**
 * Clerk + Drizzle wiring for lib/customer-identity.ts. Customer identity only -
 * this module never reads the admin session, and admin auth never reads this.
 *
 * auth() only has Clerk context where clerkMiddleware ran (the /account zone,
 * see proxy.ts); anywhere else it throws, so these helpers fail closed rather
 * than silently resolving nobody - or somebody - outside that zone.
 */

const linked = { id: customers.id, clerkUserId: customers.clerkUserId };
const asLinked = (row: { id: string; clerkUserId: string | null } | undefined) => (row?.clerkUserId ? { id: row.id, clerkUserId: row.clerkUserId } : null);

const store: CustomerIdentityStore = {
  findByClerkUserId: async (clerkUserId) => {
    const [row] = await getDb().select(linked).from(customers).where(eq(customers.clerkUserId, clerkUserId)).limit(1);
    return asLinked(row);
  },
  insertIfAbsent: async (row) => {
    // ON CONFLICT ("clerk_user_id") WHERE "clerk_user_id" IS NOT NULL DO NOTHING - the predicate
    // lets Postgres infer the partial unique index customers_clerk_user_uq.
    const [created] = await getDb()
      .insert(customers)
      .values(row)
      .onConflictDoNothing({ target: customers.clerkUserId, where: sql`${sql.identifier("clerk_user_id")} is not null` })
      .returning(linked);
    return asLinked(created);
  },
};

const deps: CustomerIdentityDeps = {
  getVerifiedClerkUserId: async () => (await auth()).userId,
  loadProfile: async () => profileSeedFromClerkUser(await currentUser()),
  store,
  newId: () => crypto.randomUUID(),
};

/** The internal customer linked to the signed-in Clerk user, or null. Never creates. */
export function getAuthenticatedCustomer() {
  return resolveAuthenticatedCustomer(deps);
}

/** The internal customer linked to the signed-in Clerk user, created race-safely on first login; null when signed out. */
export function getOrCreateAuthenticatedCustomer() {
  return resolveOrCreateAuthenticatedCustomer(deps);
}
