import { createHash, timingSafeEqual } from "node:crypto";
import { preConnectViolations } from "./db-attestation-url-guard.ts";
import { DatabaseRuntimeAttestationError, attestDatabaseRuntime, expectedIdentity, type AttestedScope, type Query } from "./db-runtime-attestation.ts";

/**
 * POST /api/internal/db-attestation - Preview-only, authorised, fail-closed attestation of the two scoped database connections.
 * Every dependency is injected so the behaviour is unit-tested without a server, a network or a database.
 *
 * Checks run in this fixed order and each failure stops the request before anything later happens (`CHECK_ORDER`, also reported through `deps.trace`):
 *   environment    VERCEL_ENV and APP_ENV must BOTH be "preview"                                  -> 404 (no information, whatever else is configured)
 *   feature        DB_ATTESTATION_ENABLED must be exactly "true"                                  -> 404
 *   secret         DB_ATTESTATION_SECRET: strong, and different from the notification secret    -> 404
 *   authorization  Authorization: Bearer <secret>, compared with timingSafeEqual on digests      -> 401
 *   method         POST only                                                                     -> 405
 *   configuration  Neon branch/endpoint/roles/database complete and consistent, flag well-formed,
 *                  TLS verification not switched off for the process                              -> 503 not_ready
 *   urls           BOTH scoped URLs are resolved and judged against the expected endpoint, database
 *                  and role BEFORE any connection exists; one bad URL means no connection at all   -> 422 (nothing was dialled)
 *   storefront     real session identity vs expected role, database, endpoint (URL and session)   \  both are always attempted,
 *   admin          the same for the admin scope                                                   /  separately
 *   checkout       CHECKOUT_SCOPED_DB_ENABLED must be true                                        -> 409 when the identities are fine but the flag is not
 * Nothing before `configuration` can open a connection or send a query: the unauthorised request never reaches `deps.resolveUrl`, `deps.connect` or any SQL.
 *
 * WHAT A 200 MEANS (and does not): the two scoped URLs name the expected roles, database and Neon endpoint, a real session opened with each of them reports
 * that identity, and the checkout flag is on. It is NOT evidence that checkout requests run on those connections: checkout takes its connection from
 * getCheckoutDb() in db/index.ts (shared pools), which this endpoint never touches. That needs its own, separate proof (see the release plan).
 *
 * Responses carry fixed status words and fixed reason codes only: never a URL, host, role, database, endpoint id, token, driver or SQL message.
 */
type Env = Record<string, string | undefined>;
export type AttestationSession = { query: Query; close: () => Promise<void> };
export type DbAttestationDeps = {
  env: Env;
  /** lib/db-access-scope.ts resolveScopedDatabaseUrl: pure, throws when the scoped URL is not a valid, distinct, same-branch URL. */
  resolveUrl: (scope: AttestedScope, env: Env) => string;
  /** lib/db-access-scope.ts scopedCheckoutEnabled: throws unless the value is absent, "", "true" or "false". */
  scopedCheckoutEnabled: (value: string | undefined) => boolean;
  /** Opens ONE short-lived session. Only ever called after every check up to `configuration` has passed. */
  connect: (connectionString: string) => Promise<AttestationSession>;
  trace?: (step: string) => void;
  timeouts?: { connectMs?: number; queryMs?: number; closeMs?: number; totalMs?: number };
};

export const CHECK_ORDER = ["environment", "feature", "secret", "authorization", "method", "configuration", "urls", "storefront", "admin", "checkout"] as const;
export const MIN_SECRET_LENGTH = 32;
const DEFAULT_TIMEOUTS = { connectMs: 6000, queryMs: 5000, closeMs: 2000, totalMs: 20000 };
const BRANCH = /^br-[a-z0-9]+(?:-[a-z0-9]+)+$/;
const REASON = /^[A-Za-z0-9_]{1,64}$/;

