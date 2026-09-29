/**
 * Environment guards for the content-registry CLIs (P0-B / P1).
 *
 * Split from the CLIs so the safety rules are unit-testable without a database and without a network.
 * These rules are the reason P1 can be run safely: a registry import/export is only ever permitted
 * against an explicitly-confirmed PREVIEW or DEV database, and Production is refused outright.
 */

/**
 * @typedef {Record<string, string | undefined>} RegistryEnv
 */

export class RegistryGuardError extends Error {}

export const CONFIRM_TOKEN = "I_UNDERSTAND_PREVIEW_ONLY";

/**
 * Asserts that the target database is a Preview/dev one.
 *
 * Fails closed: no connection string, no explicit target, a Production branch id, a Production APP_ENV
 * or a missing confirmation token are all refusals. A pooler endpoint is refused too, because the pooled
 * hostname cannot be matched against the branch id we are asked to verify.
 *
 * @param {RegistryEnv} env
 * @returns {string} the validated connection string
 */
export function assertPreviewTarget(env) {
  const url = env.DATABASE_URL_UNPOOLED;
  const target = env.MIGRATION_TARGET_ENV;
  const branch = env.NEON_BRANCH_ID;
  const preview = env.EXPECTED_NEON_PREVIEW_BRANCH_ID;
  const productionBranch = env.EXPECTED_NEON_PRODUCTION_BRANCH_ID;
  if (!url) throw new RegistryGuardError("DATABASE_URL_UNPOOLED is required.");
  if (!target) throw new RegistryGuardError("MIGRATION_TARGET_ENV is required.");
  if (!branch) throw new RegistryGuardError("NEON_BRANCH_ID is required.");
  if (!preview) throw new RegistryGuardError("EXPECTED_NEON_PREVIEW_BRANCH_ID is required.");

  let host = "";
  try { host = new URL(url).hostname; } catch { throw new RegistryGuardError("DATABASE_URL_UNPOOLED is not a valid URL."); }
  if (host.includes("-pooler.")) throw new RegistryGuardError("Refusing a pooler endpoint: the branch cannot be verified from it.");
  // Belt-and-braces on the hostname: identity normally comes from the branch id, but if the operator also
  // supplies the known production hostname, a production host is refused outright even when every id lines up.
  if (env.EXPECTED_NEON_PRODUCTION_HOSTNAME && host === env.EXPECTED_NEON_PRODUCTION_HOSTNAME) {
    throw new RegistryGuardError("Refusing to run against the Production host.");
  }
  if (target !== "preview" && target !== "dev") throw new RegistryGuardError(`Content registry work may only target preview or dev (got "${target}").`);
  if (branch !== preview) throw new RegistryGuardError("NEON_BRANCH_ID is not the expected Preview branch.");
  if (productionBranch && branch === productionBranch) throw new RegistryGuardError("Refusing to run against the Production branch.");
  if (env.APP_ENV && env.APP_ENV !== "preview" && env.APP_ENV !== "development") throw new RegistryGuardError(`APP_ENV must be preview or development (got "${env.APP_ENV}").`);
  if (env.CONTENT_REGISTRY_CONFIRM !== CONFIRM_TOKEN) throw new RegistryGuardError(`Set CONTENT_REGISTRY_CONFIRM=${CONFIRM_TOKEN} to proceed.`);
  return url;
}

/** The same assertion, but for a write. Kept separate so a read-only export is explicit about its own risk. */
export function assertPreviewWrite(env) {
  return assertPreviewTarget(env);
}
