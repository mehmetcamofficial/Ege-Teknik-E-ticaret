/**
 * R-04 send-budget scenarios, run against REAL PostgreSQL with a fake provider (no network, no e-mail).
 *
 * Shared by scripts/test-pr37-worker-http.mjs (dispatch runs through the dedicated worker role, so the reservation function is exercised under the
 * narrow ACL) and by ad-hoc runs against mutated code. Each scenario seeds its own orders and outbox rows, uses its OWN budget key id (so no counter is
 * shared between scenarios), and checks what the database ends up saying (rows, audit lines, counters) separately from what the provider received.
 *
 * The provider call cannot be atomic with the reservation. These scenarios therefore assert the guarantees that DO hold: a unit is reserved before
 * every provider call, never charged twice for the same row, never over the limit under concurrency, and a send is never attempted when the budget
 * cannot be proven. Nothing here prints an address, key or URL.
 */
import assert from "node:assert/strict";

const KEY = "r04-test-key-not-a-secret-0123456789abcdef";   // a throwaway key for disposable databases only

/**
 * @param {{ dispatchOutbox: Function, requeueDeadNotification: Function, operationsSummary: Function, enqueueOrderNotifications: Function,
 *   reserveSend: Function, budgetEntries: Function, budgetConfig: Function, db: unknown, ownerDb: unknown,
 *   owner: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[], rowCount: number | null }> }, concurrency?: number, maxAttempts: number }} ctx
 */
