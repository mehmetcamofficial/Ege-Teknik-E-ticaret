/**
 * H5-A: transactional notification outbox.
 *
 * - enqueue (inside the checkout transaction, in a SAVEPOINT): an outbox failure - missing table, missing grant, anything -
 *   rolls back only the savepoint, so an order is NEVER lost or refused because of notification plumbing.
 * - deliver (after commit, by an authorized worker): rows are claimed with FOR UPDATE SKIP LOCKED, sent through an injected
 *   provider with the dedupe key as the provider idempotency key, then marked sent / rescheduled / dead.
 * - nothing here logs or stores a recipient address, subject or body; audit lines carry a masked address.
 */
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.ts";
import { maskEmail, renderAdminNewOrder, renderCustomerOrderReceived, type OrderEmailData, type Rendered, type SiteLinks } from "./templates.ts";
import { providerStatus, type NotificationProvider } from "./provider.ts";
import { budgetConfig, budgetEntries, reserveSend } from "./send-budget.ts";
import { DEFAULT_SWEEP_WINDOW_MINUTES, sweepBounds } from "./sweep-window.ts";
import { sqlStateOf } from "./sqlstate.ts";

const { auditLogs, notificationOutbox, orderItems } = schema;
type Db = NodePgDatabase<typeof schema>;
type Tx = Pick<Db, "insert" | "select" | "update" | "execute" | "transaction">;

export const OUTBOX_KINDS = ["order_customer_received", "order_admin_new"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];
export const MAX_ATTEMPTS = 5;
/** Delay after failed attempt n (1-based). Five attempts in total: 1 min, 5 min, 30 min, 2 h between them. */
export const RETRY_DELAYS_SECONDS = [60, 300, 1800, 7200] as const;
export const LOCK_SECONDS = 300;
export const SWEEP_WINDOW_MINUTES = DEFAULT_SWEEP_WINDOW_MINUTES;
export const SYSTEM_ACTOR = { userId: "system:notification-worker", email: "system@notifications.invalid" } as const;
export const dedupeKeyFor = (orderId: string, kind: OutboxKind): string => `order:${orderId}:${kind}`;

export function retryDelaySeconds(attemptsMade: number): number | null {
  return attemptsMade >= MAX_ATTEMPTS ? null : RETRY_DELAYS_SECONDS[Math.min(attemptsMade, RETRY_DELAYS_SECONDS.length) - 1] ?? RETRY_DELAYS_SECONDS.at(-1)!;
}

/** Called INSIDE the order transaction after every order row is written. Never throws. */
export async function enqueueOrderNotifications(tx: Pick<Db, "transaction">, orderId: string): Promise<{ queued: boolean; code?: string }> {
  try {
    await tx.transaction(async (savepoint) => {
      await savepoint.insert(notificationOutbox).values(OUTBOX_KINDS.map((kind) => ({ id: crypto.randomUUID(), kind, orderId, dedupeKey: dedupeKeyFor(orderId, kind) }))).onConflictDoNothing();
    });
    return { queued: true };
  } catch (error) {
    const code = sqlStateOf(error);
    console.error("notification_enqueue_failed", { code });
    return { queued: false, code };
  }
}

export type WorkerEnv = Record<string, string | undefined>;
export const siteLinks = (env: WorkerEnv): SiteLinks => ({ siteOrigin: env.SITE_ORIGIN?.trim() || "https://egeteknik.tr", adminOrigin: env.ADMIN_ORIGIN?.trim() || env.SITE_ORIGIN?.trim() || undefined });

const EMAIL_SHAPE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export function parseRecipientList(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_SHAPE.test(s)))].slice(0, 10);
}

type NotificationOrderRow = {
  id: string; orderNumber: string; createdAt: Date | string; subtotal: number; vatTotal: number; shippingTotal: number; installationTotal: number; total: number;
  customerName: string; email: string; installationPreference: string | null; city: string; paymentStatus: string; status: string;
  district: string | null; deliveryMethod: string | null;
};

