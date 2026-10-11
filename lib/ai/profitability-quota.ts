import "server-only";
import { getDb } from "@/db";
import { createRateLimitStore } from "@/lib/rate-limit-db";
import { claimRateLimit } from "@/lib/rate-limit";

/**
 * Global monthly request ceiling for the profitability AI feature.
 * The database's atomic upsert prevents concurrent requests from exceeding the cap.
 * This is a request cap, NOT a currency-denominated provider spending limit.
 */
export async function claimProfitabilityAiMonthlyQuota(now = new Date()): Promise<boolean> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const nextMonth = new Date(Date.UTC(year, month + 1, 1));
  const remainingMs = nextMonth.getTime() - now.getTime();
  return claimRateLimit(createRateLimitStore(getDb()), {
    key: `admin-profitability-ai-global:${year}-${String(month + 1).padStart(2, "0")}`,
    limit: 100,
    windowMs: remainingMs,
    now,
  });
}
