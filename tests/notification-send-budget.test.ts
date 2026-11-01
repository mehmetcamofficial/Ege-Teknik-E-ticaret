/** R-04 send budget: pure behaviour (normalisation, keyed digests, configuration, bucket construction) and source guards. The database behaviour is proven by
 * scripts/notification-budget-scenarios.mjs on real PostgreSQL. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { budgetIdentity, normalizeRecipient, recipientDigest } from "../lib/notifications/recipient-key.ts";
import { budgetConfig, budgetEntries } from "../lib/notifications/send-budget.ts";
import { describeNotifications } from "../lib/notifications/summary-view.ts";

const KEY = "unit-test-key-not-a-secret-0123456789abcdef";
const env = (over: Record<string, string | undefined> = {}) => ({ NOTIFICATION_RATE_KEY: KEY, ...over });
const cfg = (over: Record<string, string | undefined> = {}) => { const c = budgetConfig(env(over)); assert.ok(c.ok, "configuration is valid"); return c.config; };

test("R-04 normalisation lower-cases, trims, uses NFC and the ASCII domain, and keeps +tag and dots", () => {
  assert.deepEqual(normalizeRecipient("  Ada.Yilmaz+Shop@Example.COM "), { local: "ada.yilmaz+shop", domain: "example.com" });
  assert.deepEqual(normalizeRecipient("a@BÜCHER.example"), { local: "a", domain: "xn--bcher-kva.example" }, "an internationalised domain is compared in its ASCII form");
  assert.deepEqual(normalizeRecipient("é@example.com"), normalizeRecipient("é@example.com"), "composed and decomposed spellings are one address");
  assert.notDeepEqual(normalizeRecipient("a.b@example.com"), normalizeRecipient("ab@example.com"), "dots are NOT removed (a provider-specific rule)");
  assert.notDeepEqual(normalizeRecipient("a+1@example.com"), normalizeRecipient("a@example.com"), "+tag is NOT removed (a provider-specific rule)");
  for (const bad of ["", "no-at", "@example.com", "a@", "a@b", "a b@example.com", "a@exa mple.com", "<a@example.com>", "a@example.com;b@example.com", "a\u0000@example.com", `${"x".repeat(65)}@example.com`])
    assert.equal(normalizeRecipient(bad), null, JSON.stringify(bad));
});

test("R-04 the digest is keyed, scoped, fixed-length and reveals nothing about the address", () => {
  const d = recipientDigest(KEY, "recipient", "ada@example.com");
  assert.match(d, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(d, recipientDigest(KEY, "recipient", "ada@example.com"), "deterministic");
  assert.notEqual(d, recipientDigest(KEY + "x", "recipient", "ada@example.com"), "another key gives another bucket (rotation)");
  assert.notEqual(d, recipientDigest(KEY, "domain", "ada@example.com"), "scopes never collide");
  assert.notEqual(d, recipientDigest(KEY, "recipient", "ada@example.org"));
  assert.ok(!d.includes("ada") && !d.includes("example"));
});

test("R-04 configuration: defaults, bounds, and every invalid value is an error (never silently replaced)", () => {
  const c = cfg();
  assert.deepEqual([c.customerPerHour, c.customerPerDay, c.customerGlobalPerDay, c.customerDomainPerHour, c.opsPerHour, c.opsPerDay, c.opsGlobalPerDay, c.keyId], [3, 10, 1000, 30, 60, 300, 1000, "k1"]);
  assert.equal(cfg({ NOTIFICATION_CUSTOMER_PER_HOUR: "7", NOTIFICATION_CUSTOMER_DOMAIN_PER_HOUR: "25", NOTIFICATION_RATE_KEY_ID: "r2" }).customerPerHour, 7);
  assert.deepEqual(budgetConfig({}), { ok: false, reason: "NOTIFICATION_RATE_KEY_missing" });
  assert.deepEqual(budgetConfig(env({ NOTIFICATION_RATE_KEY: "   " })), { ok: false, reason: "NOTIFICATION_RATE_KEY_missing" });
  assert.deepEqual(budgetConfig(env({ NOTIFICATION_RATE_KEY: "too-short" })), { ok: false, reason: "NOTIFICATION_RATE_KEY_invalid" });
  assert.deepEqual(budgetConfig(env({ NOTIFICATION_RATE_KEY_ID: "Bad Id" })), { ok: false, reason: "NOTIFICATION_RATE_KEY_ID_invalid" });
  for (const [name, value] of [["NOTIFICATION_CUSTOMER_PER_HOUR", "0"], ["NOTIFICATION_CUSTOMER_PER_HOUR", "-1"], ["NOTIFICATION_CUSTOMER_PER_DAY", "ten"], ["NOTIFICATION_CUSTOMER_GLOBAL_PER_DAY", "1.5"],
    ["NOTIFICATION_OPS_PER_HOUR", "100001"], ["NOTIFICATION_OPS_GLOBAL_PER_DAY", "1e3"], ["NOTIFICATION_CUSTOMER_DOMAIN_PER_HOUR", "x"]])
    assert.deepEqual(budgetConfig(env({ [name]: value })), { ok: false, reason: `${name}_invalid` }, `${name}=${value}`);
  assert.equal(cfg({ NOTIFICATION_CUSTOMER_DOMAIN_PER_HOUR: "0" }).customerDomainPerHour, 0, "the domain cap may be switched off explicitly");
});

test("R-04 buckets: customer and operations are separate pools; keys are opaque, valid for the database and carry no address", () => {
  const customer = budgetEntries(cfg(), "customer", ["Ada@Example.com"])!;
  assert.deepEqual(customer.map((e) => [e.window, e.limit, e.code]), [["hour", 3, "rate_limited_hour"], ["day", 10, "rate_limited_day"], ["hour", 30, "rate_limited_domain"], ["day", 1000, "rate_limited_global"]], "the per-domain cap is ON by default");
  assert.deepEqual(customer.map((e) => e.key), budgetEntries(cfg(), "customer", ["ada@example.com"])!.map((e) => e.key), "case does not change the bucket");
  const withDomain = budgetEntries(cfg({ NOTIFICATION_CUSTOMER_DOMAIN_PER_HOUR: "20" }), "customer", ["ada@example.com"])!;
  assert.deepEqual(budgetEntries(cfg({ NOTIFICATION_CUSTOMER_DOMAIN_PER_HOUR: "0" }), "customer", ["ada@example.com"])!.map((e) => e.code), ["rate_limited_hour", "rate_limited_day", "rate_limited_global"], "and can be switched off");
  assert.deepEqual(withDomain.map((e) => e.code), ["rate_limited_hour", "rate_limited_day", "rate_limited_domain", "rate_limited_global"]);
  assert.equal(withDomain.find((e) => e.code === "rate_limited_domain")!.limit, 20);
  const ops = budgetEntries(cfg(), "ops", ["ops@example.com", "OPS@example.com", "boss@example.com"])!;
  assert.deepEqual(ops.map((e) => e.code), ["rate_limited_hour", "rate_limited_day", "rate_limited_hour", "rate_limited_day", "rate_limited_global"], "a repeated address counts once");
  assert.deepEqual(ops.map((e) => e.limit), [60, 300, 60, 300, 1000], "operations alerts use their own, higher limits and their own global pool");
  assert.equal(ops.at(-1)!.key, "g:k1:ops"); assert.equal(customer.at(-1)!.key, "g:k1:customer"); assert.notEqual(customer[0].key, ops[0].key, "separate pools");
  for (const e of [...customer, ...withDomain, ...ops]) { assert.match(e.key, /^[A-Za-z0-9:_-]{1,120}$/); assert.ok(!/ada|ops|boss|example|@/i.test(e.key.replace(/^[a-z]:k1:[a-z]:/, "").replace(/^g:k1:.*/, "")), "no address material in a key"); }
  assert.equal(budgetEntries(cfg(), "customer", ["not-an-address"]), null, "an unparseable recipient yields no bucket (the row is dead, nothing is sent)");
  assert.equal(budgetEntries(cfg(), "ops", Array.from({ length: 21 }, (_, i) => `u${i}@example.com`)), null, "more buckets than the function accepts are refused");
  assert.notDeepEqual(customer.map((e) => e.key), budgetEntries(cfg({ NOTIFICATION_RATE_KEY_ID: "k2", NOTIFICATION_RATE_KEY: KEY + "2" }), "customer", ["ada@example.com"])!.map((e) => e.key), "rotation starts fresh buckets");
});

