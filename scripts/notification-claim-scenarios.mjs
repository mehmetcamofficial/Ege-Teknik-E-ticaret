/**
 * R-03 claim-ownership scenarios for the notification outbox, run against REAL PostgreSQL with a fake provider (no network, no e-mail).
 *
 * Shared by scripts/test-pr37-worker-http.mjs (dispatch runs through the dedicated worker role, so the fenced statements are proven under the
 * narrow ACL) and by ad-hoc runs against older code. Every scenario seeds its own order and outbox row, drives two or three "workers"
 * (calls of dispatchOutbox with an injected clock and a provider whose answer the scenario controls) and then checks the ROW and the AUDIT
 * lines - what the database ends up saying - separately from how many provider calls happened. The provider call itself cannot be made
 * atomic with a database transaction; what is guaranteed is that the database never records a result for a claim that is no longer owned.
 *
 * Nothing here prints a recipient, URL or credential.
 */
import assert from "node:assert/strict";

const UUIDISH = () => crypto.randomUUID();

/**
 * @param {{ dispatchOutbox: Function, requeueDeadNotification: Function, db: unknown, ownerDb: unknown,
 *   owner: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[], rowCount: number | null }> },
 *   env: Record<string, string | undefined>, lockSeconds: number, maxAttempts: number, concurrency?: number }} ctx
 * @returns {Promise<{ name: string, ok: boolean, detail: string }[]>}
 */
