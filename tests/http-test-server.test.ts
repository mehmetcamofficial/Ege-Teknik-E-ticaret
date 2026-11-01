import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseProcStat, startNextDev } from "../scripts/http-test-server.mjs";

/**
 * Deterministic tests of the launcher the real-HTTP suites use. The "server" is a throwaway Node process, not Next: a parent that prints
 * Next's banner plus a CHILD that owns the socket (like next-server), so process groups, orphans and port release are tested for real.
 */
const dir = mkdtempSync(path.join(tmpdir(), "http-test-server-"));
/** Every fake server this file starts is tracked and its process group is killed at the end, so even a BROKEN launcher cannot leave a test hanging. */
const spawned: { pid?: number }[] = [];
const spawnTracked = (...args: Parameters<typeof spawn>) => { const child = spawn(...args); spawned.push(child); return child; };
test.after(() => {
  for (const child of spawned) if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }
  rmSync(dir, { recursive: true, force: true });
});

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const closed = (port: number) => new Promise<boolean>((resolve) => {
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.once("connect", () => { socket.destroy(); resolve(false); });
  socket.once("error", () => resolve(true));
});
const waitFor = async (condition: () => boolean, ms = 3000) => { for (const end = Date.now() + ms; !condition() && Date.now() < end;) await new Promise((r) => setTimeout(r, 25)); return condition(); };

/** Script of a parent that prints the banner for a socket owned by its CHILD; optionally ignores SIGTERM (so only SIGKILL stops it). */
const serving = (opts: { ignoreSigterm?: boolean } = {}) => {
  const trap = opts.ignoreSigterm ? "process.on('SIGTERM',()=>{});" : "";
  return `const {spawn}=require('node:child_process');
const kid=spawn(process.execPath,['-e',${JSON.stringify(`const s=require('node:http').createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1',()=>console.log('PORT '+s.address().port));${trap}`)}],{stdio:['ignore','pipe','ignore']});
kid.stdout.on('data',d=>{const m=/PORT (\\d+)/.exec(String(d));if(m){console.log('CHILD '+kid.pid);console.log('   - Local:         http://127.0.0.1:'+m[1]);}});
${trap}setInterval(()=>{},1000);`;
};
const cmd = (script: string): [string, string[]] => [process.execPath, ["-e", script]];
const quick = { pollMs: 40, graceMs: 300, readyTimeoutMs: 5000, spawnFn: spawnTracked };
const childPid = (out: string) => Number(/CHILD (\d+)/.exec(out)?.[1]);

test("the OS-assigned port is read from the banner, the server answers, and stop() leaves no process and no open port", async () => {
  let out = "";
  const handle = await startNextDev({ env: { PATH: process.env.PATH }, command: cmd(serving()), onOutput: (t: string) => { out += t; }, ...quick });
  const kid = childPid(out);
  try {
    assert.ok(handle.port > 0 && handle.base === `http://127.0.0.1:${handle.port}`);
    assert.equal((await fetch(handle.base)).status, 200);
    assert.ok(alive(kid) && !(await closed(handle.port)));
  } finally { await handle.stop(); }
  assert.ok(await waitFor(() => !alive(kid) && !alive(handle.pid)), "parent and child are gone");
  assert.ok(await closed(handle.port), "the port is closed");
  await handle.stop();   // idempotent
});

test("1: the first attempt hits EADDRINUSE and is retried; the failed attempt leaves nothing behind", async () => {
  const marker = path.join(dir, "attempt1");
  const script = `const fs=require('node:fs');if(!fs.existsSync(${JSON.stringify(marker)})){fs.writeFileSync(${JSON.stringify(marker)},'x');console.error('Error: listen EADDRINUSE: address already in use 127.0.0.1:43062');process.exit(1);}${serving()}`;
  let spawns = 0;
  const handle = await startNextDev({ env: { PATH: process.env.PATH }, command: cmd(script),
    ...quick, spawnFn: (...a: Parameters<typeof spawn>) => { spawns++; return spawnTracked(...a); } });
  try { assert.equal(spawns, 2, "exactly one retry"); assert.equal((await fetch(handle.base)).status, 200); } finally { await handle.stop(); }
  assert.ok(await closed(handle.port));
});

test("2 and 8: EADDRINUSE on every attempt fails after exactly `attempts` tries (bounded, no loop), with no process left", async () => {
  const counter = path.join(dir, "attempts2");
  writeFileSync(counter, "");
  const script = `require('node:fs').appendFileSync(${JSON.stringify(counter)},'x');console.error('listen EADDRINUSE: address already in use');process.exit(1);`;
  await assert.rejects(startNextDev({ env: { PATH: process.env.PATH }, command: cmd(script), attempts: 3, ...quick }), /address in use on all 3 attempts/);
  assert.equal(readFileSync(counter, "utf8").length, 3, "three spawns, then stop");
  await assert.rejects(startNextDev({ env: { PATH: process.env.PATH }, command: cmd(script), attempts: 1, ...quick }), /address in use on all 1 attempts/);
  await assert.rejects(startNextDev({ env: {}, command: cmd(script), attempts: 0 }), /was not started/);
});

