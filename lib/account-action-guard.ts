import "server-only";
import { headers } from "next/headers";
import { HttpError, rateLimit } from "@/lib/http-security";

/** Shared by every /account mutation: 20 attempts per client per 15 minutes, per action scope. */
export const ACCOUNT_MUTATION_LIMIT = 20;
export const ACCOUNT_MUTATION_WINDOW_MS = 15 * 60_000;

/**
 * Rate limiting for /account Server Actions, reusing the project's existing
 * rateLimit()/rate_limit_buckets architecture (see lib/http-security.ts) -
 * not a second system. Server Actions have no Request object, so this reads
 * the same client-ip headers via next/headers' headers() instead.
 *
 * This only throttles abuse; it never substitutes for or weakens the Clerk
 * session check or the ownership-scoped store calls each action still runs
 * on its own.
 */
export async function rateLimitAccountAction(scope: string, limit: number, windowMs: number): Promise<string | null> {
  try {
    await rateLimit({ headers: await headers() }, scope, limit, windowMs);
    return null;
  } catch (error) {
    if (error instanceof HttpError) return error.message;
    throw error;
  }
}
