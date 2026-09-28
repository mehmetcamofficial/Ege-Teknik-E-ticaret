/**
 * A governed admin mutation and its audit row commit or roll back TOGETHER.
 * The audit is written LAST inside the same transaction: if the insert fails the business change is undone, and
 * a failed mutation (thrown, or a domain refusal that throws) never leaves an audit row behind.
 * This module has no database imports so the guarantee is unit-testable; lib/admin-audited.ts binds it to Drizzle.
 */
export type AuditEntry = { actorUserId: string; actorEmail: string; action: string; entityType: string; entityId: string; payload: Record<string, unknown> };
export type AuditedDeps<Tx> = {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  insertAudit(tx: Tx, entry: AuditEntry): Promise<void>;
};

export async function runAuditedMutation<Tx, R>(deps: AuditedDeps<Tx>, entry: AuditEntry | ((result: R) => AuditEntry), mutate: (tx: Tx) => Promise<R>): Promise<R> {
  return deps.transaction(async (tx) => {
    const result = await mutate(tx);
    await deps.insertAudit(tx, typeof entry === "function" ? entry(result) : entry);
    return result;
  });
}
