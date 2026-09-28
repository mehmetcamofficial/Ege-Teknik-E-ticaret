import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";
import type { RateLimitStore } from "./rate-limit.ts";

const { rateLimitBuckets } = schema;

/** The real PostgreSQL side of the rate limiter (see lib/rate-limit.ts for the contract). */
export function createRateLimitStore(db: NodePgDatabase<typeof schema>): RateLimitStore {
  return {
  async claim({key,limit,now,expiresAt}){
    const expired=sql`${rateLimitBuckets.expiresAt} <= ${now}`;
    const rows=await db.insert(rateLimitBuckets).values({key,count:1,windowStartedAt:now,expiresAt}).onConflictDoUpdate({
      target:rateLimitBuckets.key,
      set:{count:sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,windowStartedAt:sql`CASE WHEN ${expired} THEN ${now} ELSE ${rateLimitBuckets.windowStartedAt} END`,expiresAt:sql`CASE WHEN ${expired} THEN ${expiresAt} ELSE ${rateLimitBuckets.expiresAt} END`},
      setWhere:sql`${expired} OR ${rateLimitBuckets.count} < ${limit}`,
    }).returning({count:rateLimitBuckets.count});
    return rows.length>0;
  },
  async purgeExpired(cutoff,batch){
    const removed=await db.execute(sql`DELETE FROM ${rateLimitBuckets} WHERE ${rateLimitBuckets.key} IN (SELECT ${rateLimitBuckets.key} FROM ${rateLimitBuckets} WHERE ${rateLimitBuckets.expiresAt} < ${cutoff} LIMIT ${batch})`);
    return removed.rowCount??0;
  },
};
}
