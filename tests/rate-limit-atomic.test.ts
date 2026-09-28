import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PURGE_BATCH, PURGE_GRACE_MS, claimRateLimit, maybePurgeExpiredBuckets, type RateLimitStore } from "../lib/rate-limit.ts";

const T0 = new Date("2026-09-28T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

/**
 * A store with the exact semantics of the one-statement upsert in lib/http-security.ts (insert, or update the row
 * only when the window expired / count < limit). Every claim yields to the event loop first, so simultaneous callers
 * genuinely interleave; the row update itself is one synchronous step, like the database's row-level atomicity.
 */
function memoryStore() {
  const rows = new Map<string, { count: number; expiresAt: Date }>();
  const store: RateLimitStore = {
    async claim({ key, limit, now, expiresAt }) {
      await new Promise((resolve) => setImmediate(resolve));
      const row = rows.get(key);
      if (!row) { rows.set(key, { count: 1, expiresAt }); return true; }
      if (row.expiresAt.getTime() <= now.getTime()) { rows.set(key, { count: 1, expiresAt }); return true; }
      if (row.count < limit) { row.count += 1; return true; }
      return false;
    },
    async purgeExpired(cutoff, batch) {
      let removed = 0;
      for (const [key, row] of rows) { if (removed >= batch) break; if (row.expiresAt < cutoff) { rows.delete(key); removed += 1; } }
      return removed;
    },
  };
  return { rows, store };
}
const claim = (store: RateLimitStore, key: string, limit: number, now: Date, windowMs = 60_000) => claimRateLimit(store, { key, limit, windowMs, now });

test("requests below the limit succeed and request N+1 is refused", async () => {
  const { store } = memoryStore();
  for (let i = 0; i < 5; i += 1) assert.equal(await claim(store, "login:a", 5, T0), true, `request ${i + 1}`);
  assert.equal(await claim(store, "login:a", 5, T0), false);
  assert.equal(await claim(store, "login:a", 5, at(10)), false);
});

test("a parallel burst can never exceed the limit", async () => {
  const { store, rows } = memoryStore();
  const results = await Promise.all(Array.from({ length: 40 }, () => claim(store, "order:ip", 8, T0)));
  assert.equal(results.filter(Boolean).length, 8, "exactly `limit` requests are allowed");
  assert.equal(rows.get("order:ip")!.count, 8);
});

test("a new window resets the counter", async () => {
  const { store } = memoryStore();
  for (let i = 0; i < 3; i += 1) await claim(store, "k", 3, T0);
  assert.equal(await claim(store, "k", 3, at(30_000)), false);
  assert.equal(await claim(store, "k", 3, at(60_000)), true, "window ended exactly at expiresAt");
  assert.equal(await claim(store, "k", 3, at(60_001)), true);
});

test("keys and scopes are isolated from each other", async () => {
  const { store } = memoryStore();
  await claim(store, "login:1.1.1.1", 1, T0);
  assert.equal(await claim(store, "login:1.1.1.1", 1, T0), false);
  assert.equal(await claim(store, "login:2.2.2.2", 1, T0), true);
  assert.equal(await claim(store, "order:1.1.1.1", 1, T0), true);
});

test("the production claim is ONE atomic statement: upsert with a conditional update and RETURNING, no read-then-write", () => {
  const src = readFileSync(new URL("../lib/http-security.ts", import.meta.url), "utf8");
  const claimBody = src.slice(src.indexOf("async claim("), src.indexOf("async purgeExpired("));
  assert.match(claimBody, /\.insert\(rateLimitBuckets\)[\s\S]*\.onConflictDoUpdate\(/);
  assert.match(claimBody, /setWhere:sql`\$\{expired\} OR \$\{rateLimitBuckets\.count\} < \$\{limit\}`/);
  assert.match(claimBody, /\.returning\(/);
  assert.doesNotMatch(claimBody, /\.select\(/, "the count must not be read in a separate statement");
  assert.doesNotMatch(src, /rateLimitExceeded|isBucketWindowActive/, "the old read-then-write helpers are no longer used by the limiter");
});

test("cleanup removes only long-expired buckets, bounded by the batch, and leaves live ones", async () => {
  const { store, rows } = memoryStore();
  rows.set("old", { count: 9, expiresAt: at(-2 * PURGE_GRACE_MS) });
  rows.set("justEnded", { count: 9, expiresAt: at(-1000) });
  rows.set("live", { count: 1, expiresAt: at(60_000) });
  const removed = await maybePurgeExpiredBuckets(store, T0, () => 0);
  assert.equal(removed, 1);
  assert.deepEqual([...rows.keys()].sort(), ["justEnded", "live"]);
  for (let i = 0; i < PURGE_BATCH + 50; i += 1) rows.set(`bulk${i}`, { count: 1, expiresAt: at(-3 * PURGE_GRACE_MS) });
  assert.equal(await maybePurgeExpiredBuckets(store, T0, () => 0), PURGE_BATCH, "one pass is bounded");
});

test("cleanup is probabilistic, best-effort and cannot change rate-limit correctness or fail a request", async () => {
  const { store, rows } = memoryStore();
  rows.set("old", { count: 1, expiresAt: at(-2 * PURGE_GRACE_MS) });
  assert.equal(await maybePurgeExpiredBuckets(store, T0, () => 0.99), 0, "most requests do no cleanup");
  assert.equal(rows.size, 1);
  const failing: RateLimitStore = { claim: store.claim, purgeExpired: async () => { throw new Error("db down"); } };
  assert.equal(await maybePurgeExpiredBuckets(failing, T0, () => 0), 0, "a cleanup failure is swallowed");
  for (let i = 0; i < 2; i += 1) await claim(store, "live", 2, T0);
  await maybePurgeExpiredBuckets(store, T0, () => 0);
  assert.equal(await claim(store, "live", 2, T0), false);
});
