/**
 * Ownership of throwaway test resources (databases, roles, dev-server process groups), proven - never assumed.
 *
 * A test suite that creates cluster-level objects must be able to remove EXACTLY those objects, also after it was killed, and must never
 * remove anything else. A comment on a role or a fixed name proves nothing (anyone can write it, and two runs would share it). So:
 *
 *   - every run uses its own random names (the caller builds them from `nonce`);
 *   - right after an object is created, the suite records its OID - the identifier PostgreSQL gives that one object - in a private ledger
 *     file (0600, in a 0700 directory) that also carries the cluster's system identifier, the owning process (pid + start time) and the
 *     dev-server process groups it started;
 *   - releasing an object, by the suite itself or by recovery after a crash, is allowed only when the object's CURRENT OID equals the
 *     recorded one. A role dropped and re-created by someone else under the same name has another OID and is left untouched;
 *   - only names beginning "sprintb_" are ever touched, so a tampered ledger cannot point this code at `postgres` or any real role;
 *   - anything that cannot be proven is left in place and reported (fail closed), never guessed.
 *
 * Nothing here prints a name, URL or credential; callers print fixed messages and counts.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const LEDGER_DIR = path.join(tmpdir(), "ege-test-resource-ledger");
const SAFE_NAME = /^sprintb_[a-z0-9_]{2,60}$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Linux: the start time in clock ticks since boot (field 22 of /proc/<pid>/stat). `comm` (field 2) may contain spaces and parentheses, so the
 * fields are counted from the LAST ")". Returns null for a zombie (it has exited), undefined when the text cannot be parsed.
 */
export function startTimeFromProcStat(text) {
  const rest = text.slice(text.lastIndexOf(")") + 2).split(" ");     // rest[0] = state (field 3)
  if (rest[0] === "Z") return null;
  return /^\d+$/.test(rest[19] ?? "") ? rest[19] : undefined;
}

/**
 * An identity for ONE process that survives pid reuse: it changes if the pid is given to another process, and (Linux) after a reboot.
 *   - Linux: boot id + start ticks from /proc - exact and independent of the wall clock (`ps -o lstart` is derived from the boot time and can
 *     move by a second when the clock is adjusted, which would make a live process look different); `ps` is not needed at all.
 *   - macOS/BSD: `ps -o lstart=` (the kernel's recorded start time).
 * Returns null when the process does not exist. THROWS when the identity cannot be determined (no /proc and no usable `ps`): callers must then
 * refuse to act, never assume the process is gone.
 */
export function processStart(pid) {
  if (existsSync("/proc/self/stat")) {
    let text;
    try { text = readFileSync(`/proc/${pid}/stat`, "utf8"); } catch (error) { if (error?.code === "ENOENT" || error?.code === "ESRCH") return null; throw new Error("process start time unavailable"); }
    const ticks = startTimeFromProcStat(text);
    if (ticks === null) return null;
    if (ticks === undefined) throw new Error("process start time unavailable");
    return `linux:${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${ticks}`;
  }
  try { return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; }
  catch (error) { if (error?.status === 1) return null; throw new Error("process start time unavailable"); }    // status 1 = no such process; anything else (ENOENT...) = unknown
}

/** A ledger directory must be a real directory that WE own: /tmp is shared, and a pre-created directory or a symlink there is not ours to trust. */
function privateDirectory(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("the ledger directory is not a plain directory: refusing to use it");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("the ledger directory belongs to another user: refusing to use it");
  chmodSync(dir, 0o700);
}

/**
 * Opens a ledger BEFORE anything is created (so a suite that cannot write one never creates a resource it could not recover).
 * @param {{ suite: string, systemId: string, dir?: string }} options
 */
export function openLedger({ suite, systemId, dir = LEDGER_DIR }) {
  privateDirectory(dir);
  const nonce = randomBytes(6).toString("hex");
  const file = path.join(dir, `${suite}-${nonce}.json`);
  const state = { version: 1, suite, nonce, systemId, pid: process.pid, pidStart: processStart(process.pid), startedAt: new Date().toISOString(),
    databases: /** @type {{name: string, oid: string}[]} */ ([]), roles: /** @type {{name: string, oid: string}[]} */ ([]), servers: /** @type {{pid: number, start: string | null}[]} */ ([]) };
  const save = () => { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 }); renameSync(tmp, file); };
  save();
  return { nonce, file, state, save, remove: () => rmSync(file, { force: true }) };
}

