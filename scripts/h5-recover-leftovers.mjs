#!/usr/bin/env node
/**
 * Explicit, opt-in recovery after an H5 run that could not clean up (SIGKILL, crash, power loss). It is never run automatically and a normal
 * run never touches another run's resources: every run uses its own random names (scripts/test-resource-ledger.mjs).
 *
 * For each ledger file it removes the leftover database, roles and dev-server process groups ONLY IF ownership is proven: same cluster
 * (system identifier), the owning process is gone, each object still has the OID recorded when the run created it, each server's pid AND start
 * time still match. Anything unproven - another cluster, a live run, an oid that changed, an unreadable ledger - is left in place and
 * reported, and makes the exit code non-zero (except "other cluster" / "still running", which are not this cluster's leftovers).
 *
 * env: H5_PG_URL (login of the disposable cluster; same guards as the suite: CI=true, loopback, never port 55432, cluster attested).
 * Prints no URL, credential or resource name.
 */
import { basename } from "node:path";
import { rmSync } from "node:fs";
import pg from "pg";
import { attestDisposableCluster } from "./disposable-cluster-attest.mjs";
import { readLedgers, recoverLedger } from "./test-resource-ledger.mjs";

const refuse = (why) => { console.error(`[h5-recover] REFUSED: ${why}`); process.exit(1); };
const base = (() => { try { return new URL(process.env.H5_PG_URL ?? ""); } catch { return null; } })();
if (process.env.CI !== "true") refuse("requires CI=true");
if (!base || !["postgres:", "postgresql:"].includes(base.protocol)) refuse("H5_PG_URL must be a PostgreSQL URL");
if (!["127.0.0.1", "localhost", "::1"].includes(base.hostname.replace(/^\[|\]$/g, ""))) refuse("loopback PostgreSQL URL required");
if (base.port === "55432") refuse("the recovery cluster port is never allowed");
const maintenanceUrl = (() => { const u = new URL(base); u.pathname = "/postgres"; return u.toString(); })();

const client = new pg.Client({ connectionString: maintenanceUrl, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
let recovered = 0, untouched = 0, failed = 0;
try {
  await client.connect();
  const query = (text, params) => client.query(text, params);
  await attestDisposableCluster({ url: maintenanceUrl, query, env: process.env });
  const clusterSystemId = (await query("SELECT system_identifier::text AS id FROM pg_control_system()")).rows[0].id;
  const ledgers = readLedgers();
  if (!ledgers.length) console.log("[h5-recover] no ledger found: nothing to recover");
  for (const { file, entry } of ledgers) {
    const label = basename(file);
    if (!entry) { failed++; console.error(`[h5-recover] ${label}: unreadable or unknown ledger, left untouched`); continue; }
    const result = await recoverLedger(entry, { clusterSystemId, query });
    if (result.done) { rmSync(file, { force: true }); recovered++; console.log(`[h5-recover] ${label}: recovered (${result.stopped} dev server group(s) stopped, owned database/roles removed)`); }
    else if (result.skipped) { untouched++; console.log(`[h5-recover] ${label}: ${result.problems[0]}`); }
    else { failed++; console.error(`[h5-recover] ${label}: NOT recovered:`); for (const p of result.problems) console.error(`    ${p}`); }
  }
} catch (error) {
  failed++;
  console.error(`[h5-recover] FAIL: ${error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]").slice(0, 200) : "error"}`);
} finally { await client.end().catch(() => {}); }
console.log(`[h5-recover] ${recovered} recovered, ${untouched} left untouched (not this cluster's / still running), ${failed} could not be recovered`);
process.exit(failed ? 1 : 0);
