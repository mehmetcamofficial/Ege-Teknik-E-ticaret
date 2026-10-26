import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openLedger, processStart, readLedgers, recoverLedger, releaseOwned, startTimeFromProcStat } from "../scripts/test-resource-ledger.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "ledger-test-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const waitFor = async (condition: () => boolean, ms = 3000) => { for (const end = Date.now() + ms; !condition() && Date.now() < end;) await new Promise((r) => setTimeout(r, 25)); return condition(); };

type Row = Record<string, string>;
/** A fake catalog: databases and roles with oids, recording every statement that would change something. */
const fakeCluster = (catalog: { databases?: Record<string, string>; roles?: Record<string, string> }, failOn?: { sql: RegExp; code: string; message: string }) => {
  const statements: string[] = [];
  const query = async (text: string, params?: unknown[]): Promise<{ rows: Row[] }> => {
    if (/FROM pg_database WHERE datname/.test(text)) { const oid = catalog.databases?.[String(params?.[0])]; return { rows: oid ? [{ oid }] : [] }; }
    if (/FROM pg_roles WHERE rolname/.test(text)) { const oid = catalog.roles?.[String(params?.[0])]; return { rows: oid ? [{ oid }] : [] }; }
    statements.push(text);
    if (failOn?.sql.test(text)) throw Object.assign(new Error(failOn.message), { code: failOn.code });
    return { rows: [] };
  };
  return { query, statements };
};

test("a ledger is private (0600 file in a 0700 directory), written atomically and carries the owner's identity before anything exists", () => {
  const ledger = openLedger({ suite: "unit", systemId: "7001", dir });
  assert.match(ledger.nonce, /^[0-9a-f]{12}$/);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(ledger.file).mode & 0o777, 0o600);
  const saved = JSON.parse(readFileSync(ledger.file, "utf8"));
  assert.deepEqual([saved.version, saved.suite, saved.systemId, saved.pid, saved.databases, saved.roles, saved.servers], [1, "unit", "7001", process.pid, [], [], []]);
  assert.ok(saved.pidStart, "the owner's start time is recorded (defeats pid reuse)");
  ledger.state.roles.push({ name: "sprintb_unit_x", oid: "42" }); ledger.save();
  assert.equal(JSON.parse(readFileSync(ledger.file, "utf8")).roles[0].oid, "42");
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".tmp")), [], "no half-written file is left");
  assert.notEqual(openLedger({ suite: "unit", systemId: "7001", dir }).nonce, ledger.nonce, "every run has its own nonce");
  ledger.remove(); assert.equal(existsSync(ledger.file), false);
});

test("releaseOwned drops a database and roles only when the CURRENT oid equals the recorded one, roles in reverse order", async () => {
  const c = fakeCluster({ databases: { sprintb_h5_a: "100" }, roles: { sprintb_h5_a_store: "201", sprintb_h5_a_wlogin: "204" } });
  const problems = await releaseOwned({ query: c.query, databases: [{ name: "sprintb_h5_a", oid: "100" }], roles: [{ name: "sprintb_h5_a_store", oid: "201" }, { name: "sprintb_h5_a_wlogin", oid: "204" }] });
  assert.deepEqual(problems, []);
  assert.deepEqual(c.statements, ['DROP DATABASE "sprintb_h5_a" WITH (FORCE)', 'DROP ROLE "sprintb_h5_a_wlogin"', 'DROP ROLE "sprintb_h5_a_store"']);
});

test("an object that was dropped and re-created by someone else (same name, other oid) is never touched, and is reported", async () => {
  const c = fakeCluster({ databases: { sprintb_h5_a: "999" }, roles: { sprintb_h5_a_store: "888" } });
  const problems = await releaseOwned({ query: c.query, databases: [{ name: "sprintb_h5_a", oid: "100" }], roles: [{ name: "sprintb_h5_a_store", oid: "201" }] });
  assert.deepEqual(c.statements, [], "nothing was dropped");
  assert.equal(problems.length, 2);
  for (const p of problems) assert.match(p, /no longer the object this run created \(oid changed\), left untouched/);
});