async function loadOrder(db: Tx, orderId: string): Promise<(OrderEmailData & { orderId: string; email: string }) | null> {
  // The worker role has NO privilege on the orders table. It reads an order only through public.notification_orders, which carries the 14
  // columns the e-mails need plus the district and the delivery method extracted from the shipping snapshot. Phone, street address (both live
  // inside that snapshot), notes, billing snapshot, fingerprint and idempotency key are not reachable. Orders that predate the delivery
  // snapshot have NULL there and get the same defaults as before ("dealer", no district).
  const [o] = (await db.execute(sql`
    SELECT id, order_number AS "orderNumber", created_at AS "createdAt", subtotal, vat_total AS "vatTotal", shipping_total AS "shippingTotal",
           installation_total AS "installationTotal", total, customer_name AS "customerName", email, installation_preference AS "installationPreference",
           city, payment_status AS "paymentStatus", status, district, delivery_method AS "deliveryMethod"
    FROM public.notification_orders WHERE id = ${orderId} LIMIT 1`)).rows as NotificationOrderRow[];
  if (!o) return null;
  const items = await db.select({ productName: orderItems.productName, quantity: orderItems.quantity, unitPrice: orderItems.unitPrice, lineTotal: orderItems.lineTotal }).from(orderItems).where(eq(orderItems.orderId, orderId));
  return {
    orderId: o.id, orderNumber: o.orderNumber, createdAt: new Date(o.createdAt), items, subtotal: o.subtotal, vatTotal: o.vatTotal, shippingTotal: o.shippingTotal, installationTotal: o.installationTotal, total: o.total,
    customerName: o.customerName, email: o.email, deliveryMethod: o.deliveryMethod ?? "dealer", installationIncluded: o.installationPreference === "included_standard",
    city: o.city, district: o.district ?? "", paymentStatus: o.paymentStatus, status: o.status,
  };
}

/** Operations recipients come ONLY from ORDER_ALERT_EMAILS. The worker role has no access to admin_users, so there is no table fallback. */
const adminRecipients = (env: WorkerEnv): string[] => parseRecipientList(env.ORDER_ALERT_EMAILS);

export type ProcessResult = { processed: number; sent: number; retried: number; dead: number; suppressed: number };

