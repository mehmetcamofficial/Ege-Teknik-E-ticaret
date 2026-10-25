/**
 * Launcher for the local `next dev` server used by the real-HTTP test suites (checkout, H4, H5, PR #37 worker).
 *
 * Why it exists: every suite used to pick a RANDOM port in a narrow range (43000-44999), never checked that it was free and never retried,
 * so one collision ("listen EADDRINUSE", GitHub Actions run 40134106935 attempt 1) failed the whole job. The port is now assigned by the
 * operating system (`next dev -p 0`) and read from Next's own banner, so there is no check-then-use window. Details:
 *
 *   - loopback only (-H 127.0.0.1); a banner that names any other host is not accepted;
 *   - if the server still dies with EADDRINUSE before it is ready, the attempt is cleaned up and retried, at most `attempts` times
 *     (default 3). Every OTHER failure (spawn error, any other early exit, readiness timeout) is thrown at once, never retried or hidden;
 *   - every attempt runs in its OWN process group and is always cleaned up: SIGTERM to the group, then SIGKILL after `graceMs`. This is
 *     needed because `next dev` is a parent plus a `next-server` child that owns the socket, and the child SURVIVES a SIGKILL of the parent;
 *   - the groups are also killed when the test process exits or receives SIGINT/SIGTERM (unless the suite handles the signal itself, to finish
 *     an async cleanup first: then the suite exits, and the groups are still killed at exit);
 *   - nothing here prints, and no message carries the environment, a URL or server output.
 *
 * Returns { port, pid, base, stop }: `stop()` is idempotent and resolves only when the whole group is gone (it throws if it cannot be).
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
/** @typedef {import("node:child_process").ChildProcess} ChildProcess */

const BANNER = /Local:\s+https?:\/\/127\.0\.0\.1:(\d{1,5})\b/;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const DEFAULT_COMMAND = [process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "0"]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const live = new Set();
let hooked = false;
const exited = (child) => child.exitCode !== null || child.signalCode !== null;
/** Linux /proc/<pid>/stat -> { state, pgrp } (counted from the LAST ")": the process name may contain spaces and parentheses); null if unparseable. */
export function parseProcStat(text) {
  const rest = text.slice(text.lastIndexOf(")") + 2).split(" ");
  return /^[A-Za-z]$/.test(rest[0] ?? "") && /^\d+$/.test(rest[2] ?? "") ? { state: rest[0], pgrp: Number(rest[2]) } : null;
}
const hasProc = existsSync("/proc/self/stat");
/**
 * Does the process group still have a member? kill(-pgid, 0) also succeeds for ZOMBIES, and under a PID 1 that never wait()s (a bare container)
 * the orphaned next-server stays a zombie for ever after it was killed. On Linux a group therefore counts as alive only with a non-zombie member.
 */
const groupAlive = (child) => {
  try { process.kill(-child.pid, 0); } catch { return false; }
  if (!hasProc) return true;
  return readdirSync("/proc").some((entry) => {
    if (!/^\d+$/.test(entry)) return false;
    try { const stat = parseProcStat(readFileSync(`/proc/${entry}/stat`, "utf8")); return Boolean(stat) && stat.pgrp === child.pid && stat.state !== "Z"; } catch { return false; }   // vanished meanwhile
  });
};
const killGroup = (child, signal) => {
  try { process.kill(-child.pid, signal); return; } catch { /* not a group leader or already gone */ }
  try { child.kill(signal); } catch { /* already gone */ }
};
const hook = () => {
  if (hooked) return;
  hooked = true;
  process.on("exit", () => { for (const child of live) killGroup(child, "SIGKILL"); });
  // A suite that registered its OWN handler (to finish an async cleanup first) is responsible for exiting; the launcher then does not exit under
  // it. Its stop() still reaps the groups and the "exit" hook above kills anything left once it does. Without such a handler: exit at once.
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) process.on(signal, () => { if (process.listenerCount(signal) <= 1) process.exit(code); });
};

