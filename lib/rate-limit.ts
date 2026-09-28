/**
 * Rate-limit claim + bounded cleanup, kept free of database imports so the rules are unit-testable.
 * The real store (lib/http-security.ts) implements `claim` as ONE atomic SQL statement:
 *   INSERT ... ON CONFLICT (key) DO UPDATE SET <reset or count+1> WHERE <window expired OR count < limit> RETURNING
 * No row returned = the bucket is full for the live window. There is no read-then-write gap, so parallel
 * requests cannot all observe "below limit" and slip through.
 */
export type RateLimitClaim = { key: string; limit: number; now: Date; expiresAt: Date };
export type RateLimitStore = {
  /** Atomically counts this request. true = allowed (counted); false = the live window is already at the limit. */
  claim(input: RateLimitClaim): Promise<boolean>;
  /** Deletes at most `batch` buckets whose window ended before `cutoff`; returns how many were removed. */
  purgeExpired(cutoff: Date, batch: number): Promise<number>;
};

export async function claimRateLimit(store: RateLimitStore, input: { key: string; limit: number; windowMs: number; now: Date }): Promise<boolean> {
  return store.claim({ key: input.key, limit: input.limit, now: input.now, expiresAt: new Date(input.now.getTime() + input.windowMs) });
}

/** Expired buckets are already ignored by `claim`; they are only removed after this grace so a just-ended window is never raced. */
export const PURGE_GRACE_MS = 60 * 60_000;
export const PURGE_BATCH = 200;
export const PURGE_PROBABILITY = 0.02;

/** Best-effort, bounded retention: roughly one request in fifty removes up to PURGE_BATCH long-expired buckets. Never throws. */
export async function maybePurgeExpiredBuckets(store: RateLimitStore, now: Date, random: () => number = Math.random): Promise<number> {
  if (random() >= PURGE_PROBABILITY) return 0;
  try {
    return await store.purgeExpired(new Date(now.getTime() - PURGE_GRACE_MS), PURGE_BATCH);
  } catch {
    return 0; // cleanup must never turn an allowed request into an error
  }
}