export async function dispatchOutbox(input: { db: Db; provider: NotificationProvider | null; env: WorkerEnv; now?: Date; limit?: number }): Promise<ProcessResult & { providerConfigured: boolean }> {
  const { db, provider, env } = input, now = input.now ?? new Date(), limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const status = providerStatus(env);
  const budget = budgetConfig(env);                                  // R-04: no send budget configured = nothing is sent (rows stay pending, no attempt is burned)
  const empty = { processed: 0, sent: 0, retried: 0, dead: 0, suppressed: 0, providerConfigured: status.configured && budget.ok };
  // Not configured: rows stay pending and untouched (no attempt is burned); the admin panel shows the reason.
  if (!provider || !status.configured || !budget.ok) return empty;
  // Rows whose lock expired after the final allowed attempt are dead, never re-sent.
  await db.execute(sql`UPDATE notification_outbox SET status = 'dead', last_error_code = 'stalled', locked_until = NULL, claim_token = NULL WHERE status = 'sending' AND locked_until < ${now} AND attempts >= ${MAX_ATTEMPTS}`);
  const claimed = (await db.execute(sql`
    UPDATE notification_outbox SET status = 'sending', locked_until = ${new Date(now.getTime() + LOCK_SECONDS * 1000)}, attempts = attempts + 1, last_attempt_at = ${now},
      claim_token = replace(gen_random_uuid()::text, '-', '')
    WHERE id IN (SELECT id FROM notification_outbox WHERE (status = 'pending' AND next_attempt_at <= ${now}) OR (status = 'sending' AND locked_until < ${now})
                 ORDER BY next_attempt_at, created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, kind, order_id AS "orderId", dedupe_key AS "dedupeKey", attempts, claim_token AS "claimToken"`)).rows as { id: string; kind: OutboxKind; orderId: string; dedupeKey: string; attempts: number; claimToken: string }[];
  const result = { ...empty, processed: claimed.length };
  for (const row of claimed) {
    // Fencing (R-03). Every claim carries its own random token; a result is applied only WHERE the row still holds THAT token, so a worker whose
    // lease expired and whose row was re-claimed, requeued or finished by someone else changes nothing and writes no audit line. The state change
    // and its audit row are ONE statement (the audit INSERT reads the UPDATE's RETURNING; it has no RETURNING of its own because the worker may append
    // audit rows but not read them), so they commit or fail together. Returns whether this
    // claim was still the owner. `attempts` is deliberately not the fence: a requeue resets it to 0, so an old claim could match a new one.
    const finish = async (outcome: "sent" | "retry" | "dead" | "suppressed", code: string | null, masked: string): Promise<boolean> => {
      let change, action: string, payload: Record<string, unknown>;
      if (outcome === "sent") {
        change = sql`status = 'sent', sent_at = ${now}, last_error_code = NULL`; action = "notification_sent"; payload = { kind: row.kind, attempts: row.attempts, recipient: masked };
      } else if (outcome === "retry") {
        const delay = retryDelaySeconds(row.attempts) ?? RETRY_DELAYS_SECONDS.at(-1)!;
        change = sql`status = 'pending', next_attempt_at = ${new Date(now.getTime() + delay * 1000)}, last_error_code = ${code}`;
        action = "notification_retry_scheduled"; payload = { kind: row.kind, attempts: row.attempts, code, delaySeconds: delay, recipient: masked };
      } else if (outcome === "suppressed") {
        // The send budget (R-04) is exhausted: terminal and explicit, never retried by itself; an operator can requeue it after the window.
        change = sql`status = 'dead', last_error_code = ${code}`; action = "notification_suppressed"; payload = { kind: row.kind, attempts: row.attempts, code, recipient: masked };
      } else {
        change = sql`status = 'dead', last_error_code = ${code}`; action = "notification_dead"; payload = { kind: row.kind, attempts: row.attempts, code, recipient: masked };
      }
      // Explicit audit columns preserve the worker's column-level INSERT ACL (request_id, ip_hash and created_at keep their defaults).
      const applied = (await db.execute(sql`
        WITH moved AS (
          UPDATE notification_outbox SET ${change}, locked_until = NULL, claim_token = NULL
          WHERE id = ${row.id} AND status = 'sending' AND claim_token = ${row.claimToken} RETURNING id),
        logged AS (
          INSERT INTO public.audit_logs (id, actor_user_id, actor_email, action, entity_type, entity_id, payload)
          SELECT ${crypto.randomUUID()}, ${SYSTEM_ACTOR.userId}, ${SYSTEM_ACTOR.email}, ${action}, 'notification', moved.id, ${JSON.stringify(payload)}::jsonb FROM moved)
        SELECT id FROM moved`)).rows.length === 1;
      if (!applied) { console.warn("notification_claim_lost", { kind: row.kind, outcome }); return false; }
      if (outcome === "sent") result.sent++; else if (outcome === "retry") result.retried++; else if (outcome === "suppressed") result.suppressed++; else result.dead++;
      return true;
    };
    // Before anything is sent: is this claim still ours, and extend the lease from NOW so the whole send (provider timeout included) fits inside it
    // however long the earlier rows of the batch took. A lost claim means another worker owns the row: this one must not send it.
    const holdClaim = async () => (await db.execute(sql`
      UPDATE notification_outbox SET locked_until = ${new Date((input.now ?? new Date()).getTime() + LOCK_SECONDS * 1000)}
      WHERE id = ${row.id} AND status = 'sending' AND claim_token = ${row.claimToken} RETURNING id`)).rows.length === 1;
    try {
      if (!/^[0-9a-f]{32}$/.test(row.claimToken ?? "")) throw new Error("claim_token_invalid");   // fail closed: never send a row whose claim cannot be proven
      const order = await loadOrder(db, row.orderId);
      if (!order) { await finish("dead", "order_missing", "***"); continue; }
      let to: string[], rendered: Rendered;
      if (row.kind === "order_customer_received") {
        to = EMAIL_SHAPE.test(order.email) ? [order.email.trim()] : [];
        rendered = renderCustomerOrderReceived(order, siteLinks(env));
      } else {
        to = adminRecipients(env);
        rendered = renderAdminNewOrder(order, siteLinks(env));
      }
      const masked = to.length ? to.map(maskEmail).join(",") : "***";
      if (!to.length) { await finish("dead", row.kind === "order_customer_received" ? "invalid_recipient" : "no_recipient", masked); continue; }
      const entries = budgetEntries(budget.config, row.kind === "order_customer_received" ? "customer" : "ops", to);
      if (!entries) { await finish("dead", "invalid_recipient", masked); continue; }
      if (!(await holdClaim())) { console.warn("notification_claim_lost", { kind: row.kind, outcome: "before_send" }); continue; }
      // R-04: reserve the send budget (atomic, idempotent per row) AFTER ownership is proven and BEFORE the provider is called. Any failure to
      // reserve sends nothing. The reservation and the provider call cannot be one transaction: a crash in between leaves the unit spent, never unspent.
      let reservation;
      try { reservation = await reserveSend(db, row.id, entries, input.now ?? null); }
      catch (error) {
        console.error("notification_budget_unavailable", { kind: row.kind, code: sqlStateOf(error) });
        await finish(row.attempts < MAX_ATTEMPTS ? "retry" : "dead", "budget_unavailable", masked);
        continue;
      }
      if (reservation.outcome === "limited") { await finish("suppressed", reservation.code, masked); continue; }
      const sent = await provider.send({ to, ...rendered, idempotencyKey: row.dedupeKey });
      if (sent.ok) await finish("sent", null, masked);
      else if (sent.retryable && row.attempts < MAX_ATTEMPTS) await finish("retry", sent.code, masked);
      else await finish("dead", sent.retryable ? "attempts_exhausted" : sent.code, masked);
    } catch (error) {
      // The row is still 'sending' with a lock; it becomes due again when the lock expires. Only the kind and a SQLSTATE are logged.
      console.error("notification_dispatch_row_failed", { kind: row.kind, code: sqlStateOf(error) });
    }
  }
  return result;
}