/**
 * Drops the recorded databases and roles, each only if its CURRENT oid equals the recorded one. Returns the problems (empty = all gone or
 * never there). `query(text, params)` must be a connection that is NOT inside a transaction and is not connected to a database being dropped.
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>, databases?: {name: string, oid: string}[], roles?: {name: string, oid: string}[] }} input
 * @returns {Promise<string[]>}
 */
export async function releaseOwned({ query, databases = [], roles = [] }) {
  const problems = [];
  const one = async (kind, item, catalog, column, drop) => {
    if (!SAFE_NAME.test(item.name)) { problems.push(`${kind}: an unexpected name was refused`); return; }
    try {
      const row = (await query(`SELECT oid::text AS oid FROM ${catalog} WHERE ${column} = $1`, [item.name])).rows[0];
      if (!row) return;                                                                  // already gone
      if (row.oid !== item.oid) { problems.push(`${kind} ${item.name}: no longer the object this run created (oid changed), left untouched`); return; }
      await query(drop(item.name));
    } catch (error) { problems.push(`${kind} ${item.name}: ${/^[0-9A-Z]{5}$/.test(error?.code ?? "") ? error.code : "failed"}`); }
  };
  for (const db of databases) await one("database", db, "pg_database", "datname", (n) => `DROP DATABASE "${n}" WITH (FORCE)`);
  for (const role of [...roles].reverse()) await one("role", role, "pg_roles", "rolname", (n) => `DROP ROLE "${n}"`);
  return problems;
}

/**
 * Recovery of ONE ledger left by a run that could not clean up (SIGKILL, crash, power loss). Touches nothing unless: the ledger belongs to
 * this cluster, its owner process is gone, and each object still carries the recorded oid; dev servers are stopped only when pid AND start
 * time still match. Returns { done, problems, stopped }; when `done` the caller removes the ledger.
 * @param {{ systemId: string, pid: number, pidStart: string | null, databases: {name: string, oid: string}[], roles: {name: string, oid: string}[], servers: {pid: number, start: string | null}[] }} entry
 * @param {{ clusterSystemId: string, query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>, startOf?: (pid: number) => string | null,
 *   killGroup?: (pid: number, signal: "SIGTERM" | "SIGKILL") => void, graceMs?: number }} deps
 */
export async function recoverLedger(entry, { clusterSystemId, query, startOf = processStart, killGroup = (pid, signal) => process.kill(-pid, signal), graceMs = 3000 }) {
  if (entry.systemId !== clusterSystemId) return { done: false, skipped: true, problems: ["belongs to another cluster, left untouched"], stopped: 0 };
  // Whether the owner still runs must be PROVEN either way: an unrecorded or undeterminable identity is a refusal, not "probably dead".
  if (!entry.pidStart) return { done: false, skipped: false, problems: ["the owning run's identity was not recorded: cannot prove it is gone, left untouched"], stopped: 0 };
  try { if (startOf(entry.pid) === entry.pidStart) return { done: false, skipped: true, problems: ["the run that owns it is still running, left untouched"], stopped: 0 }; }
  catch { return { done: false, skipped: false, problems: ["cannot determine whether the owning run is still alive, left untouched"], stopped: 0 }; }
  let stopped = 0;
  const problems = [];
  for (const server of entry.servers) {
    try {
      if (!server.start || startOf(server.pid) !== server.start) continue;              // gone, or the pid belongs to something else now
      try { killGroup(server.pid, "SIGTERM"); } catch { /* group already gone */ }
      for (const end = Date.now() + graceMs; startOf(server.pid) === server.start && Date.now() < end;) await sleep(50);
      if (startOf(server.pid) === server.start) { try { killGroup(server.pid, "SIGKILL"); } catch { /* gone */ } await sleep(100); }
      stopped++;
    } catch { problems.push("a dev-server process could not be identified: left untouched"); }
  }
  problems.push(...await releaseOwned({ query, databases: entry.databases, roles: entry.roles }));
  return { done: problems.length === 0, skipped: false, problems, stopped };
}

/** Reads every ledger in `dir` (unreadable or malformed files are reported, never deleted). */
export function readLedgers(dir = LEDGER_DIR) {
  const out = [];
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(".json")); } catch { return out; }
  for (const name of names) {
    const file = path.join(dir, name);
    try { const entry = JSON.parse(readFileSync(file, "utf8")); out.push({ file, entry: entry?.version === 1 ? entry : null }); } catch { out.push({ file, entry: null }); }
  }
  return out;
}
