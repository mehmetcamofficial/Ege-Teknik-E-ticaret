import "server-only";
import { getDb } from "@/db";
import { auditedMutationOn } from "@/lib/admin-audited-db";

export type AdminActor = { userId: string; email: string };
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Entry = { action: string; entityType: string; entityId: string; payload: Record<string, unknown> };

/** Runs `mutate` and the audit row in ONE transaction (see lib/admin-mutation.ts). */
export function auditedMutation<R>(actor: AdminActor, entry: Entry | ((result: R) => Entry), mutate: (tx: Tx) => Promise<R>): Promise<R> {
  return auditedMutationOn(getDb(), actor, entry, mutate);
}
