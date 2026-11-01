import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { budgetIdentity, normalizeRecipient, recipientDigest } from "./recipient-key.ts";

/**
 * R-04: caps on what is actually handed to the e-mail provider, enforced at SEND time through public.reserve_notification_send (migration 0025).
 * Customer notifications are capped per recipient (hour, day), optionally per recipient DOMAIN (the alias route) and globally per day. Operations
 * alerts go to a fixed, trusted list, so they have their own, much higher caps and their own global budget: abuse of the customer mail can never
 * starve the alerts the business needs, and a burst of real orders is not mistaken for abuse.
 *
 * Environment (all optional except the key; invalid values are a configuration error, never silently replaced):
 *   NOTIFICATION_RATE_KEY                 >= 32 chars, HMAC key for the bucket keys (mandatory: without it nothing is sent)
 *   NOTIFICATION_RATE_KEY_ID              [a-z0-9]{1,8}, default "k1" (change together with the key when rotating)
 *   NOTIFICATION_CUSTOMER_PER_HOUR        default 3          NOTIFICATION_CUSTOMER_PER_DAY        default 10
 *   NOTIFICATION_CUSTOMER_GLOBAL_PER_DAY  default 1000       NOTIFICATION_CUSTOMER_DOMAIN_PER_HOUR default 30 (0 = off)
 *   NOTIFICATION_OPS_PER_HOUR             default 60         NOTIFICATION_OPS_PER_DAY             default 300
 *   NOTIFICATION_OPS_GLOBAL_PER_DAY       default 1000
 * Set the global budgets from the provider plan; the defaults are a conservative ceiling, not a sizing. The domain cap is the answer to alias spreading
 * (`victim+1@`, `victim+2@` ...) on providers whose alias rules are not documented: 30 an hour is far above what a shop of this size sees from any one domain
 * and far below what a flood needs. Consumer Gmail is additionally collapsed to one identity (see budgetIdentity).
 */
export type BudgetConfig = {
  key: string; keyId: string;
  customerPerHour: number; customerPerDay: number; customerGlobalPerDay: number; customerDomainPerHour: number;
  opsPerHour: number; opsPerDay: number; opsGlobalPerDay: number;
};
type Env = Record<string, string | undefined>;

const INTEGERS: [keyof BudgetConfig, string, number, number][] = [
  ["customerPerHour", "NOTIFICATION_CUSTOMER_PER_HOUR", 3, 1], ["customerPerDay", "NOTIFICATION_CUSTOMER_PER_DAY", 10, 1],
  ["customerGlobalPerDay", "NOTIFICATION_CUSTOMER_GLOBAL_PER_DAY", 1000, 1], ["customerDomainPerHour", "NOTIFICATION_CUSTOMER_DOMAIN_PER_HOUR", 30, 0],
  ["opsPerHour", "NOTIFICATION_OPS_PER_HOUR", 60, 1], ["opsPerDay", "NOTIFICATION_OPS_PER_DAY", 300, 1], ["opsGlobalPerDay", "NOTIFICATION_OPS_GLOBAL_PER_DAY", 1000, 1],
];

export function budgetConfig(env: Env): { ok: true; config: BudgetConfig } | { ok: false; reason: string } {
  const key = env.NOTIFICATION_RATE_KEY?.trim() ?? "";
  if (!key) return { ok: false, reason: "NOTIFICATION_RATE_KEY_missing" };
  if (key.length < 32) return { ok: false, reason: "NOTIFICATION_RATE_KEY_invalid" };
  const keyId = env.NOTIFICATION_RATE_KEY_ID?.trim() || "k1";
  if (!/^[a-z0-9]{1,8}$/.test(keyId)) return { ok: false, reason: "NOTIFICATION_RATE_KEY_ID_invalid" };
  const config = { key, keyId } as BudgetConfig;
  for (const [field, name, fallback, min] of INTEGERS) {
    const raw = env[name]?.trim();
    const value = raw === undefined || raw === "" ? fallback : /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < min || value > 100_000) return { ok: false, reason: `${name}_invalid` };
    (config[field] as number) = value;
  }
  return { ok: true, config };
}