test("3 and 4: any failure other than EADDRINUSE is thrown at once and never retried (spawn error, crash, silent exit 0)", async () => {
  const counter = path.join(dir, "attempts3");
  writeFileSync(counter, "");
  const crash = `require('node:fs').appendFileSync(${JSON.stringify(counter)},'x');console.error('SyntaxError: boom');process.exit(2);`;
  await assert.rejects(startNextDev({ env: { PATH: process.env.PATH }, command: cmd(crash), attempts: 5, ...quick }), /exited before readiness \(2\)/);
  assert.equal(readFileSync(counter, "utf8").length, 1, "not retried");
  await assert.rejects(startNextDev({ env: { PATH: process.env.PATH }, command: cmd("process.exit(0)"), attempts: 5, ...quick }), /exited before readiness \(0\)/);
  const started = Date.now();
  await assert.rejects(startNextDev({ env: {}, command: ["/definitely/not/a/binary", []], attempts: 5, ...quick }), /could not be started \(ENOENT\)/);
  assert.ok(Date.now() - started < 3000, "a failed spawn does not wait out the grace periods");
});

test("5: a server that never becomes ready (banner, but nothing answers) times out, is killed and leaves no process", async () => {
  const script = `const {spawn}=require('node:child_process');const kid=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('CHILD '+kid.pid);console.log('   - Local:         http://127.0.0.1:9');setInterval(()=>{},1000);`;
  let out = "";
  await assert.rejects(startNextDev({ env: { PATH: process.env.PATH }, command: cmd(script), onOutput: (t: string) => { out += t; }, ...quick, readyTimeoutMs: 700 }), /did not become ready within 1s$/);
  assert.ok(await waitFor(() => !alive(childPid(out))), "even the child that never listened is gone");
});

test("5b: no banner at all, or a banner naming another host, is never accepted", async () => {
  await assert.rejects(startNextDev({ env: { PATH: process.env.PATH }, command: cmd("setInterval(()=>{},1000)"), ...quick, readyTimeoutMs: 500 }), /never reported its port/);
  await assert.rejects(startNextDev({ env: { PATH: process.env.PATH }, command: cmd("console.log('   - Local:         http://10.0.0.5:3000');setInterval(()=>{},1000)"), ...quick, readyTimeoutMs: 500 }), /never reported its port/);
});

test("6 and 7: the parent is SIGKILLed mid-test; stop() still removes the surviving child (the next-server orphan) and its port", async () => {
  let out = "";
  const handle = await startNextDev({ env: { PATH: process.env.PATH }, command: cmd(serving()), onOutput: (t: string) => { out += t; }, ...quick });
  const kid = childPid(out);
  process.kill(handle.pid, "SIGKILL");
  assert.ok(await waitFor(() => !alive(handle.pid)));
  assert.ok(alive(kid) && !(await closed(handle.port)), "precondition: the orphan really survives its parent and still holds the port");
  await handle.stop();
  assert.ok(await waitFor(() => !alive(kid)), "the orphan is killed");
  assert.ok(await closed(handle.port), "and the port is released");
});

test("7b: a server that ignores SIGTERM is escalated to SIGKILL within the grace period", async () => {
  let out = "";
  const handle = await startNextDev({ env: { PATH: process.env.PATH }, command: cmd(serving({ ignoreSigterm: true })), onOutput: (t: string) => { out += t; }, ...quick, graceMs: 300 });
  const kid = childPid(out), started = Date.now();
  await handle.stop();
  assert.ok(Date.now() - started < 3000, "bounded");
  assert.ok(await waitFor(() => !alive(kid) && !alive(handle.pid)));
  assert.ok(await closed(handle.port));
});

test("neither a failure message nor the callbacks leak environment values or server output into the error", async () => {
  const script = "console.error('token=hunter2-supersecret');process.exit(3)";
  await assert.rejects(startNextDev({ env: { PATH: process.env.PATH, DB_PASSWORD: "hunter2-supersecret" }, command: cmd(script), ...quick }), (error: Error) => {
    assert.doesNotMatch(error.message, /hunter2|supersecret|postgres/);
    return true;
  });
});

