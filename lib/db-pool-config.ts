import { expectedIdentity } from "./db-runtime-attestation.ts";
import { preConnectViolations } from "./db-attestation-url-guard.ts";
import type { DatabaseScope } from "./db-access-scope.ts";

/**
 * Connection settings for the SCOPED checkout pools (db/index.ts getScopedPool). Pure: no I/O, no connection, nothing logged.
 * The legacy pool and the notification worker pool are NOT built here and keep their behaviour unchanged.
 *
 * WHY THE URL'S sslmode IS REMOVED: pg-connection-string copies `sslmode` from the URL into the driver config, and for `require`/`verify-ca`/`verify-full`
 * it REPLACES an explicit `ssl` option with `{}`. Certificate verification then depends on Node's default and on NODE_TLS_REJECT_UNAUTHORIZED=0, so the
 * `ssl: { rejectUnauthorized: true }` written next to the URL protected nothing (Neon URLs always carry sslmode). The scoped pools therefore take TLS from the
 * explicit option only, with verification on. (The driver also announces that `require`/`verify-ca` will change meaning in pg v9; with the parameter removed
 * the scoped pools do not depend on that.)
 *
 * IN PREVIEW the URL is judged BEFORE any pool, and so any connection, exists: expected role, database and Neon endpoint of the scope
 * (lib/db-attestation-url-guard.ts, the same judgement the attestation endpoint makes) and a process that has switched TLS verification off is refused.
 * Production gets the TLS pin and the refusal of a process with verification off, and nothing weaker than before. A disposable local database
 * (development, loopback, `sprintb*`) keeps its plain, non-TLS connection exactly as db/index.ts createPool allowed it.
 *
 * Errors are fixed sentences plus fixed reason codes; nothing derived from the URL or the environment values is ever included.
 */
type Env = Record<string, string | undefined>;
export type ScopedPoolSettings = { connectionString: string; ssl: false | { rejectUnauthorized: true } };

/** Same predicate as db/index.ts createPool (a test pins that the two stay identical). */
function disposableLocal(target: URL, env: Env): boolean {
  return env.APP_ENV === "development" && ["127.0.0.1", "localhost", "::1"].includes(target.hostname) && target.pathname.slice(1).startsWith("sprintb");
}

export function scopedPoolSettings(scope: DatabaseScope, connectionString: string, env: Env): ScopedPoolSettings {
  let target: URL;
  try { target = new URL(connectionString); } catch { throw new Error("Scoped database connection rejected: url_invalid."); }
  if (disposableLocal(target, env)) return { connectionString, ssl: false };

  const reasons: string[] = [];
  if (env.NODE_TLS_REJECT_UNAUTHORIZED?.trim() === "0" && (env.APP_ENV === "preview" || env.APP_ENV === "production")) reasons.push("tls_verification_disabled");
  if (env.APP_ENV === "preview") {
    const expected = expectedIdentity(scope, env);
    if (!expected.ok) reasons.push(...expected.reasons);
    else reasons.push(...preConnectViolations(connectionString, expected.expected));
  }
  if (reasons.length) throw new Error(`Scoped database connection rejected: ${[...new Set(reasons)].filter((r) => /^[A-Za-z0-9_]{1,64}$/.test(r)).slice(0, 12).join(",")}.`);

  target.searchParams.delete("sslmode");
  return { connectionString: target.toString(), ssl: { rejectUnauthorized: true } };
}