const HEADERS = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" } as const;
const json = (body: unknown, status: number, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });
const absent = () => json({ error: "not_found" }, 404);
const digest = (value: string) => createHash("sha256").update(value).digest();
/** Fixed-length digests: neither the length nor the content of the secret is observable through timing. */
export const sameSecret = (presented: string, secret: string) => timingSafeEqual(digest(presented), digest(secret));
const safeReasons = (reasons: string[]) => reasons.filter((r) => REASON.test(r)).slice(0, 12);

type ScopeResult = { status: "verified" | "rejected" | "unavailable" | "skipped"; reasons: string[] };

/** Rejects after `ms`; a value that arrives late is handed to `onLate` so a session that opened after the deadline is still closed. */
function withTimeout<T>(promise: Promise<T>, ms: number, reason: string, onLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { done = true; reject(new Error(reason)); }, ms);
    promise.then((value) => { clearTimeout(timer); if (done) onLate?.(value); else resolve(value); }, (error) => { clearTimeout(timer); if (!done) reject(error); });
  });
}

/** Pure: why the Preview identity configuration is not usable (fixed codes, names of variables at most), or [] when complete and consistent. */
export function configurationProblems(env: Env, scopedCheckoutEnabled: (value: string | undefined) => boolean): string[] {
  const problems: string[] = [];
  const actual = env.NEON_BRANCH_ID?.trim() ?? "", preview = env.EXPECTED_NEON_PREVIEW_BRANCH_ID?.trim() ?? "", production = env.EXPECTED_NEON_PRODUCTION_BRANCH_ID?.trim() ?? "";
  if (!BRANCH.test(actual)) problems.push("NEON_BRANCH_ID_invalid");
  if (!BRANCH.test(preview)) problems.push("EXPECTED_NEON_PREVIEW_BRANCH_ID_invalid");
  if (BRANCH.test(actual) && BRANCH.test(preview) && actual !== preview) problems.push("branch_mismatch");
  if (production && !BRANCH.test(production)) problems.push("EXPECTED_NEON_PRODUCTION_BRANCH_ID_invalid");
  if (production && (production === preview || production === actual)) problems.push("branch_is_production");
  for (const scope of ["storefront", "admin"] as const) {
    const expected = expectedIdentity(scope, env);
    if (!expected.ok) problems.push(...expected.reasons);
  }
  try { scopedCheckoutEnabled(env.CHECKOUT_SCOPED_DB_ENABLED); } catch { problems.push("CHECKOUT_SCOPED_DB_ENABLED_invalid"); }
  // With this set, Node stops verifying TLS certificates wherever the driver does not pin the option itself (the checkout pools do not): an identity read over an
  // unauthenticated channel proves nothing, so the deployment is reported as not ready instead of being blessed.
  if (env.NODE_TLS_REJECT_UNAUTHORIZED?.trim() === "0") problems.push("tls_verification_disabled");
  return [...new Set(problems)];
}

/** Resolves one scope's URL and judges it against the expected identity. Nothing is connected here. */
function prepareScope(scope: AttestedScope, deps: DbAttestationDeps): { url: string } | { result: ScopeResult } {
  let url: string;
  try { url = deps.resolveUrl(scope, deps.env); } catch { return { result: { status: "rejected", reasons: ["scoped_url_invalid"] } }; }
  const expected = expectedIdentity(scope, deps.env);
  if (!expected.ok) return { result: { status: "rejected", reasons: safeReasons(expected.reasons) } };
  const violations = preConnectViolations(url, expected.expected);
  return violations.length ? { result: { status: "rejected", reasons: safeReasons(violations) } } : { url };
}