test("all four real-HTTP suites use the launcher; no fixed or random port range, no hand-rolled spawn of next dev remains", () => {
  const runners = ["scripts/test-checkout-http-e2e.mjs", "scripts/test-h4-checkout-http.mjs", "scripts/test-h5-notifications-http.mjs", "scripts/test-pr37-worker-http.mjs"];
  for (const file of runners) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /import \{ startNextDev \} from "\.\/http-test-server\.mjs";/, `${file} uses the shared launcher`);
    assert.match(source, /await startNextDev\(\{/, `${file} starts the server through it`);
    assert.doesNotMatch(source, /Math\.random\(\) \* 1000/, `${file} no longer picks a random port range`);
    assert.doesNotMatch(source, /port \+= 1|"-p", String\(port\)/, `${file} no longer increments or passes a chosen port`);
    assert.doesNotMatch(source, /node_modules\/next\/dist\/bin\/next/, `${file} does not spawn next dev itself`);
    assert.doesNotMatch(source, /\.kill\("SIGTERM"\)/, `${file} does not hand-roll a partial cleanup`);
  }
  const helper = readFileSync("scripts/http-test-server.mjs", "utf8");
  assert.match(helper, /"-H", "127\.0\.0\.1", "-p", "0"/, "loopback only, port assigned by the operating system");
  assert.match(helper, /detached: true/, "own process group");
  assert.match(helper, /killGroup\(child, "SIGKILL"\)/, "escalates to SIGKILL");
  assert.match(helper, /\/EADDRINUSE\/\.test/, "only the address-in-use signature is retried");
  assert.doesNotMatch(helper, /while \(true\)|for \(;;\)/, "no unbounded loop");
});

/** A separate test process that starts a fake server through the launcher and then waits to be signalled. */
const signalled = async (signal: NodeJS.Signals, suiteHandler: boolean) => {
  const marker = path.join(dir, `marker-${signal}-${suiteHandler}`);
  const body = `const { startNextDev } = await import(${JSON.stringify(new URL("../scripts/http-test-server.mjs", import.meta.url).href)});
const h = await startNextDev({ env: { PATH: process.env.PATH }, command: [process.execPath, ["-e", process.env.FAKE]], pollMs: 40, graceMs: 300, readyTimeoutMs: 5000,
  onOutput: (t) => { const m = /CHILD (\\d+)/.exec(t); if (m) console.log("KID " + m[1]); } });
console.log("PORT " + h.port + " PID " + h.pid);
${suiteHandler ? `process.on(${JSON.stringify(signal)}, async () => { await new Promise((r) => setTimeout(r, 500)); (await import("node:fs")).writeFileSync(${JSON.stringify(marker)}, "cleaned"); await h.stop(); process.exit(7); });` : ""}
setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", body], { env: { PATH: process.env.PATH, FAKE: serving() } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  child.stdout.on("data", (c) => { out += c; });
  assert.ok(await waitFor(() => /PORT \d+ PID \d+/.test(out) && /KID \d+/.test(out), 8000), "the child started its fake server");
  const [, port, pid] = /PORT (\d+) PID (\d+)/.exec(out)!.map(Number) as unknown as [string, number, number];
  const kid = Number(/KID (\d+)/.exec(out)![1]);
  const exit = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  child.kill(signal);
  const code = await Promise.race([exit, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 8000))]);
  if (code === "timeout") child.kill("SIGKILL");
  return { code, kid, port, pid, marker };
};

test("a signal without a suite handler exits at once with the signal code and still kills the server group", async () => {
  for (const [signal, expected] of [["SIGTERM", 143], ["SIGINT", 130]] as const) {
    const r = await signalled(signal, false);
    assert.equal(r.code, expected, signal);
    assert.ok(await waitFor(() => !alive(r.kid) && !alive(r.pid)), `${signal}: parent and the child that owns the socket are gone`);
    assert.ok(await closed(r.port), `${signal}: the port is released`);
  }
});

test("a suite that handles the signal itself gets to finish its cleanup: the launcher does not exit underneath it", async () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const r = await signalled(signal, true);
    assert.equal(r.code, 7, `${signal}: the suite's own handler decided the exit code`);
    assert.equal(existsSync(r.marker) && readFileSync(r.marker, "utf8"), "cleaned", `${signal}: the async part of the cleanup ran to the end`);
    assert.ok(await waitFor(() => !alive(r.kid) && !alive(r.pid)), `${signal}: nothing left`);
    assert.ok(await closed(r.port));
  }
});

test("the Linux group check reads state and group from /proc/<pid>/stat counted from the last parenthesis, so zombies and odd names are classified right", () => {
  const tail = "1 4321 4321 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 1 0 987654 1000000 200";   // ppid pgrp session ...
  assert.deepEqual(parseProcStat(`77 (next-server (v16.3.6)) S ${tail}`), { state: "S", pgrp: 4321 });
  assert.deepEqual(parseProcStat(`77 (a b) c) Z ${tail}`), { state: "Z", pgrp: 4321 }, "a zombie is recognisable (and is not a live member of the group)");
  assert.deepEqual(parseProcStat(`77 (node) R ${tail}`), { state: "R", pgrp: 4321 });
  assert.equal(parseProcStat("garbage"), null);
  assert.equal(parseProcStat("77 (node) S 1 notanumber 4321"), null);
});

test("the group-liveness check ignores zombies on Linux (a PID 1 that never wait()s would otherwise make stop() fail on an already killed server)", () => {
  const helper = readFileSync("scripts/http-test-server.mjs", "utf8");
  assert.match(helper, /return Boolean\(stat\) && stat\.pgrp === child\.pid && stat\.state !== "Z";/);
  assert.match(helper, /if \(!hasProc\) return true;/, "other platforms keep the plain kill(-pgid, 0) answer");
});