export async function runBudgetScenarios(ctx) {
  const { dispatchOutbox, requeueDeadNotification, operationsSummary, enqueueOrderNotifications, reserveSend, budgetEntries, budgetConfig, db, ownerDb, owner, maxAttempts } = ctx;
  const racers = ctx.concurrency ?? 5;
  const run = crypto.randomUUID().slice(0, 8);
  const hourStart = Math.ceil((Date.now() + 120_000) / 3_600_000) * 3_600_000;
  const T0 = new Date(hourStart + 600_000);                          // ten minutes into a future hour: offsets below ~50 minutes stay in one hour/day window
  const at = (s) => new Date(T0.getTime() + s * 1000);
  const HIGH = { NOTIFICATION_CUSTOMER_DOMAIN_PER_HOUR: "100000", NOTIFICATION_CUSTOMER_PER_HOUR: "100000", NOTIFICATION_CUSTOMER_PER_DAY: "100000", NOTIFICATION_CUSTOMER_GLOBAL_PER_DAY: "100000", NOTIFICATION_OPS_PER_HOUR: "100000", NOTIFICATION_OPS_PER_DAY: "100000", NOTIFICATION_OPS_GLOBAL_PER_DAY: "100000" };
  const envFor = (id, over = {}) => ({ RESEND_API_KEY: "test-key-not-real", MAIL_FROM: "t@example.test", ORDER_ALERT_EMAILS: "ops@example.test", NOTIFICATION_RATE_KEY: KEY, NOTIFICATION_RATE_KEY_ID: id, ...HIGH, ...over });
  const logs = [];
  const realWarn = console.warn, realError = console.error; let depth = 0;
  const quiet = async (fn) => { depth++; console.warn = (...a) => logs.push(JSON.stringify(a)); console.error = (...a) => logs.push(JSON.stringify(a)); try { return await fn(); } finally { if (--depth === 0) { console.warn = realWarn; console.error = realError; } } };
  const emails = [];
  const mail = (tag, n = "") => { const e = `v${run}${tag}${n}@example.test`; emails.push(e); return e; };
  const seed = async (tag, email, kind = "order_customer_received") => {
    const orderId = `r04-${run}-${tag}`;
    await owner.query("INSERT INTO orders (id, order_number, idempotency_key, customer_name, phone, city, address, email) VALUES ($1,$1,$1,'T','05550000000','Izmir','A',$2)", [orderId, email]);
    const id = `ob-${run}-${tag}`;
    await owner.query("INSERT INTO notification_outbox (id, kind, order_id, dedupe_key) VALUES ($1,$2,$3,$4)", [id, kind, orderId, `order:${orderId}:${kind}`]);
    return { orderId, id };
  };
  const provider = (calls, mode = "ok") => ({ send: async (m) => { calls.push({ to: m.to, key: m.idempotencyKey }); return mode === "ok" ? { ok: true } : mode; } });
  const dispatch = (p, env, now = T0, limit = 50) => quiet(() => dispatchOutbox({ db, provider: p, env, now, limit }));
  const row = async (id) => (await owner.query("SELECT status, attempts, last_error_code FROM notification_outbox WHERE id = $1", [id])).rows[0];
  const audits = async (id) => (await owner.query("SELECT action FROM audit_logs WHERE entity_id = $1 AND action LIKE 'notification_%' ORDER BY created_at, id", [id])).rows.map((r) => r.action);
  const used = async (like) => (await owner.query("SELECT coalesce(sum(used), 0)::int AS n FROM notification_send_budget WHERE bucket_key LIKE $1", [like])).rows[0].n;
  const reservations = async (prefix) => (await owner.query("SELECT count(*)::int AS n FROM notification_send_reservation WHERE outbox_id LIKE $1", [`${prefix}%`])).rows[0].n;
  const statuses = async (prefix) => { const r = (await owner.query("SELECT status, last_error_code AS code, count(*)::int AS n FROM notification_outbox WHERE id LIKE $1 GROUP BY 1, 2 ORDER BY 1, 2", [`${prefix}%`])).rows; return Object.fromEntries(r.map((x) => [`${x.status}${x.code ? ":" + x.code : ""}`, x.n])); };
  const orderIntact = async (prefix) => (await owner.query("SELECT count(*)::int AS n FROM orders WHERE id LIKE $1", [`r04-${run}-${prefix}%`])).rows[0].n;

  await owner.query("UPDATE notification_outbox SET status = 'dead', last_error_code = 'r04_isolated', locked_until = NULL, claim_token = NULL WHERE status IN ('pending','sending')");

  const scenarios = [
    ["hourly limit: the 4th mail to one recipient inside an hour is not sent, recorded as suppressed, and the order is untouched", async () => {
      const env = envFor("s1", { NOTIFICATION_CUSTOMER_PER_HOUR: "3" }), calls = [], to = mail("s1");
      for (let i = 1; i <= 5; i++) await seed(`s1n${i}`, to);
      const r = await dispatch(provider(calls), env);
      assert.equal(calls.length, 3, "three provider calls"); assert.equal(r.sent, 3); assert.equal(r.suppressed, 2); assert.equal(r.dead, 0);
      assert.deepEqual(await statuses(`ob-${run}-s1`), { "dead:rate_limited_hour": 2, sent: 3 });
      assert.equal(await orderIntact("s1"), 5, "all five orders exist");
      assert.equal(await used("c:s1:h:%"), 3, "the hour counter stopped at the limit");
      const aud = (await owner.query("SELECT action FROM audit_logs WHERE entity_id LIKE $1 AND action = 'notification_suppressed'", [`ob-${run}-s1%`])).rows.length; assert.equal(aud, 2);
      return "3 sent, 2 suppressed (rate_limited_hour), 2 notification_suppressed audit lines, 5 orders intact";
    }],
    ["daily limit: the cap holds across hours", async () => {
      const env = envFor("s2", { NOTIFICATION_CUSTOMER_PER_DAY: "4" }), calls = [], to = mail("s2");
      for (let i = 1; i <= 6; i++) await seed(`s2n${i}`, to);
      const first = await dispatch(provider(calls), env, T0, 3);               // three in the first hour
      const second = await dispatch(provider(calls), env, at(1800), 50);      // the rest, thirty minutes later, same UTC day
      assert.equal(first.sent + second.sent, 4); assert.equal(first.suppressed + second.suppressed, 2); assert.equal(calls.length, 4);
      assert.deepEqual(await statuses(`ob-${run}-s2`), { "dead:rate_limited_day": 2, sent: 4 }); return "4 sent, 2 rate_limited_day";
    }],
    ["global budget: exhausts the customer pool only; operations alerts keep their own budget; a full bucket leaks no partial increments", async () => {
      const env = envFor("s3", { NOTIFICATION_CUSTOMER_GLOBAL_PER_DAY: "2" }), calls = [];
      const rcpts = [1, 2, 3, 4].map((n) => mail("s3", n)); for (const [i, e] of rcpts.entries()) await seed(`s3c${i + 1}`, e);
      await seed("s3ops", "buyer@example.test", "order_admin_new");
      const r = await dispatch(provider(calls), env);
      assert.equal(r.sent, 3, "2 customer mails + 1 operations alert"); assert.equal(r.suppressed, 2);
      assert.deepEqual(await statuses(`ob-${run}-s3`), { "dead:rate_limited_global": 2, sent: 3 });
      assert.equal(await used("c:s3:h:%"), 2, "the two suppressed rows left no recipient increment behind (all-or-nothing)");
      assert.equal(await used("g:s3:customer"), 2); assert.equal(await used("g:s3:ops"), 1);
      return "customer pool 2/2, ops pool 1, no leaked per-recipient counters";
    }],
    ["50 rows for one recipient processed by concurrent workers: exactly the hourly limit is sent", async () => {
      const env = envFor("s4", { NOTIFICATION_CUSTOMER_PER_HOUR: "3" }), calls = [], to = mail("s4");
      for (let i = 1; i <= 50; i++) await seed(`s4n${String(i).padStart(2, "0")}`, to);
      const out = await Promise.all(Array.from({ length: racers }, () => dispatch(provider(calls), env, T0, 50)));
      assert.equal(out.reduce((n, x) => n + x.sent, 0), 3); assert.equal(calls.length, 3); assert.equal(out.reduce((n, x) => n + x.suppressed, 0), 47);
      assert.equal(await used("c:s4:h:%"), 3); assert.equal(await reservations(`ob-${run}-s4`), 3);
      assert.deepEqual(await statuses(`ob-${run}-s4`), { "dead:rate_limited_hour": 47, sent: 3 }); return `${racers} concurrent workers: 3 sent, 47 suppressed, counter 3`;
    }],
    ["50 simultaneous reservations for one bucket: exactly the limit succeeds, the rest answer 'limited' and nothing goes over", async () => {
      const cfg = budgetConfig(envFor("s4b", { NOTIFICATION_CUSTOMER_PER_HOUR: "3" })).config, to = mail("s4b"), ids = [];
      for (let i = 1; i <= 50; i++) ids.push((await seed(`s4b${String(i).padStart(2, "0")}`, to)).id);
      const entries = budgetEntries(cfg, "customer", [to]);
      const results = await Promise.all(ids.map((id) => reserveSend(db, id, entries, T0)));
      const by = results.reduce((m, x) => ({ ...m, [x.outcome]: (m[x.outcome] ?? 0) + 1 }), {});
      assert.deepEqual(by, { reserved: 3, limited: 47 }); assert.equal(await used("c:s4b:h:%"), 3); assert.equal(await reservations(`ob-${run}-s4b`), 3);
      await owner.query("UPDATE notification_outbox SET status = 'dead', last_error_code = 'r04_parked' WHERE id LIKE $1", [`ob-${run}-s4b%`]);   // these rows were reserved directly, never dispatched: keep later dispatches away from them
      return "reserved 3 / limited 47, counter 3, 3 reservation rows";
    }],
    ["normalisation: spellings that differ only in case share one budget; +tag and dots are NOT merged", async () => {
      const env = envFor("s5", { NOTIFICATION_CUSTOMER_PER_HOUR: "2" }), calls = [], base = `v${run}s5`;
      emails.push(`${base}@example.test`, `${base}+a@example.test`, `${base}.x@example.test`);
      await seed("s5a", `${base.toUpperCase()}@Example.TEST`); await seed("s5b", `${base}@example.test`); await seed("s5c", `${base}@EXAMPLE.test`);
      await seed("s5d", `${base}+a@example.test`); await seed("s5e", `${base}.x@example.test`);
      const r = await dispatch(provider(calls), env);
      assert.equal(r.sent, 4, "two for the shared address, one each for the +tag and the dotted variant"); assert.equal(r.suppressed, 1);
      assert.equal(await used("c:s5:h:%"), 4, "three distinct buckets: the plain address (2), +a (1), .x (1)"); return "3 spellings of one address -> one bucket; +tag and dot variants stay separate (4 sent, 1 suppressed)";
    }],
    ["domain cap (the alias route): different mailboxes at one domain stop at the per-domain limit", async () => {
      const env = envFor("s6", { NOTIFICATION_CUSTOMER_DOMAIN_PER_HOUR: "2" }), calls = [];
      for (let i = 1; i <= 3; i++) await seed(`s6n${i}`, mail("s6", i));
      const r = await dispatch(provider(calls), env); assert.equal(r.sent, 2); assert.equal(r.suppressed, 1);
      assert.deepEqual(await statuses(`ob-${run}-s6`), { "dead:rate_limited_domain": 1, sent: 2 }); return "2 sent, 1 rate_limited_domain";
    }],
    ["consumer Gmail aliases (dots, +suffix, googlemail.com) share ONE budget; the same spellings on another domain do not", async () => {
      const env = envFor("s6g", { NOTIFICATION_CUSTOMER_PER_HOUR: "2" }), calls = [], b = `v${run}g`;
      const gmail = [`${b}.1@gmail.com`, `${b}1+promo@Gmail.com`, `${b.toUpperCase()}1@googlemail.com`, `${b}.1+z@gmail.com`], other = [`${b}.2@example.test`, `${b}2@example.test`];
      emails.push(...gmail, ...other);
      for (const [i, a] of gmail.entries()) await seed(`s6g${i}`, a); for (const [i, a] of other.entries()) await seed(`s6o${i}`, a);
      const r = await dispatch(provider(calls), env);
      assert.equal(r.suppressed, 2, "the 3rd and 4th Gmail spelling are suppressed"); assert.equal(r.sent, 4, "2 Gmail + the 2 distinct example.test mailboxes");
      assert.equal(await used("c:s6g:h:%"), 4, "one Gmail bucket (2) and two separate example.test buckets (1 + 1)"); return "4 Gmail spellings -> 1 bucket (2 sent, 2 suppressed); dot variants elsewhere stay separate";
    }],
    ["requeue policy: a requeue inside the retry horizon is the same send (free); a later one is a NEW decision and is charged and limited like any other", async () => {
      const env = envFor("s14", { NOTIFICATION_CUSTOMER_PER_HOUR: "1" }), calls = [], reject = { ok: false, retryable: false, code: "rejected" }, actor = { userId: "u-r04", email: "ops@example.test" };
      const to = mail("s14"), a = await seed("s14a", to);
      await dispatch(provider(calls, reject), env, T0); assert.equal((await row(a.id)).status, "dead"); assert.equal(await used("c:s14:h:%"), 1);
      assert.equal(await requeueDeadNotification(ownerDb, a.id, actor, at(1800)), true);                     // 30 minutes later: same send, same hour
      const r1 = await dispatch(provider(calls), env, at(1800)); assert.equal(r1.sent, 1, "a requeue inside the horizon is free"); assert.equal(await used("c:s14:h:%"), 1);
      const to2 = mail("s14b"), b = await seed("s14b", to2);
      await dispatch(provider(calls, reject), env, T0); assert.equal((await row(b.id)).status, "dead");
      const later = 7 * 3600;
      assert.equal(await requeueDeadNotification(ownerDb, b.id, actor, at(later)), true);                      // seven hours later: beyond the six-hour horizon
      const r2 = await dispatch(provider(calls), env, at(later));
      assert.equal(r2.sent, 1, "the requeued row is sent, and it consumed a unit in the NEW window");
      const c = await seed("s14c", to2);                                                                       // a fresh notification for the same recipient, same new hour
      const r3 = await dispatch(provider(calls), env, at(later)); assert.equal(r3.suppressed, 1, "so a fresh row for the same recipient is limited: the requeue was charged");
      assert.equal((await row(c.id)).last_error_code, "rate_limited_hour");
      return "free inside 6 h; charged after it (a later row for the same recipient was limited)";
    }],
    ["idempotent checkout: a repeated enqueue and a repeated dispatch spend exactly one unit", async () => {
      const env = envFor("s7", { NOTIFICATION_CUSTOMER_PER_HOUR: "1" }), calls = [], to = mail("s7"), orderId = `r04-${run}-s7`;
      await owner.query("INSERT INTO orders (id, order_number, idempotency_key, customer_name, phone, city, address, email) VALUES ($1,$1,$1,'T','05550000000','Izmir','A',$2)", [orderId, to]);
      await enqueueOrderNotifications(ownerDb, orderId); await enqueueOrderNotifications(ownerDb, orderId);
      assert.equal((await owner.query("SELECT count(*)::int AS n FROM notification_outbox WHERE order_id = $1", [orderId])).rows[0].n, 2, "customer + operations, once");
      await dispatch(provider(calls), env); const again = await dispatch(provider(calls), env, at(60));
      assert.equal(again.processed, 0); assert.equal(await used("c:s7:h:%"), 1); assert.equal(calls.length, 2);
      return "2 outbox rows, customer counter 1, no second spend";
    }],
    ["worker retry and provider timeout never charge twice: a retried row is not suppressed by its own earlier spend", async () => {
      const env = envFor("s8", { NOTIFICATION_CUSTOMER_PER_HOUR: "1" }), calls = [], to = mail("s8"), { id } = await seed("s8", to);
      let r = await dispatch(provider(calls, { ok: false, retryable: true, code: "timeout" }), env, T0); assert.equal(r.retried, 1);
      assert.equal(await used("c:s8:h:%"), 1);
      r = await dispatch(provider(calls, { ok: false, retryable: true, code: "provider_5xx" }), env, at(61)); assert.equal(r.retried, 1);
      r = await dispatch(provider(calls), env, at(61 + 301)); assert.equal(r.sent, 1);
      assert.equal(await used("c:s8:h:%"), 1, "three provider attempts, one unit"); assert.equal((await row(id)).status, "sent"); assert.equal(calls.length, 3);
      assert.deepEqual([...new Set(calls.map((c) => c.key))].length, 1, "one idempotency key");
      return "3 attempts, 1 unit, delivered";
    }],
    ["rate-limit database failure: nothing is sent, the order is untouched, the row retries, and recovers when the function is back", async () => {
      const env = envFor("s9", { NOTIFICATION_CUSTOMER_PER_HOUR: "5" }), calls = [], to = mail("s9"), { id } = await seed("s9", to);
      const sig = "public.reserve_notification_send(text, text[], text[], integer[], timestamptz)";
      await owner.query(`ALTER FUNCTION ${sig} RENAME TO reserve_notification_send_off`);
      try {
        const r = await dispatch(provider(calls), env, T0);
        assert.equal(calls.length, 0, "no provider call without a proven budget"); assert.equal(r.retried, 1);
        const x = await row(id); assert.equal(x.status, "pending"); assert.equal(x.last_error_code, "budget_unavailable");
        assert.equal(await orderIntact("s9"), 1);
      } finally { await owner.query("ALTER FUNCTION public.reserve_notification_send_off(text, text[], text[], integer[], timestamptz) RENAME TO reserve_notification_send"); }
      const r2 = await dispatch(provider(calls), env, at(61)); assert.equal(r2.sent, 1); assert.equal((await row(id)).status, "sent");
      return "fail closed (0 calls, retry budget_unavailable), then delivered after recovery";
    }],
    ["missing or invalid budget configuration sends nothing and burns no attempt; the operations summary says why", async () => {
      const calls = [], to = mail("s10"), { id } = await seed("s10", to);
      const cases = [["NOTIFICATION_RATE_KEY_missing", { NOTIFICATION_RATE_KEY: "" }], ["NOTIFICATION_RATE_KEY_invalid", { NOTIFICATION_RATE_KEY: "short" }],
        ["NOTIFICATION_CUSTOMER_PER_HOUR_invalid", { NOTIFICATION_CUSTOMER_PER_HOUR: "0" }], ["NOTIFICATION_CUSTOMER_PER_DAY_invalid", { NOTIFICATION_CUSTOMER_PER_DAY: "many" }],
        ["NOTIFICATION_RATE_KEY_ID_invalid", { NOTIFICATION_RATE_KEY_ID: "Bad Id" }]];
      for (const [reason, over] of cases) {
        const env = envFor("s10", over); const r = await dispatch(provider(calls), env, T0);
        assert.equal(r.processed, 0, reason); assert.equal(r.providerConfigured, false, reason);
        const x = await row(id); assert.equal(x.status, "pending", reason); assert.equal(x.attempts, 0, reason);
        const s = await operationsSummary(ownerDb, env); assert.equal(s.notifications.providerConfigured, false); assert.equal(s.notifications.providerReason, reason);
      }
      assert.equal(calls.length, 0);
      await owner.query("UPDATE notification_outbox SET status = 'dead', last_error_code = 'r04_parked' WHERE id = $1", [id]);   // it stayed pending on purpose; keep later dispatches away from it
      return `${cases.length} bad configurations: 0 calls, 0 attempts burned, reason reported`;
    }],
    ["after a limit, the order flow continues; a suppressed notification can be requeued and is sent once the window has passed", async () => {
      const env = envFor("s11", { NOTIFICATION_CUSTOMER_PER_HOUR: "1" }), calls = [], to = mail("s11");
      const a = await seed("s11a", to), b = await seed("s11b", to);
      await dispatch(provider(calls), env, T0); assert.equal(calls.length, 1, "first dispatch: one send, one suppression");
      const sup = (await row(a.id)).status === "dead" ? a.id : b.id; assert.equal((await row(sup)).last_error_code, "rate_limited_hour", "suppressed with the hourly code");
      assert.equal(await requeueDeadNotification(ownerDb, sup, { userId: "u-r04", email: "ops@example.test" }, at(30)), true);
      await dispatch(provider(calls), env, at(60)); assert.equal(calls.length, 1, "still the same hour: suppressed again, nothing sent");   // (second dispatch)
      assert.equal((await row(sup)).last_error_code, "rate_limited_hour");
      assert.equal(await requeueDeadNotification(ownerDb, sup, { userId: "u-r04", email: "ops@example.test" }, at(3700)), true);
      await dispatch(provider(calls), env, at(3700)); assert.equal(calls.length, 2, "the next hour has a fresh window (third dispatch)"); assert.equal((await row(sup)).status, "sent");
      assert.equal(await orderIntact("s11"), 2); return "suppressed twice inside the hour, sent after it";
    }],
    ["stale worker (R-03) plus budget: a second claim of the same row spends nothing, and the stale worker's late answer changes nothing", async () => {
      const env = envFor("s12", { NOTIFICATION_CUSTOMER_PER_HOUR: "1" }), calls = [], to = mail("s12"), { id } = await seed("s12", to);
      let release; const A = { send: async (m) => { calls.push({ name: "A", key: m.idempotencyKey }); return new Promise((res) => { release = res; }); } };
      const pA = dispatch(A, env, T0); for (let i = 0; calls.length < 1; i++) { if (i > 500) throw new Error("A never sent"); await new Promise((r) => setTimeout(r, 10)); }
      const rB = await dispatch(provider(calls), env, at(301)); assert.equal(rB.sent, 1, "B re-claims after the lease and is NOT suppressed by A's earlier unit");
      release({ ok: true }); await pA;
      assert.equal(await used("c:s12:h:%"), 1); assert.equal(await reservations(`ob-${run}-s12`), 1); assert.deepEqual(await audits(id), ["notification_sent"]);
      return "1 unit for 2 claims, 1 audit line";
    }],
    ["key rotation: a new key id starts fresh buckets (documented, bounded reset)", async () => {
      const calls = [], to = mail("s13");
      for (const n of ["a", "b", "c"]) await seed(`s13${n}`, to);
      const r1 = await dispatch(provider(calls), envFor("r1", { NOTIFICATION_CUSTOMER_PER_HOUR: "1" }), T0, 2);
      assert.equal(r1.sent, 1); assert.equal(r1.suppressed, 1);
      const r2 = await dispatch(provider(calls), envFor("r2", { NOTIFICATION_CUSTOMER_PER_HOUR: "1" }), T0, 5);
      assert.equal(r2.sent, 1, "the third row, under the rotated key, has a fresh bucket"); return "r1: 1 sent + 1 suppressed; r2: fresh bucket";
    }],
    ["the budget tables hold no address and nothing printed or audited contains one", async () => {
      const keys = (await owner.query("SELECT bucket_key FROM notification_send_budget")).rows.map((r) => r.bucket_key);
      assert.ok(keys.length > 10); assert.ok(keys.every((k) => /^[A-Za-z0-9:_-]{1,120}$/.test(k) && !k.includes("@") && !k.includes(run)), "opaque keys only");
      const payloads = (await owner.query("SELECT payload::text AS p FROM audit_logs WHERE entity_id LIKE $1", [`ob-${run}-%`])).rows.map((r) => r.p).join("\n");
      assert.ok(!payloads.includes(run), "no address or nonce in any audit payload"); assert.ok(/\*\*\*/.test(payloads), "recipients are masked");
      const printed = logs.join("\n"); assert.ok(!printed.includes(run) && !printed.includes(KEY) && !/@/.test(printed), "nothing printed contains an address or the key");
      for (const e of emails) assert.ok(!payloads.includes(e) && !printed.includes(e));
      return `${keys.length} opaque bucket keys, ${payloads.split("\n").length} audit payloads and ${logs.length} log lines checked`;
    }],
  ];

  const out = [];
  for (const [name, fn] of scenarios) {
    try { out.push({ name, ok: true, detail: await fn() }); }
    catch (error) {
      const cause = error?.cause ?? error, state = typeof cause?.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code) ? ` [SQLSTATE ${cause.code}]` : "";
      const values = error && "actual" in error && "expected" in error ? ` (actual ${JSON.stringify(error.actual)}, expected ${JSON.stringify(error.expected)})` : "";
      out.push({ name, ok: false, detail: ((error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200)) + values + state });
    }
  }
  void maxAttempts;
  return out;
}
