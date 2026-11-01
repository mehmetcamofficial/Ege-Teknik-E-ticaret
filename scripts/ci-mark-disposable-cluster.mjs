#!/usr/bin/env node
/**
 * CI only: marks THIS job's throwaway PostgreSQL service container as the disposable cluster of this run, so the PR #37 worker suites
 * (see scripts/disposable-cluster-attest.mjs) can verify it. It writes a per-run nonce into the comment of the sprintb* database and
 * appends PR37_DISPOSABLE_ATTEST=<nonce> to the file named by GITHUB_ENV, for the later steps of the same job.
 *
 * env: MARK_PG_URL (loopback sprintb* database of the service container), GITHUB_ACTIONS=true, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_ENV.
 * Refuses everything else. Prints neither the URL nor the nonce.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import pg from "pg";

const refuse = (why) => { console.error(`[mark-disposable] REFUSED: ${why}`); process.exit(1); };
const target = (() => { try { return new URL(process.env.MARK_PG_URL ?? ""); } catch { return null; } })();
const { GITHUB_ACTIONS, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_ENV, CI } = process.env;
if (CI !== "true" || GITHUB_ACTIONS !== "true") refuse("runs only inside a GitHub Actions job");
if (!/^\d{1,20}$/.test(GITHUB_RUN_ID ?? "") || !/^\d{1,6}$/.test(GITHUB_RUN_ATTEMPT ?? "") || !GITHUB_ENV) refuse("GitHub run identity is incomplete");
if (!target || !["postgres:", "postgresql:"].includes(target.protocol)) refuse("a PostgreSQL URL is required");
if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname) || target.port === "55432") refuse("loopback service container only");
const database = decodeURIComponent(target.pathname.slice(1));
if (!/^sprintb[a-z0-9_]*$/.test(database)) refuse("the database name must start with sprintb");

const nonce = `ege-disposable-ci:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:${randomBytes(16).toString("hex")}`;
const pool = new pg.Pool({ connectionString: target.toString(), max: 1 });
try {
  const foreign = (await pool.query("SELECT datname FROM pg_database WHERE NOT datistemplate AND datname !~ '^(postgres|sprintb[a-z0-9_]*)$'")).rowCount;
  if (foreign) refuse("the cluster holds a database that is neither postgres nor sprintb*");
  await pool.query(`COMMENT ON DATABASE "${database}" IS '${nonce}'`);
  appendFileSync(GITHUB_ENV, `PR37_DISPOSABLE_ATTEST=${nonce}\n`);
  console.log("[mark-disposable] this job's service container is marked as the disposable cluster of this run");
} finally { await pool.end(); }