test("R-04 the worker reserves AFTER proving ownership and BEFORE the provider call, and every failure sends nothing", () => {
  const src = readFileSync("lib/notifications/outbox.ts", "utf8");
  const hold = src.indexOf("await holdClaim()"), reserve = src.indexOf("await reserveSend("), send = src.indexOf("await provider.send(");
  assert.ok(hold > 0 && hold < reserve && reserve < send, "holdClaim -> reserveSend -> provider.send");
  assert.match(src, /if \(!provider \|\| !status\.configured \|\| !budget\.ok\) return empty;/, "no budget configuration: nothing is claimed, no attempt is burned");
  assert.match(src, /catch \(error\) \{[\s\S]{0,260}notification_budget_unavailable[\s\S]{0,260}budget_unavailable[\s\S]{0,40}continue;/, "a reservation error retries or dies, never sends");
  assert.match(src, /reservation\.outcome === "limited"\) \{ await finish\("suppressed", reservation\.code, masked\); continue; \}/, "a full bucket suppresses and moves on");
  assert.match(src, /notification_suppressed/);
  assert.doesNotMatch(src.slice(reserve, src.indexOf('reservation.outcome === "limited"', reserve)), /provider\.send/, "nothing between the reservation and its checks sends");
  assert.match(src, /if \(!entries\) \{ await finish\("dead", "invalid_recipient", masked\); continue; \}/);
});