test("names outside sprintb_ are refused outright (a tampered ledger cannot reach real objects); missing objects are fine; errors carry only a SQLSTATE", async () => {
  const c = fakeCluster({ databases: { postgres: "5" }, roles: { postgres: "10", sprintb_h5_gone_x: "300" } }, { sql: /DROP ROLE "sprintb_h5_gone_x"/, code: "2BP01", message: "role sprintb_h5_gone_x cannot be dropped because of password=hunter2" });
  const problems = await releaseOwned({ query: c.query,
    databases: [{ name: "postgres", oid: "5" }, { name: "sprintb_h5_absent", oid: "1" }, { name: 'sprintb_x"; DROP DATABASE postgres; --', oid: "1" }],
    roles: [{ name: "postgres", oid: "10" }, { name: "PUBLIC", oid: "0" }, { name: "sprintb_h5_gone_x", oid: "300" }] });
  assert.deepEqual(c.statements.filter((s) => /postgres"|PUBLIC|--/.test(s)), [], "no statement ever names a real or injected object");
  assert.equal(problems.filter((p) => /unexpected name was refused/.test(p)).length, 4);
  assert.ok(problems.includes("role sprintb_h5_gone_x: 2BP01"), "a failing drop is reported by SQLSTATE");
  assert.doesNotMatch(problems.join("|"), /hunter2|password/, "no server message reaches the report");
});

test("recoverLedger: another cluster and a live owner are left untouched; a dead owner's proven resources are released", async () => {
  const base = { systemId: "S1", pid: 4242, pidStart: "Mon Jan  1 00:00:00 2001", databases: [{ name: "sprintb_h5_a", oid: "100" }], roles: [{ name: "sprintb_h5_a_store", oid: "201" }], servers: [] as { pid: number; start: string | null }[] };
  const c1 = fakeCluster({ databases: { sprintb_h5_a: "100" } });
  const other = await recoverLedger(base, { clusterSystemId: "S2", query: c1.query, startOf: () => null });
  assert.deepEqual([other.done, other.skipped, other.problems[0]], [false, true, "belongs to another cluster, left untouched"]); assert.deepEqual(c1.statements, []);
  const live = await recoverLedger(base, { clusterSystemId: "S1", query: c1.query, startOf: () => base.pidStart });
  assert.deepEqual([live.done, live.skipped, live.problems[0]], [false, true, "the run that owns it is still running, left untouched"]); assert.deepEqual(c1.statements, []);
  const c2 = fakeCluster({ databases: { sprintb_h5_a: "100" }, roles: { sprintb_h5_a_store: "201" } });
  const done = await recoverLedger(base, { clusterSystemId: "S1", query: c2.query, startOf: () => null });
  assert.deepEqual([done.done, done.problems], [true, []]); assert.equal(c2.statements.length, 2);
});

test("recoverLedger stops a dev-server group only when pid AND start time still match, and escalates SIGTERM to SIGKILL", async () => {
  const killed: string[] = [];
  let alive = true;
  const entry = { systemId: "S1", pid: 1, pidStart: "x", databases: [], roles: [], servers: [{ pid: 777, start: "Sat Oct 25 03:45:01 2026" }, { pid: 778, start: "Sat Oct 25 03:45:01 2026" }] };
  const result = await recoverLedger(entry, { clusterSystemId: "S1", query: fakeCluster({}).query, graceMs: 120,
    startOf: (pid) => (pid === 1 ? null : pid === 777 ? (alive ? "Sat Oct 25 03:45:01 2026" : null) : "Tue Mar  3 12:00:00 2026"),   // 778 now belongs to a DIFFERENT process (pid reuse)
    killGroup: (pid, signal) => { killed.push(`${pid}:${signal}`); if (signal === "SIGKILL") alive = false; } });
  assert.deepEqual(killed, ["777:SIGTERM", "777:SIGKILL"], "only the proven group, escalated because it ignored SIGTERM; the reused pid is left alone");
  assert.equal(result.stopped, 1);
  assert.equal(result.done, true);
});

test("a malformed or unknown ledger is reported and never deleted", () => {
  const sub = mkdtempSync(path.join(dir, "bad-"));
  writeFileSync(path.join(sub, "h5-bad.json"), "{not json"); writeFileSync(path.join(sub, "h5-v2.json"), JSON.stringify({ version: 2 }));
  const found = readLedgers(sub);
  assert.deepEqual(found.map((f) => f.entry), [null, null]);
  assert.equal(readdirSync(sub).length, 2, "both files are still there");
});

test("the recovery tool refuses non-CI, non-loopback, the recovery port and a missing URL before connecting, without echoing credentials", () => {
  const run = (env: Record<string, string>) => spawnSync(process.execPath, ["scripts/h5-recover-leftovers.mjs"], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 20000 });
  const cases: [Record<string, string>, RegExp][] = [
    [{ H5_PG_URL: "postgresql://postgres:pw@127.0.0.1:1/postgres" }, /requires CI=true/],
    [{ CI: "true" }, /must be a PostgreSQL URL/],
    [{ CI: "true", H5_PG_URL: "postgresql://postgres:pw@db.example.test:5432/postgres" }, /loopback PostgreSQL URL required/],
    [{ CI: "true", H5_PG_URL: "postgresql://postgres:pw@127.0.0.1:55432/postgres" }, /recovery cluster port is never allowed/],
  ];
  for (const [env, expected] of cases) { const r = run(env); assert.equal(r.status, 1); assert.match(r.stderr, expected); assert.doesNotMatch(r.stdout + r.stderr, /:pw@/); }
});

test("the Linux start-time parser counts from the LAST parenthesis, so a hostile or odd process name cannot shift the fields", () => {
  const fields = "S 1 1234 1234 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 1 0 987654 1000000 200 18446744073709551615";   // state ... starttime is the 20th token
  assert.equal(startTimeFromProcStat(`4321 (node) ${fields}`), "987654");
  assert.equal(startTimeFromProcStat(`4321 (next-server (v16.3.6)) ${fields}`), "987654", "parentheses inside comm");
  assert.equal(startTimeFromProcStat(`4321 (a b) c) d) ${fields}`), "987654", "spaces and unbalanced parentheses inside comm");
  assert.equal(startTimeFromProcStat(`4321 (node) Z${fields.slice(1)}`), null, "a zombie has exited: treated as gone");
  assert.equal(startTimeFromProcStat("garbage"), undefined, "unparseable text is 'unknown', never a guess");
  assert.equal(startTimeFromProcStat(`4321 (node) ${fields.replace("987654", "x9")}`), undefined);
});

test("processStart identifies one process: stable across calls, different between processes, null once it is gone", async () => {
  const mine = processStart(process.pid);
  assert.ok(mine && mine === processStart(process.pid), "stable for the same process");
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  try {
    assert.ok(await waitFor(() => Boolean(processStart(child.pid!))), "a running child has an identity");
    assert.equal(processStart(child.pid!), processStart(child.pid!), "stable for the child too");
    // (Different processes only differ when they started in different clock units: 1 s on macOS, 10 ms ticks on Linux. What matters is that a REUSED pid
    // cannot keep the old identity, which needs the start time to change - not that two live processes never share a second.)
    if (process.platform === "linux") assert.notEqual(processStart(child.pid!), mine, "another process, another identity");
  } finally { child.kill("SIGKILL"); }
  await new Promise((r) => child.once("exit", r));
  assert.equal(processStart(child.pid!), null, "null once it has exited and been reaped");
  if (process.platform === "linux") assert.match(mine!, /^linux:[0-9a-f-]+:\d+$/, "Linux uses boot id + start ticks, not wall-clock text");
});

test("recovery refuses (fail closed) when the owner's identity was never recorded or cannot be determined", async () => {
  const entry = { systemId: "S1", pid: 4242, pidStart: "x", databases: [{ name: "sprintb_h5_a", oid: "100" }], roles: [], servers: [] };
  const c = fakeCluster({ databases: { sprintb_h5_a: "100" } });
  const unrecorded = await recoverLedger({ ...entry, pidStart: null as unknown as string }, { clusterSystemId: "S1", query: c.query, startOf: () => null });
  assert.deepEqual([unrecorded.done, unrecorded.skipped, /not recorded/.test(unrecorded.problems[0])], [false, false, true]);
  const unknown = await recoverLedger(entry, { clusterSystemId: "S1", query: c.query, startOf: () => { throw new Error("process start time unavailable"); } });
  assert.deepEqual([unknown.done, unknown.skipped, /cannot determine/.test(unknown.problems[0])], [false, false, true]);
  assert.deepEqual(c.statements, [], "in both refusals nothing was dropped: the owner was not proven gone");
  // Owner PROVEN gone + object oids match: the database is released; a dev server that cannot be identified is never signalled, and the run is reported as not fully recovered.
  const c3 = fakeCluster({ databases: { sprintb_h5_a: "100" } });
  const serverUnknown = await recoverLedger({ ...entry, servers: [{ pid: 9, start: "s" }] }, { clusterSystemId: "S1", query: c3.query,
    startOf: (pid) => { if (pid === 4242) return null; throw new Error("unavailable"); }, killGroup: () => { throw new Error("must not be called"); } });
  assert.equal(serverUnknown.done, false);
  assert.ok(serverUnknown.problems.some((p) => /could not be identified/.test(p)), "an unidentifiable dev server is never signalled");
  assert.deepEqual(c3.statements, ['DROP DATABASE "sprintb_h5_a" WITH (FORCE)'], "the proven-owned database is released");
});

test("a ledger directory that is a symlink, or not a directory, is refused; a plain one that we own is tightened to 0700", () => {
  const base = mkdtempSync(path.join(dir, "perm-"));
  const real = path.join(base, "real"); mkdirSync(real);
  const link = path.join(base, "link"); symlinkSync(real, link);
  assert.throws(() => openLedger({ suite: "unit", systemId: "1", dir: link }), /not a plain directory/);
  const file = path.join(base, "afile"); writeFileSync(file, "x");
  assert.throws(() => openLedger({ suite: "unit", systemId: "1", dir: file }), /./);
  const loose = path.join(base, "loose"); mkdirSync(loose, { mode: 0o755 }); chmodSync(loose, 0o755);
  const ledger = openLedger({ suite: "unit", systemId: "1", dir: loose });
  assert.equal(statSync(loose).mode & 0o777, 0o700);
  ledger.remove();
  assert.match(readFileSync("scripts/test-resource-ledger.mjs", "utf8"), /stat\.uid !== process\.getuid\(\)\) throw new Error\("the ledger directory belongs to another user/, "a directory owned by another user is refused");
});

test("when the process identity cannot be determined (no /proc, no usable ps) processStart THROWS instead of reporting 'gone'", { skip: process.platform === "linux" ? "Linux reads /proc and never needs ps" : false }, () => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import { processStart } from ${JSON.stringify(new URL("../scripts/test-resource-ledger.mjs", import.meta.url).href)};
try { processStart(process.pid); console.log("RETURNED"); } catch (e) { console.log("THREW " + e.message); }`], { env: { PATH: "/nonexistent" } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 20000 });
  assert.match(r.stdout, /^THREW process start time unavailable/, "an unknown identity is an error, never 'the process is gone'");
});
