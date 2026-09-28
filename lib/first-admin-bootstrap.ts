import { hashPassword } from "./password.ts";
import { validatePasswordPolicy } from "./password-policy.ts";
import { z } from "zod";

export const FIRST_ADMIN_ROLE = "owner" as const;

const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());

export class FirstAdminBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirstAdminBootstrapError";
  }
}

export type FirstAdminInput = { email: string; password: string };
export type FirstAdminRow = {
  id: string;
  externalUserId: string;
  email: string;
  passwordHash: string;
  role: typeof FIRST_ADMIN_ROLE;
  active: true;
};
export type FirstAdminAudit = {
  id: string;
  actorUserId: string;
  actorEmail: string;
  action: "bootstrap";
  entityType: "admin_user";
  entityId: string;
  payload: { role: typeof FIRST_ADMIN_ROLE; reason: "pre_migration_first_admin_bootstrap" };
};

export type FirstAdminTransaction = {
  countAdmins(): Promise<number>;
  insertAdmin(row: FirstAdminRow): Promise<void>;
  insertAudit(row: FirstAdminAudit): Promise<void>;
};

export type FirstAdminBootstrapDependencies = {
  transactionExclusive<T>(work: (tx: FirstAdminTransaction) => Promise<T>): Promise<T>;
  newId(): string;
  hashPassword?: typeof hashPassword;
};

export function validateFirstAdminInput(input: FirstAdminInput): { email: string; password: string } {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) throw new FirstAdminBootstrapError("A valid administrator email is required.");
  const password = validatePasswordPolicy(input.password);
  if (!password.ok) throw new FirstAdminBootstrapError("The administrator password does not satisfy the project password policy.");
  return { email: email.data, password: input.password };
}

/**
 * Creates the single legacy owner that unchanged migration 0011 requires.
 * The dependency owns the database transaction and exclusive/advisory lock.
 */
export async function bootstrapFirstAdmin(input: FirstAdminInput, deps: FirstAdminBootstrapDependencies): Promise<{ ok: true }> {
  const validated = validateFirstAdminInput(input);
  return deps.transactionExclusive(async (tx) => {
    if (await tx.countAdmins() !== 0) throw new FirstAdminBootstrapError("First-admin bootstrap requires exactly zero existing administrators.");
    const id = deps.newId();
    const passwordHash = await (deps.hashPassword ?? hashPassword)(validated.password);
    await tx.insertAdmin({
      id,
      externalUserId: `bootstrap:${id}`,
      email: validated.email,
      passwordHash,
      role: FIRST_ADMIN_ROLE,
      active: true,
    });
    await tx.insertAudit({
      id: deps.newId(),
      actorUserId: id,
      actorEmail: validated.email,
      action: "bootstrap",
      entityType: "admin_user",
      entityId: id,
      payload: { role: FIRST_ADMIN_ROLE, reason: "pre_migration_first_admin_bootstrap" },
    });
    return { ok: true as const };
  });
}