/**
 * Re-enqueues orders that have no outbox row (recovers a refused or failed savepoint). By default only the last 30 minutes; with
 * NOTIFICATION_SWEEP_WINDOW_MINUTES + a go-live floor NOTIFICATION_SWEEP_NOT_BEFORE it also recovers a long worker outage (see
 * sweep-window.ts). Orders from before the floor are never touched, and the unique dedupe key makes a duplicate notification impossible.
 */
export async function sweepMissingNotifications(db: Db, now = new Date(), env: WorkerEnv = {}): Promise<number> {
  const { since, settled } = sweepBounds(env, now);
  const res = await db.execute(sql`
    INSERT INTO notification_outbox (id, kind, order_id, dedupe_key)
    SELECT gen_random_uuid()::text, k.kind, o.id, 'order:' || o.id || ':' || k.kind
    FROM public.notification_orders o CROSS JOIN (VALUES ('order_customer_received'), ('order_admin_new')) AS k(kind)
    WHERE o.created_at >= ${since} AND o.created_at <= ${settled}
    ON CONFLICT (dedupe_key) DO NOTHING`);
  return res.rowCount ?? 0;
}

export async function runNotificationWorker(input: { db: Db; provider: NotificationProvider | null; env: WorkerEnv; now?: Date; limit?: number }) {
  const swept = await sweepMissingNotifications(input.db, input.now, input.env);
  return { swept, ...(await dispatchOutbox(input)) };
}

/** dead -> pending (attempts reset). Caller authorizes and audits the human actor; this only moves the row. */
export async function requeueDeadNotification(db: Db, id: string, actor: { userId: string; email: string }, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.update(notificationOutbox).set({ status: "pending", attempts: 0, nextAttemptAt: now, lastErrorCode: null, lockedUntil: null })
      .where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, "dead"))).returning({ id: notificationOutbox.id, kind: notificationOutbox.kind });
    if (!rows.length) return false;
    await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.userId, actorEmail: actor.email, action: "notification_requeued", entityType: "notification", entityId: id, payload: { kind: rows[0].kind } });
    return true;
  });
}

export async function operationsSummary(db: Db, env: WorkerEnv, now = new Date()) {
  const counts = (await db.execute(sql`SELECT status, kind, count(*)::int AS n FROM notification_outbox GROUP BY 1, 2`)).rows as { status: string; kind: string; n: number }[];
  const [oldest] = (await db.execute(sql`SELECT extract(epoch FROM (${now}::timestamptz - min(created_at)))::int AS age FROM notification_outbox WHERE status IN ('pending','sending')`)).rows as { age: number | null }[];
  const [o] = (await db.execute(sql`SELECT count(*) FILTER (WHERE status = 'pending_payment')::int AS awaiting, count(*) FILTER (WHERE created_at >= ${new Date(now.getTime() - 86_400_000)})::int AS last24h, max(created_at) AS newest FROM orders`)).rows as { awaiting: number; last24h: number; newest: Date | null }[];
  const suppressedRows = (await db.execute(sql`SELECT last_error_code AS code, count(*)::int AS n FROM notification_outbox WHERE status = 'dead' AND last_error_code LIKE 'rate\\_limited\\_%' GROUP BY 1`)).rows as { code: string; n: number }[];
  const suppressed = Object.fromEntries(suppressedRows.map((r) => [r.code, r.n]));
  const byStatus: Record<string, number> = { pending: 0, sending: 0, sent: 0, dead: 0 };
  for (const c of counts) byStatus[c.status] = (byStatus[c.status] ?? 0) + c.n;
  const provider = providerStatus(env), budget = budgetConfig(env);
  return { orders: { awaitingPayment: o?.awaiting ?? 0, last24h: o?.last24h ?? 0, newestAt: o?.newest ? new Date(o.newest).toISOString() : null },
    notifications: { providerConfigured: provider.configured && budget.ok, providerReason: provider.reason ?? (budget.ok ? null : budget.reason), adminRecipientsConfigured: parseRecipientList(env.ORDER_ALERT_EMAILS).length > 0, byStatus, suppressed, oldestWaitingSeconds: oldest?.age ?? null } };
}