export type BudgetEntry = { key: string; window: "hour" | "day"; limit: number; code: string };

/** The buckets one notification must fit into. Order is stable; `code` is what is recorded when that bucket is the full one. */
export function budgetEntries(config: BudgetConfig, scope: "customer" | "ops", recipients: string[]): BudgetEntry[] | null {
  const entries: BudgetEntry[] = [];
  const seen = new Set<string>();
  for (const address of recipients) {
    const n = normalizeRecipient(address), id = n && budgetIdentity(n);
    if (!n || !id) return null;
    const who = recipientDigest(config.key, "recipient", `${id.local}@${id.domain}`);
    if (seen.has(who)) continue;
    seen.add(who);
    const p = `${scope === "customer" ? "c" : "o"}:${config.keyId}:`;
    entries.push({ key: `${p}h:${who}`, window: "hour", limit: scope === "customer" ? config.customerPerHour : config.opsPerHour, code: "rate_limited_hour" });
    entries.push({ key: `${p}d:${who}`, window: "day", limit: scope === "customer" ? config.customerPerDay : config.opsPerDay, code: "rate_limited_day" });
    if (scope === "customer" && config.customerDomainPerHour > 0) {
      entries.push({ key: `c:${config.keyId}:m:${recipientDigest(config.key, "domain", id.domain)}`, window: "hour", limit: config.customerDomainPerHour, code: "rate_limited_domain" });
    }
  }
  entries.push({ key: `g:${config.keyId}:${scope}`, window: "day", limit: scope === "customer" ? config.customerGlobalPerDay : config.opsGlobalPerDay, code: "rate_limited_global" });
  return entries.length <= 40 ? entries : null;
}

export type Reservation = { outcome: "reserved" | "already" } | { outcome: "limited"; code: string };

/**
 * Reserves the budget for ONE outbox row, atomically, in the database. Idempotent per row: a retry, a replay or a second worker holding a stale claim
 * finds the reservation and spends nothing more. A reservation older than six hours (the whole retry schedule is 2.6 h) no longer excuses a send: a later
 * requeue is a new decision and is charged. `at` is null in production (the database clock decides the windows); only tests inject a time. Throws on ANY database error (the caller then sends nothing); the provider call itself cannot be made
 * atomic with this reservation, so a crash between the two leaves the unit spent and unsent (never the reverse): the budget errs on the safe side.
 */
export async function reserveSend(db: Pick<NodePgDatabase, "execute">, outboxId: string, entries: BudgetEntry[], at: Date | null): Promise<Reservation> {
  // Each list travels as one JSON parameter and is rebuilt in order inside SQL (no driver-specific array expansion).
  const list = (values: (string | number)[]) => sql`${JSON.stringify(values)}::jsonb`;
  const arr = (values: (string | number)[], cast: "text" | "integer") => sql`ARRAY(SELECT (t.e)::${sql.raw(cast)} FROM jsonb_array_elements_text(${list(values)}) WITH ORDINALITY AS t(e, o) ORDER BY t.o)`;
  const rows = (await db.execute(sql`SELECT public.reserve_notification_send(${outboxId}, ${arr(entries.map((e) => e.key), "text")}, ${arr(entries.map((e) => e.window), "text")}, ${arr(entries.map((e) => e.limit), "integer")}, ${at}::timestamptz) AS r`)).rows as { r: string }[];
  const answer = rows[0]?.r ?? "";
  if (answer === "reserved" || answer === "already") return { outcome: answer };
  const m = /^limited:(\d+)$/.exec(answer);
  const entry = m ? entries[Number(m[1]) - 1] : undefined;
  if (!entry) throw new Error("budget_answer_invalid");
  return { outcome: "limited", code: entry.code };
}
