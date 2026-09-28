import "server-only";
import { getDb } from "@/db";
import { auditLogs } from "@/db/schema";
import { runAuditedMutation, type AuditEntry } from "@/lib/admin-mutation";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type AdminActor = { userId: string; email: string };

/** Runs `mutate` and the audit row in ONE transaction (see lib/admin-mutation.ts). Audit ids are generated here, once per attempt. */
export function auditedMutation<R>(actor: AdminActor, entry: { action: string; entityType: string; entityId: string; payload: Record<string, unknown> } | ((result: R) => { action: string; entityType: string; entityId: string; payload: Record<string, unknown> }), mutate: (tx: Tx) => Promise<R>): Promise<R> {
  const build = (e: { action: string; entityType: string; entityId: string; payload: Record<string, unknown> }): AuditEntry => ({ actorUserId: actor.userId, actorEmail: actor.email, ...e });
  return runAuditedMutation<Tx, R>(
    {
      transaction: (work) => getDb().transaction(work),
      insertAudit: async (tx, e) => { await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: e.actorUserId, actorEmail: e.actorEmail, action: e.action, entityType: e.entityType, entityId: e.entityId, payload: e.payload }); },
    },
    typeof entry === "function" ? (result: R) => build(entry(result)) : build(entry),
    mutate,
  );
}
