import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { adminGrants, adminInvites, adminSessions, adminUsers, auditLogs, integrationConfigs } from "@/db/schema";
import { ADMIN_INVITE_MAX_TTL_HOURS, OPERATIONAL_GRANT_MAX_HOURS, PRIVILEGED_GRANT_MAX_HOURS, adminPermissions, adminRoles, maxGrantTtlHours, type AdminPermission, type AdminRole } from "@/lib/security-policy";

/**
 * Phase 6D.1 privileged data layer. Read shapes here deliberately exclude every
 * secret-bearing column (password_hash, token_hash): those columns are never
 * selected, so they cannot leak into a response, HTML, or client bundle.
 */

export type ManagedUserRow = {
  id: string; email: string; role: string; active: boolean;
  lastLoginAt: string | null; lastActivityAt: string | null; createdAt: string;
  grants: { id: string; permission: string; expiresAt: string }[];
};

export async function listManagedUsers(): Promise<ManagedUserRow[]> {
  const db = getDb(), now = new Date();
  const users = await db.select({
    id: adminUsers.id, email: adminUsers.email, role: adminUsers.role,
    active: adminUsers.active, lastLoginAt: adminUsers.lastLoginAt, createdAt: adminUsers.createdAt,
  }).from(adminUsers).orderBy(adminUsers.createdAt);
  const sessions = await db.select({ adminUserId: adminSessions.adminUserId, lastRotatedAt: adminSessions.lastRotatedAt })
    .from(adminSessions).where(and(isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, now)));
  const grants = await db.select({ adminUserId: adminGrants.adminUserId, id: adminGrants.id, permission: adminGrants.permission, expiresAt: adminGrants.expiresAt })
    .from(adminGrants).where(and(isNull(adminGrants.revokedAt), gt(adminGrants.expiresAt, now)));
  return users.map((u) => {
    const userSessions = sessions.filter((s) => s.adminUserId === u.id);
    const latestMs = Math.max(u.lastLoginAt?.getTime() ?? 0, ...userSessions.map((s) => s.lastRotatedAt.getTime()));
    return {
      ...u,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      lastActivityAt: latestMs > 0 ? new Date(latestMs).toISOString() : null,
      createdAt: u.createdAt.toISOString(),
      grants: grants.filter((g) => g.adminUserId === u.id).map((g) => ({ id: g.id, permission: g.permission, expiresAt: g.expiresAt.toISOString() })),
    };
  });
}

export type PendingInviteRow = { id: string; email: string; role: string; expiresAt: string; createdAt: string; invitedBy: string };

export async function listPendingInvites(): Promise<PendingInviteRow[]> {
  const db = getDb(), now = new Date();
  const rows = await db.select().from(adminInvites)
    .where(and(isNull(adminInvites.acceptedAt), isNull(adminInvites.revokedAt), gt(adminInvites.expiresAt, now)))
    .orderBy(desc(adminInvites.createdAt));
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, expiresAt: r.expiresAt.toISOString(), createdAt: r.createdAt.toISOString(), invitedBy: r.invitedBy }));
}

export type AuditRow = { id: string; actorEmail: string; action: string; entityType: string; entityId: string; createdAt: string };

export async function listAuditHistory(input: { actorUserId?: string; limit?: number }): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const db = getDb();
  const rows = await db.select({
    id: auditLogs.id, actorEmail: auditLogs.actorEmail, action: auditLogs.action,
    entityType: auditLogs.entityType, entityId: auditLogs.entityId, createdAt: auditLogs.createdAt,
  }).from(auditLogs)
    .where(input.actorUserId ? eq(auditLogs.actorUserId, input.actorUserId) : undefined)
    .orderBy(desc(auditLogs.createdAt)).limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function listIntegrationStatus(): Promise<{ key: string; displayName: string; configured: boolean; hint: string; updatedAt: string | null }[]> {
  const rows = await getDb().select().from(integrationConfigs);
  return rows.map((r) => ({ key: r.key, displayName: r.displayName, configured: r.configured, hint: r.hint, updatedAt: r.updatedAt?.toISOString() ?? null }));
}

// ---- validation helpers (shared by the privileged routes) -------------------------------------------
export const INVITABLE_ROLES: readonly string[] = ["super_admin", "admin", "operations_manager", "catalog_manager", "support_agent", "viewer"];
export const ASSIGNABLE_ROLES = INVITABLE_ROLES;

export function isInvitableRole(role: string): boolean {
  return (INVITABLE_ROLES as readonly string[]).includes(role) && role !== "owner";
}

/** The retired "owner" role is never assignable - only invitable legacy roles and the two new ones. */
export function isAssignableRole(role: string): boolean {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role) && role !== "owner";
}

/** A permission string coming from a request body must be one the policy actually knows. */
export function isKnownPermission(permission: string): permission is AdminPermission {
  return (adminPermissions["super_admin"] as readonly string[]).includes(permission);
}

export function grantTtlError(permission: AdminPermission, ttlHours: number): string | null {
  const ceiling = maxGrantTtlHours(permission);
  if (ceiling === 0) return "Bu yetki süreli olarak verilemez (yalnızca kalıcı rol ile taşınır).";
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > ceiling) {
    return ceiling <= 24
      ? `Yetkili işlemler için süre en fazla ${ceiling} saat olabilir.`
      : `Süre 1-${ceiling} saat arasında olmalıdır (1/8/24 saat veya 7 gün).`;
  }
  return null;
}

export function inviteTtlError(ttlHours: number): string | null {
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > ADMIN_INVITE_MAX_TTL_HOURS) {
    return `Davet süresi 1-${ADMIN_INVITE_MAX_TTL_HOURS} saat arasında olmalıdır.`;
  }
  return null;
}

export function isKnownRole(role: string): role is AdminRole {
  return (adminRoles as readonly string[]).includes(role);
}

export function privilegedGrantTtlError(permission: AdminPermission, ttlHours: number): string | null {
  if ((["users:write", "roles:write", "security:write"] as readonly string[]).includes(permission) && ttlHours > PRIVILEGED_GRANT_MAX_HOURS) {
    return `Bu yetki için süre en fazla ${PRIVILEGED_GRANT_MAX_HOURS} saat olabilir.`;
  }
  return null;
}

export { OPERATIONAL_GRANT_MAX_HOURS };