async function attestScope(scope: AttestedScope, url: string, deps: DbAttestationDeps, timeouts: typeof DEFAULT_TIMEOUTS, deadline: number): Promise<ScopeResult> {
  if (Date.now() >= deadline) return { status: "unavailable", reasons: ["request_timeout"] };
  let session: AttestationSession;
  try { session = await withTimeout(deps.connect(url), Math.min(timeouts.connectMs, Math.max(1, deadline - Date.now())), "connect_timeout", (late) => { void late.close().catch(() => {}); }); }
  catch (error) { return { status: "unavailable", reasons: [error instanceof Error && error.message === "connect_timeout" ? "connection_timeout" : "connection_failed"] }; }
  try {
    await attestDatabaseRuntime({ scope, connectionString: url, env: deps.env, query: session.query, timeoutMs: Math.min(timeouts.queryMs, Math.max(1, deadline - Date.now())) });
    return { status: "verified", reasons: [] };
  } catch (error) {
    if (!(error instanceof DatabaseRuntimeAttestationError)) return { status: "unavailable", reasons: ["attestation_error"] };
    const unavailable = error.reasons.some((r) => r === "identity_timeout" || r === "identity_query_failed");
    return { status: unavailable ? "unavailable" : "rejected", reasons: safeReasons(error.reasons) };
  } finally { await withTimeout(session.close(), timeouts.closeMs, "close_timeout").catch(() => {}); }   // a stuck close must not hold the request or change its verdict
}

export async function handleDbAttestation(request: Request, deps: DbAttestationDeps): Promise<Response> {
  const trace = (step: string) => deps.trace?.(step);
  const timeouts = { ...DEFAULT_TIMEOUTS, ...deps.timeouts };
  try {
    const env = deps.env;
    trace("environment");
    if (env.VERCEL_ENV !== "preview" || env.APP_ENV !== "preview") return absent();
    trace("feature");
    if (env.DB_ATTESTATION_ENABLED !== "true") return absent();
    trace("secret");
    const secret = env.DB_ATTESTATION_SECRET?.trim() ?? "";
    if (secret.length < MIN_SECRET_LENGTH || new Set(secret).size < 8 || secret === env.NOTIFICATION_DISPATCH_SECRET?.trim()) return absent();
    trace("authorization");
    const presented = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    if (!sameSecret(presented, secret)) return json({ error: "unauthorized" }, 401);
    trace("method");
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
    trace("configuration");
    const problems = configurationProblems(env, deps.scopedCheckoutEnabled);
    if (problems.length) return json({ ok: false, status: "not_ready", reasons: safeReasons(problems) }, 503);

    // Both URLs are judged before EITHER scope connects: a bad admin URL must not be discovered after a storefront session is already open.
    trace("urls");
    const prepared = { storefront: prepareScope("storefront", deps), admin: prepareScope("admin", deps) };
    const flagOn = deps.scopedCheckoutEnabled(env.CHECKOUT_SCOPED_DB_ENABLED);
    if ("result" in prepared.storefront || "result" in prepared.admin) {
      const verdict = (p: typeof prepared.storefront): ScopeResult => ("result" in p ? p.result : { status: "skipped", reasons: ["other_scope_rejected"] });
      return json({ ok: false, storefront: verdict(prepared.storefront), admin: verdict(prepared.admin), checkoutActivation: flagOn ? "flag_enabled" : "not_enabled" }, 422);
    }
    const urls = { storefront: prepared.storefront.url, admin: prepared.admin.url };

    const deadline = Date.now() + timeouts.totalMs;
    const results = await withTimeout((async () => {
      trace("storefront");
      const storefront = await attestScope("storefront", urls.storefront, deps, timeouts, deadline);
      trace("admin");
      const admin = await attestScope("admin", urls.admin, deps, timeouts, deadline);
      return { storefront, admin };
    })(), timeouts.totalMs, "total_timeout");
    trace("checkout");
    const all = [results.storefront.status, results.admin.status];
    const status = all.includes("rejected") ? 422 : all.includes("unavailable") ? 503 : flagOn ? 200 : 409;
    return json({ ok: status === 200, storefront: results.storefront, admin: results.admin, checkoutActivation: flagOn ? "flag_enabled" : "not_enabled" }, status);
  } catch {
    // Anything unexpected - including the total deadline - is a closed door with a fixed word, never a message.
    return json({ ok: false, status: "unavailable" }, 503);
  }
}