export async function runClaimFencingScenarios(ctx) {
  const { dispatchOutbox, requeueDeadNotification, db, ownerDb, owner, env, lockSeconds, maxAttempts } = ctx;
  const racers = ctx.concurrency ?? 5;                               // the worker login has a connection limit: the harness passes fewer
  const run = UUIDISH().slice(0, 8);
  const T0 = new Date(Date.now() + 120_000);                        // later than every next_attempt_at the database stamps while seeding
  const at = (seconds) => new Date(T0.getTime() + seconds * 1000);
  const T1 = at(lockSeconds + 1);                                    // just after A's lease expired
  const wait = async (ok) => { for (let i = 0; !ok(); i++) { if (i > 500) throw new Error("timed out waiting for a provider call"); await new Promise((r) => setTimeout(r, 10)); } };
  const keysSeen = [];                                               // every (row, idempotency key) the fake providers received

  /** A provider whose answers the scenario controls. `mode`: "ok" | {ok:false,...} | "block" (every call waits for release) | "block-once" (only the first call waits). */
  const provider = (name, calls, mode = "ok") => {
    let release, blocked = false;
    return {
      calls, release: (answer) => { release?.(answer); },
      send: async (message) => {
        calls.push({ name, key: message.idempotencyKey }); keysSeen.push(message.idempotencyKey);
        if (mode === "block-once" && blocked) return { ok: true };
        if (mode !== "block" && mode !== "block-once") return mode === "ok" ? { ok: true } : mode;
        blocked = true;
        return new Promise((resolve) => { release = resolve; });
      },
    };
  };
  const seed = async (tag, kinds = ["order_customer_received"]) => {
    const orderId = `r03-${run}-${tag}`;
    await owner.query("INSERT INTO orders (id, order_number, idempotency_key, customer_name, phone, city, address, email) VALUES ($1,$1,$1,'Test','05550000000','Izmir','Addr','buyer@example.test')", [orderId]);
    const ids = [];
    for (const kind of kinds) {
      const id = `ob-${run}-${tag}-${kind}`; ids.push(id);
      await owner.query("INSERT INTO notification_outbox (id, kind, order_id, dedupe_key) VALUES ($1,$2,$3,$4)", [id, kind, orderId, `order:${orderId}:${kind}`]);
    }
    return { orderId, id: ids[0], ids };
  };
  const row = async (id) => (await owner.query("SELECT status, attempts, claim_token, last_error_code, sent_at IS NOT NULL AS has_sent_at, locked_until FROM notification_outbox WHERE id = $1", [id])).rows[0];
  const audits = async (id) => (await owner.query("SELECT action || '#' || coalesce(payload->>'attempts', '-') AS a FROM audit_logs WHERE entity_id = $1 AND action LIKE 'notification_%' ORDER BY created_at, id", [id])).rows.map((r) => r.a);
  const dispatch = (p, now, limit = 20) => dispatchOutbox({ db, provider: p, env, now, limit });
  // The worker logs a line for a lost claim and for a failed row; silence it while a scenario runs. Reference-counted: concurrent calls must not restore a no-op as the "original".
  const realWarn = console.warn, realError = console.error; let quietDepth = 0;
  const quiet = async (fn) => { quietDepth++; console.warn = () => {}; console.error = () => {}; try { return await fn(); } finally { if (--quietDepth === 0) { console.warn = realWarn; console.error = realError; } } };

  // Rows left over from earlier suites must not be claimed by these workers: park every non-terminal row (the CHECK ties the token to 'sending').
  await owner.query("UPDATE notification_outbox SET status = 'dead', last_error_code = 'r03_isolated', locked_until = NULL, claim_token = NULL WHERE status IN ('pending','sending')");

  const scenarios = [
    ["V1 late SUCCESS of A after B re-claimed and delivered: one result, one audit line", async () => {
      const { id } = await seed("v1"), calls = [], A = provider("A", calls, "block"), B = provider("B", calls);
      const pA = quiet(() => dispatch(A, T0)); await wait(() => calls.length >= 1);
      await quiet(() => dispatch(B, T1));
      A.release({ ok: true }); await pA;
      const r = await row(id), a = await audits(id);
      assert.equal(r.status, "sent"); assert.equal(r.attempts, 2); assert.equal(r.claim_token, null);
      assert.deepEqual(a, ["notification_sent#2"], `exactly B's result is audited, got ${JSON.stringify(a)}`);
      return `provider calls ${calls.length} (A was already mid-send), audit ${JSON.stringify(a)}`;
    }],
    ["V2 late NON-RETRYABLE failure of A while B is mid-send cannot kill B's row", async () => {
      const { id } = await seed("v2"), calls = [], A = provider("A", calls, "block"), B = provider("B", calls, "block");
      const pA = quiet(() => dispatch(A, T0)); await wait(() => calls.length >= 1);
      const pB = quiet(() => dispatch(B, T1)); await wait(() => calls.length >= 2);
      A.release({ ok: false, retryable: false, code: "late_a_failure" }); await pA;
      const mid = await row(id);
      assert.equal(mid.status, "sending", "A's late result did not move B's claim"); assert.notEqual(mid.claim_token, null);
      B.release({ ok: true }); await pB;
      const r = await row(id), a = await audits(id);
      assert.equal(r.status, "sent"); assert.equal(r.last_error_code, null);
      assert.deepEqual(a, ["notification_sent#2"], `no dead audit, got ${JSON.stringify(a)}`);
      return `row ${r.status}, audit ${JSON.stringify(a)}`;
    }],
    ["V3 late RETRYABLE failure of A while B is mid-send cannot reschedule B's row (no third send)", async () => {
      const { id } = await seed("v3"), calls = [], A = provider("A", calls, "block"), B = provider("B", calls, "block");
      const pA = quiet(() => dispatch(A, T0)); await wait(() => calls.length >= 1);
      const pB = quiet(() => dispatch(B, T1)); await wait(() => calls.length >= 2);
      A.release({ ok: false, retryable: true, code: "late_a_timeout" }); await pA;
      B.release({ ok: true }); await pB;
      const C = provider("C", calls); await quiet(() => dispatch(C, at(lockSeconds + 3700)));
      const r = await row(id), a = await audits(id);
      assert.equal(r.status, "sent"); assert.equal(calls.length, 2, `no third provider call, got ${calls.length}`);
      assert.deepEqual(a, ["notification_sent#2"], `got ${JSON.stringify(a)}`);
      return `provider calls ${calls.length}, audit ${JSON.stringify(a)}`;
    }],
    ["two workers claim the same row at the same moment: exactly one claims and sends", async () => {
      const { id } = await seed("race"), calls = [], ps = Array.from({ length: racers }, (_, n) => provider(`W${n + 1}`, calls));
      const results = await quiet(() => Promise.all(ps.map((p) => dispatch(p, T0))));
      assert.equal(results.reduce((n, x) => n + x.processed, 0), 1, "one claim in total"); assert.equal(calls.length, 1);
      const r = await row(id); assert.equal(r.status, "sent"); assert.equal(r.attempts, 1);
      assert.deepEqual(await audits(id), ["notification_sent#1"]);
      return `${racers} concurrent workers, 1 claim, 1 provider call, 1 audit line`;
    }],
    ["worker crash: the lease expires, another worker recovers the row once; the crashed worker's late answer is ignored", async () => {
      const { id } = await seed("crash"), calls = [], A = provider("A", calls, "block"), B = provider("B", calls);
      const pA = quiet(() => dispatch(A, T0)); await wait(() => calls.length >= 1);                  // A "crashes": it never answers
      assert.equal((await quiet(() => dispatch(B, at(lockSeconds - 5)))).processed, 0, "the lease protects the row while it is valid");
      await quiet(() => dispatch(B, T1));
      const r = await row(id); assert.equal(r.status, "sent"); assert.equal(r.attempts, 2);
      A.release({ ok: true }); await pA;
      assert.deepEqual(await audits(id), ["notification_sent#2"], "A's answer after the crash is not recorded");
      return "recovered on attempt 2, one audit line";
    }],
    ["provider timeout: retry is scheduled with the existing delay, then delivered; the idempotency key never changes", async () => {
      const { id, orderId } = await seed("timeout"), calls = [];
      const first = provider("A", calls, { ok: false, retryable: true, code: "timeout" });
      const res = await quiet(() => dispatch(first, T0)); assert.equal(res.retried, 1);
      let r = await row(id); assert.equal(r.status, "pending"); assert.equal(r.last_error_code, "timeout"); assert.equal(r.claim_token, null);
      assert.equal((await quiet(() => dispatch(provider("B", calls), at(30)))).processed, 0, "not due before the 60 s delay");
      await quiet(() => dispatch(provider("B", calls), at(61)));
      r = await row(id); assert.equal(r.status, "sent"); assert.equal(r.attempts, 2);
      assert.deepEqual(await audits(id), ["notification_retry_scheduled#1", "notification_sent#2"]);
      assert.deepEqual([...new Set(calls.map((c) => c.key))], [`order:${orderId}:order_customer_received`]);
      return "retry#1 then sent#2, one idempotency key";
    }],
    ["dead-letter, requeue and ABA: an old claim with the SAME attempts value still cannot touch the requeued row", async () => {
      const { id } = await seed("aba"), calls = [], A = provider("A", calls, "block");
      const pA = quiet(() => dispatch(A, T0)); await wait(() => calls.length >= 1);
      const aAttempts = (await row(id)).attempts; assert.equal(aAttempts, 1);
      await quiet(() => dispatch(provider("B", calls, { ok: false, retryable: false, code: "rejected" }), T1));
      assert.equal((await row(id)).status, "dead");
      assert.equal(await requeueDeadNotification(ownerDb, id, { userId: "u-r03", email: "ops@example.test" }, at(lockSeconds + 5)), true);
      const q = await row(id); assert.equal(q.status, "pending"); assert.equal(q.attempts, 0); assert.equal(q.claim_token, null);
      const C = provider("C", calls, "block"), pC = quiet(() => dispatch(C, at(lockSeconds + 10))); await wait(() => calls.length >= 3);
      const c = await row(id); assert.equal(c.attempts, aAttempts, "the requeue made attempts collide: attempts alone could not tell A from C");
      A.release({ ok: true }); await pA;
      const mid = await row(id); assert.equal(mid.status, "sending", "A's late success did not touch C's claim"); assert.equal(mid.claim_token, c.claim_token);
      C.release({ ok: true }); await pC;
      const a = await audits(id);
      assert.equal((await row(id)).status, "sent");
      assert.deepEqual(a, ["notification_dead#2", "notification_requeued#-", "notification_sent#1"], `got ${JSON.stringify(a)}`);
      return "A (attempts 1) fenced out although C also had attempts 1";
    }],
    ["batch vs lease: a worker that lost the lease on later rows of its batch does not send them, even while the new owner is still mid-send", async () => {
      const { ids } = await seed("batch", ["order_customer_received", "order_admin_new"]), calls = [];
      const A = provider("A", calls, "block-once"), B = provider("B", calls, "block-once");
      const pA = quiet(() => dispatch(A, T0, 2)); await wait(() => calls.length >= 1);                // A holds both rows, is stuck on the first
      const pB = quiet(() => dispatch(B, T1, 2)); await wait(() => calls.length >= 2);                // lease expired: B owns both and is itself stuck on the first
      A.release({ ok: true }); await pA;                                                                // A wakes up: its first result is stale, and the second row is B's now
      assert.equal(calls.filter((c) => c.name === "A").length, 1, "A never reached the provider for the second row");
      B.release({ ok: true }); await pB;
      assert.equal(calls.filter((c) => c.name === "B").length, 2, "B delivered both rows");
      for (const id of ids) { assert.equal((await row(id)).status, "sent"); assert.deepEqual(await audits(id), ["notification_sent#2"]); }
      return "A: 1 provider call (stuck row only), B: 2; 2 rows, 1 audit line each";
    }],
    ["state change and audit line are ONE statement: an audit failure leaves the row 'sending', never half-written", async () => {
      const { id } = await seed("atomic"), calls = [];
      await owner.query(`CREATE OR REPLACE FUNCTION public.r03_fail_sent_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'r03 injected audit failure'; END $$`);
      await owner.query("CREATE TRIGGER r03_fail_sent_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW WHEN (NEW.action = 'notification_sent' AND NEW.entity_id = '" + id + "') EXECUTE FUNCTION public.r03_fail_sent_audit()");
      try {
        await quiet(() => dispatch(provider("A", calls), T0));
        const r = await row(id);
        assert.equal(r.status, "sending", "the state change rolled back with the failed audit insert"); assert.equal(r.has_sent_at, false); assert.notEqual(r.claim_token, null);
        assert.deepEqual(await audits(id), []);
      } finally {
        await owner.query("DROP TRIGGER IF EXISTS r03_fail_sent_audit ON public.audit_logs"); await owner.query("DROP FUNCTION IF EXISTS public.r03_fail_sent_audit()");
      }
      await quiet(() => dispatch(provider("B", calls), T1));
      const r = await row(id); assert.equal(r.status, "sent");
      assert.deepEqual(await audits(id), ["notification_sent#2"]);
      return `database consistent after the failure; delivery is at-least-once (${calls.length} provider calls, one key)`;
    }],
    ["stalled after the last allowed attempt: the row is dead, its token is cleared, and the stalled claim's late answer changes nothing", async () => {
      const { id } = await seed("stalled"), calls = [], A = provider("A", calls, "block");
      const pA = quiet(() => dispatch(A, T0)); await wait(() => calls.length >= 1);
      await owner.query("UPDATE notification_outbox SET attempts = $2 WHERE id = $1", [id, maxAttempts]);          // as if this were the final allowed attempt
      const B = provider("B", calls); await quiet(() => dispatch(B, T1));
      const dead = await row(id);
      assert.equal(dead.status, "dead"); assert.equal(dead.last_error_code, "stalled"); assert.equal(dead.claim_token, null); assert.equal(calls.length, 1, "a stalled final attempt is never re-sent");
      A.release({ ok: true }); await pA;
      const r = await row(id); assert.equal(r.status, "dead", "the late success did not resurrect it"); assert.equal(r.has_sent_at, false);
      assert.deepEqual(await audits(id), []);
      return "dead 'stalled', token cleared, late success ignored, no audit line";
    }],
    ["idempotency key: every provider call of every scenario carried exactly its row's dedupe key", async () => {
      assert.ok(keysSeen.length >= 10, "scenarios ran");
      assert.ok(keysSeen.every((k) => /^order:r03-[0-9a-f]{8}-[a-z0-9]+:order_(customer_received|admin_new)$/.test(k)));
      const bad = (await owner.query("SELECT count(*)::int AS n FROM notification_outbox WHERE id LIKE $1 AND dedupe_key <> 'order:' || order_id || ':' || kind", [`ob-${run}-%`])).rows[0].n;
      assert.equal(bad, 0); return `${keysSeen.length} provider calls checked`;
    }],
    ["database invariant: a fencing token exists only on a 'sending' row and has the expected shape", async () => {
      assert.equal((await owner.query("SELECT count(*)::int AS n FROM notification_outbox WHERE claim_token IS NOT NULL AND status <> 'sending'")).rows[0].n, 0);
      const { id } = await seed("check");
      for (const bad of ["x", "A".repeat(32), "0123456789abcdef0123456789abcdef"]) {
        const code = await owner.query("UPDATE notification_outbox SET claim_token = $2 WHERE id = $1", [id, bad]).then(() => "ok", (e) => e.code);
        assert.equal(code, "23514", `token '${bad.slice(0, 6)}...' on a pending row is refused`);
      }
      return "CHECK refuses a token on a non-sending row and a malformed token";
    }],
  ];

  const out = [];
  for (const [name, fn] of scenarios) {
    try { out.push({ name, ok: true, detail: await fn() }); }
    catch (error) {
      const cause = error?.cause ?? error, state = typeof cause?.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code) ? ` [SQLSTATE ${cause.code}${cause.message && cause !== error ? `: ${String(cause.message).slice(0, 120)}` : ""}]` : "";
      out.push({ name, ok: false, detail: ((error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 160)) + state });
    }
  }
  void maxAttempts;
  return out;
}