/**
 * SIGTERM the whole group, SIGKILL after graceMs; resolves when no member is left, throws if one cannot be stopped.
 * @param {ChildProcess} child
 * @param {number} [graceMs]
 */
export async function stopServerProcess(child, graceMs = 4000) {
  const gone = () => child.pid === undefined || (exited(child) && !groupAlive(child));   // no pid: spawn itself failed
  if (!gone()) {
    killGroup(child, "SIGTERM");
    for (const end = Date.now() + graceMs; !gone() && Date.now() < end;) await sleep(50);
  }
  if (!gone()) {
    killGroup(child, "SIGKILL");
    for (const end = Date.now() + 3000; !gone() && Date.now() < end;) await sleep(50);
  }
  live.delete(child);
  if (!gone()) throw new Error("local server process group did not exit");
}

/**
 * @typedef {{ port: number, pid: number, base: string, stop: () => Promise<void> }} RunningServer
 * @param {{ env: Record<string, string | undefined>, onOutput?: (text: string) => void, attempts?: number, readyTimeoutMs?: number,
 *   pollMs?: number, graceMs?: number, command?: [string, string[]], spawnFn?: (command: string, args: string[], options: object) => ChildProcess,
 *   fetchFn?: (url: string, init?: object) => Promise<{ status: number }> }} options
 * @returns {Promise<RunningServer>}
 */
export async function startNextDev({ env, onOutput = () => {}, attempts = 3, readyTimeoutMs = 120_000, pollMs = 1000, graceMs = 4000,
  command = DEFAULT_COMMAND, spawnFn = spawn, fetchFn = fetch }) {
  hook();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const child = spawnFn(command[0], command[1], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    live.add(child);
    let output = "", spawnError = null;
    const closed = new Promise((resolve) => child.once("close", resolve));
    const sink = (chunk) => { const text = chunk.toString(); output = (output + text).slice(-20_000); onOutput(text); };
    child.stdout.on("data", sink);
    child.stderr.on("data", sink);
    child.once("error", (error) => { spawnError = error; });
    let failure = null;                       // null while still waiting; set to a reason once this attempt cannot succeed
    let port = 0;
    for (const end = Date.now() + readyTimeoutMs; failure === null && Date.now() < end;) {
      if (spawnError) { failure = { kind: "spawn", detail: spawnError.code ?? "error" }; break; }
      if (exited(child)) {
        await Promise.race([closed, sleep(1500)]);   // let the last output arrive before looking for the address-in-use signature
        failure = /EADDRINUSE/.test(output.replace(ANSI, "")) ? { kind: "in_use" } : { kind: "exit", detail: child.exitCode ?? child.signalCode };
        break;
      }
      if (!port) { const match = BANNER.exec(output.replace(ANSI, "")); if (match) port = Number(match[1]); }
      if (port) {
        try {
          const response = await fetchFn(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
          if (response.status < 500) return { port, pid: /** @type {number} */ (child.pid), base: `http://127.0.0.1:${port}`, stop: () => stopServerProcess(child, graceMs) };
        } catch { /* compiling or starting */ }
      }
      await sleep(pollMs);
    }
    if (failure === null) failure = { kind: "timeout" };
    await stopServerProcess(child, graceMs);    // every failed attempt leaves nothing behind, before anything else happens
    if (failure.kind === "in_use") {
      if (attempt < attempts) continue;
      throw new Error(`local Next server could not bind a port: address in use on all ${attempts} attempts`);
    }
    if (failure.kind === "spawn") throw new Error(`local Next server could not be started (${failure.detail})`);
    if (failure.kind === "exit") throw new Error(`local Next server exited before readiness (${failure.detail})`);
    throw new Error(`local Next server did not become ready within ${Math.round(readyTimeoutMs / 1000)}s${port ? "" : " (it never reported its port)"}`);
  }
  throw new Error("local Next server was not started");   // attempts < 1
}