test("R-04 migration 0025 is additive, definer-pinned and hands out nothing", () => {
  const sql = readFileSync("drizzle-pg/0025_notification_send_budget.sql", "utf8"), code = sql.replace(/^--.*$/gm, "");
  assert.match(code, /CREATE TABLE "notification_send_budget"/); assert.match(code, /CREATE TABLE "notification_send_reservation"/);
  assert.match(code, /SECURITY DEFINER\s+SET search_path = pg_catalog, public, pg_temp/, "pinned search_path, pg_temp last");
  assert.match(code, /REVOKE ALL ON FUNCTION public\.reserve_notification_send\(text, text\[\], text\[\], integer\[\], timestamptz\) FROM PUBLIC/);
  assert.match(code, /REVOKE ALL ON TABLE "notification_send_budget", "notification_send_reservation" FROM PUBLIC/);
  assert.doesNotMatch(code, /\bGRANT\b/i, "the migration grants nothing: the operator SQL names the worker role");
  assert.doesNotMatch(code, /\b(DROP|TRUNCATE|ALTER TABLE)\b/i, "no existing object is touched");
  assert.match(code, /DO UPDATE SET used = b\.used \+ 1 WHERE b\.used < r\.l/, "the increment is conditional on the limit, in one statement");
  assert.match(code, /ORDER BY t\.k, t\.w/, "buckets are locked in a fixed order");
  assert.match(code, /ON CONFLICT \(outbox_id\) DO UPDATE SET reserved_at = EXCLUDED\.reserved_at WHERE rv\.reserved_at < ts - interval '6 hours'/, "idempotent per outbox row, but only within the retry horizon: an older reservation is charged again");
  assert.match(code, /EXCEPTION WHEN SQLSTATE 'NB001'/, "all-or-nothing");
});

test("R-04 the operator SQL gives the worker EXECUTE on the one function and nothing on the budget tables", () => {
  const sql = readFileSync("docs/ops/notification-worker-grants-20261024.sql", "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.reserve_notification_send\(text, text\[\], text\[\], integer\[\], timestamptz\) TO :"worker_role";/);
  assert.equal((sql.match(/GRANT EXECUTE/g) ?? []).length, 1, "exactly one function grant");
  assert.doesNotMatch(sql, /notification_send_(budget|reservation)/, "no privilege on the budget tables themselves");
});

test("R-04 the operations banner reports suppressed notifications separately from delivery failures", () => {
  const base = { providerConfigured: true, providerReason: null, adminRecipientsConfigured: true, oldestWaitingSeconds: null };
  const onlySuppressed = describeNotifications({ ...base, byStatus: { pending: 0, sending: 0, sent: 4, dead: 3 }, suppressed: { rate_limited_hour: 2, rate_limited_global: 1 } });
  assert.equal(onlySuppressed.tone, "ok", "a held-back notification is not a delivery failure");
  assert.ok(onlySuppressed.details.some((d) => /3 bildirim gönderim sınırı nedeniyle bastırıldı/.test(d)) && onlySuppressed.details.every((d) => !/gönderilemedi/.test(d)));
  const mixed = describeNotifications({ ...base, byStatus: { pending: 0, sending: 0, sent: 4, dead: 5 }, suppressed: { rate_limited_hour: 2 } });
  assert.equal(mixed.tone, "danger"); assert.ok(mixed.details.some((d) => /3 bildirim gönderilemedi/.test(d)) && mixed.details.some((d) => /2 bildirim gönderim sınırı/.test(d)));
  assert.doesNotMatch(JSON.stringify([onlySuppressed, mixed]), /@/, "no address in the banner");
});

test("R-04 consumer Gmail is counted as ONE mailbox; no other domain is merged", () => {
  const id = (a: string) => { const n = normalizeRecipient(a); return n && budgetIdentity(n); };
  const one = { local: "janedoe", domain: "gmail.com" };
  for (const a of ["janedoe@gmail.com", "Jane.Doe@Gmail.com", "j.a.n.e.d.o.e+shop@gmail.com", "janedoe+a+b@gmail.com", "janedoe@googlemail.com", "JANE.DOE+x@GOOGLEMAIL.COM"]) assert.deepEqual(id(a), one, a);
  assert.deepEqual(id("jane.doe@example.com"), { local: "jane.doe", domain: "example.com" }, "dots stay on every other domain (Google Workspace on a custom domain does not ignore them)");
  assert.deepEqual(id("jane+x@outlook.com"), { local: "jane+x", domain: "outlook.com" }, "+tag stays on every other domain");
  assert.deepEqual(id("jane@gmail.com.example.org"), { local: "jane", domain: "gmail.com.example.org" }, "only the exact domains");
  assert.equal(id("+promo@gmail.com"), null); assert.equal(id("...@gmail.com"), null, "nothing left of the local part");
  const keys = (a: string) => budgetEntries(cfg(), "customer", [a])!.map((e) => e.key).join("|");
  assert.equal(keys("jane.doe+1@gmail.com"), keys("janedoe@googlemail.com"), "same buckets, including the domain bucket");
  assert.notEqual(keys("jane.doe@example.com"), keys("janedoe@example.com"));
  assert.equal(budgetEntries(cfg(), "customer", ["+x@gmail.com"]), null, "an address with nothing left is refused, not counted under an empty identity");
});
