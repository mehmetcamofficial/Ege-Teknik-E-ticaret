import { runAuditedMutation, type AuditEntry } from "./admin-mutation.ts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.ts";

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Entry = { action: string; entityType: string; entityId: string; payload: Record<string, unknown> };

/** Runs `mutate` and the audit row in ONE PostgreSQL transaction (audit last); see lib/admin-mutation.ts. */
export function auditedMutationOn<R>(db: Db, actor: { userId: string; email: string }, entry: Entry | ((result: R) => Entry), mutate: (tx: Tx) => Promise<R>): Promise<R> {
  const build = (e: Entry): AuditEntry => ({ actorUserId: actor.userId, actorEmail: actor.email, ...e });
  return runAuditedMutation<Tx, R>(
    {
      transaction: (work) => db.transaction(work),
      insertAudit: async (tx, e) => { await tx.insert(schema.auditLogs).values({ id: crypto.randomUUID(), actorUserId: e.actorUserId, actorEmail: e.actorEmail, action: e.action, entityType: e.entityType, entityId: e.entityId, payload: e.payload }); },
    },
    typeof entry === "function" ? (result: R) => build(entry(result)) : build(entry),
    mutate,
  );
}
