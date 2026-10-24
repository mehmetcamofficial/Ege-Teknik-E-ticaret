/**
 * Proof that a PostgreSQL cluster is a DISPOSABLE test cluster, shared by the PR #37 worker suites
 * (scripts/test-pr37-worker-http.mjs and scripts/test-notification-worker-acl.mjs).
 *
 * A cluster is accepted only when EVERY hard check holds AND at least one attestation route holds:
 *
 *   hard checks (all required, always)
 *     - CI=true
 *     - the host is loopback and the port is not the recovery cluster (55432)
 *     - every non-template database in the cluster is `postgres` or `sprintb*`: a cluster that holds any other database
 *       (a restored or hosted application database) is refused, whatever else it claims
 *     - it is not a Neon compute (no neon extension, no neon.* setting)
 *
 *   attestation routes (one is enough)
 *     lab  - the data directory contains "pr37-worker-pg" (the local lab cluster; unchanged from the first version of the harness)
 *     ci   - a database of THIS cluster carries the comment `ege-disposable-ci:<GITHUB_RUN_ID>:<GITHUB_RUN_ATTEMPT>:<32 hex>` that
 *            equals PR37_DISPOSABLE_ATTEST, GITHUB_ACTIONS=true and the run id inside the marker is the run that is executing. The CI
 *            job writes the marker into the throwaway service container (scripts/ci-mark-disposable-cluster.mjs) right before the
 *            suites, so a database that was not marked by this very run can never satisfy it.
 *
 * No credential or URL is ever returned or printed: only fixed reason strings.
 */
export const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];
export const RECOVERY_PORT = "55432";
export const SAFE_DATABASE_NAME = /^(postgres|sprintb[a-z0-9_]*)$/;
export const LAB_DATA_DIRECTORY = /pr37-worker-pg/;
export const ATTEST_PATTERN = /^ege-disposable-ci:(\d{1,20}):(\d{1,6}):[0-9a-f]{32}$/;

/** @typedef {Record<string, string | undefined>} Env */
/** @typedef {(text: string, params?: unknown[]) => Promise<{ rows: any[] }>} Query */

/**
 * Pure: the reasons a cluster is NOT accepted (empty = accepted). `facts` comes from readClusterFacts; `env` is the process environment.
 * @param {{ host: string, port: string, facts: { databases?: string[], neon?: boolean, dataDirectory?: string | null, markers?: string[] } | null }} cluster
 * @param {Env} env
 * @returns {string[]}
 */
export function clusterProblems({ host, port, facts }, env) {
  const problems = [];
  if (env.CI !== "true") problems.push("not_ci");
  if (!LOOPBACK_HOSTS.includes(host)) problems.push("not_loopback");
  if (String(port || "5432") === RECOVERY_PORT) problems.push("recovery_port");
  const names = facts?.databases;
  if (!Array.isArray(names) || names.length === 0) problems.push("databases_unreadable");
  else if (names.some((name) => !SAFE_DATABASE_NAME.test(name))) problems.push("foreign_database_present");
  if (!facts || facts.neon !== false) problems.push("neon_or_unknown");
  const lab = typeof facts?.dataDirectory === "string" && LAB_DATA_DIRECTORY.test(facts.dataDirectory);
  const marker = env.PR37_DISPOSABLE_ATTEST ?? "";
  const parsed = ATTEST_PATTERN.exec(marker);
  const ci = Boolean(parsed) && env.GITHUB_ACTIONS === "true" && parsed[1] === env.GITHUB_RUN_ID && parsed[2] === env.GITHUB_RUN_ATTEMPT
    && Array.isArray(facts?.markers) && facts.markers.includes(marker);
  if (!lab && !ci) problems.push("no_attestation");
  return problems;
}

/**
 * Reads the facts about the cluster behind `query`. Never throws on missing privileges.
 * @param {Query} query
 * @param {Env} env
 */
export async function readClusterFacts(query, env) {
  const databases = (await query("SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1")).rows.map((r) => r.datname);
  const extensions = Number((await query("SELECT count(*)::int AS n FROM pg_extension WHERE extname LIKE 'neon%'")).rows[0].n);
  // The EXISTENCE of any neon.* setting is the signal (a defined but empty value must not read as "not Neon").
  const settings = Number((await query("SELECT count(*)::int AS n FROM pg_settings WHERE name LIKE 'neon.%'")).rows[0].n);
  let dataDirectory = null;
  try { dataDirectory = (await query("SHOW data_directory")).rows[0].data_directory; } catch { /* needs superuser or pg_read_all_settings */ }
  const wanted = env.PR37_DISPOSABLE_ATTEST ?? "";
  const markers = ATTEST_PATTERN.test(wanted)
    ? (await query("SELECT 1 FROM pg_database WHERE shobj_description(oid, 'pg_database') = $1", [wanted])).rows.map(() => wanted)
    : [];
  return { databases, neon: extensions > 0 || settings > 0, dataDirectory, markers };
}

/**
 * Throws Error("disposable cluster refused: <reasons>") unless the cluster is accepted; returns the route that attested it.
 * @param {{ url: string, query: Query, env?: Env }} input
 * @returns {Promise<"lab" | "ci">}
 */
export async function attestDisposableCluster({ url, query, env = process.env }) {
  const target = new URL(url);
  const host = target.hostname.replace(/^\[|\]$/g, "");
  let facts = null;
  try { facts = await readClusterFacts(query, env); } catch { /* facts stay null: refused below */ }
  const problems = clusterProblems({ host, port: target.port, facts }, env);
  if (problems.length) throw new Error(`disposable cluster refused: ${problems.join(", ")}`);
  return typeof facts.dataDirectory === "string" && LAB_DATA_DIRECTORY.test(facts.dataDirectory) ? "lab" : "ci";
}
