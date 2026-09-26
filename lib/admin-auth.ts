import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { adminGrants, adminInvites, adminPasswordResets, adminSessions, adminUsers, auditLogs } from "@/db/schema";
import { sendMail } from "@/lib/mail";
import { hashPassword } from "@/lib/password";
import { verifyPassword } from "@/lib/password";
import { ADMIN_INVITE_MAX_TTL_HOURS, PASSWORD_RESET_TOKEN_TTL_MS, SESSION_TTL_MS, canRemovePrivileged, findSecretLeak, isGrantActive, isPrivilegedRole, maxGrantTtlHours, roleHasPermission, shouldRotateSession, type AdminPermission, type AdminRole } from "@/lib/security-policy";

const COOKIE = "ege_admin_session";
export type { AdminPermission, AdminRole };
export { verifyPassword };
export type AuthorizedAdmin={userId:string;email:string;displayName:string;role:AdminRole};

const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");
const cookieOptions=(extra:Record<string,unknown>)=>({httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict" as const,path:"/",...extra});
export async function createAdminSession(adminUserId:string,request:Request){const token=randomBytes(32).toString("base64url"),now=new Date(),expiresAt=new Date(now.getTime()+SESSION_TTL_MS),db=getDb();await db.insert(adminSessions).values({id:crypto.randomUUID(),adminUserId,tokenHash:sha256(token),expiresAt,lastRotatedAt:now,ipHash:await hashWithSecret(clientIp(request)),userAgentHash:sha256(request.headers.get("user-agent")||"")});const jar=await cookies();jar.set(COOKIE,token,cookieOptions({expires:expiresAt}));return expiresAt}
export async function revokeAdminSession(){const jar=await cookies(),token=jar.get(COOKIE)?.value;if(token)await getDb().update(adminSessions).set({revokedAt:new Date()}).where(eq(adminSessions.tokenHash,sha256(token)));jar.set(COOKIE,"",cookieOptions({maxAge:0}))}
export async function getAdminUser(required:AdminPermission="admin:read"):Promise<AuthorizedAdmin|null>{const jar=await cookies(),token=jar.get(COOKIE)?.value;if(!token)return null;const db=getDb(),now=new Date();const [row]=await db.select({session:adminSessions,user:adminUsers}).from(adminSessions).innerJoin(adminUsers,eq(adminUsers.id,adminSessions.adminUserId)).where(and(eq(adminSessions.tokenHash,sha256(token)),isNull(adminSessions.revokedAt),gt(adminSessions.expiresAt,now),eq(adminUsers.active,true))).limit(1);if(!row)return null;const role=row.user.role as AdminRole;if(await hasEffectivePermission(row.user.id,role,required,now)) { if(shouldRotateSession(row.session.lastRotatedAt,now)){const next=randomBytes(32).toString("base64url");await db.update(adminSessions).set({tokenHash:sha256(next),lastRotatedAt:now}).where(eq(adminSessions.id,row.session.id));try{jar.set(COOKIE,next,cookieOptions({expires:row.session.expiresAt}))}catch{}}return{userId:row.user.id,email:row.user.email,displayName:row.user.email,role} } return null}

/**
 * Effective permission = base role permission OR a live time-boxed grant.
 * Grants are evaluated on the server clock every request (expiry is never trusted
 * from the client). payments:configure can never be granted (maxGrantTtlHours = 0).
 */
export async function hasEffectivePermission(adminUserId: string, role: AdminRole, required: AdminPermission, now = new Date()): Promise<boolean> {
  if (roleHasPermission(role, required)) return true;
  const rows = await getDb().select({ permission: adminGrants.permission, expiresAt: adminGrants.expiresAt, revokedAt: adminGrants.revokedAt })
    .from(adminGrants).where(and(eq(adminGrants.adminUserId, adminUserId), isNull(adminGrants.revokedAt), gt(adminGrants.expiresAt, now)));
  return rows.some((g) => g.permission === required && isGrantActive(g, now));
}

/** Authorization boundary PayTR will later use. No route calls this yet (out of scope). */
export async function requirePaymentsConfigure(): Promise<AuthorizedAdmin | null> {
  return getAdminUser("payments:configure");
}

/**
 * Secret-safe audit insert: any secret-shaped key in the payload refuses the whole
 * write, so the privileged mutation it belongs to rolls back with it.
 */
export async function auditPrivileged(tx: Tx, actor: { userId: string; email: string }, action: string, entityType: string, entityId: string, payload: Record<string, unknown>): Promise<void> {
  const leak = findSecretLeak(payload);
  if (leak) throw new Error(`audit payload refused: secret-shaped key "${leak}"`);
  await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.userId, actorEmail: actor.email, action, entityType, entityId, payload });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Active super_admin count inside a transaction (FOR UPDATE lock on the counted rows). */
export async function countActiveSuperAdminsTx(tx: Tx): Promise<number> {
  const rows = await tx.select({ id: adminUsers.id }).from(adminUsers).where(and(eq(adminUsers.role, "super_admin"), eq(adminUsers.active, true))).for("update");
  return rows.length;
}

/**
 * Deactivate a user + revoke every live session atomically.
 * Refuses when the target is the last active super_admin (final recovery authority).
 */
export async function deactivateAdminUser(targetId: string, actor: { userId: string; email: string }): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "LAST_SUPER_ADMIN" }> {
  const db = getDb(), now = new Date();
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(adminUsers).where(eq(adminUsers.id, targetId)).for("update").limit(1);
    if (!target) return { ok: false as const, code: "NOT_FOUND" as const };
    const targetIsActiveSuperAdmin = target.role === "super_admin" && target.active === true;
    if (targetIsActiveSuperAdmin && !canRemovePrivileged({ activeSuperAdminCount: await countActiveSuperAdminsTx(tx), targetIsActiveSuperAdmin: true })) {
      return { ok: false as const, code: "LAST_SUPER_ADMIN" as const };
    }
    await tx.update(adminUsers).set({ active: false, updatedAt: now }).where(eq(adminUsers.id, targetId));
    await tx.update(adminSessions).set({ revokedAt: now }).where(and(eq(adminSessions.adminUserId, targetId), isNull(adminSessions.revokedAt)));
    await auditPrivileged(tx, actor, "deactivate", "admin_user", targetId, { email: target.email, previousRole: target.role });
    return { ok: true as const };
  });
}

/**
 * Reactivate a previously deactivated user, atomically with audit.
 * A legacy inactive "owner" cannot be reactivated as owner: it must first be
 * converted to an allowed role (the DB trigger refuses the same transition).
 */
export async function reactivateAdminUser(targetId: string, actor: { userId: string; email: string }): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "RETIRED_ROLE" }> {
  const db = getDb(), now = new Date();
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(adminUsers).where(eq(adminUsers.id, targetId)).for("update").limit(1);
    if (!target) return { ok: false as const, code: "NOT_FOUND" as const };
    if (target.role === "owner") return { ok: false as const, code: "RETIRED_ROLE" as const };
    await tx.update(adminUsers).set({ active: true, updatedAt: now }).where(eq(adminUsers.id, targetId));
    await auditPrivileged(tx, actor, "reactivate", "admin_user", targetId, { email: target.email, role: target.role });
    return { ok: true as const };
  });
}

/**
 * Change a user's role atomically with audit. Demoting the last active super_admin
 * is refused; demotion additionally revokes live sessions (privilege drop = re-auth).
 * Legacy "owner" can never be assigned: the invite/role Zod enums exclude it and the
 * DB trigger rejects conversion-to-owner as the final backstop.
 */
export async function changeAdminRole(targetId: string, nextRole: AdminRole, actor: { userId: string; email: string }): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "LAST_SUPER_ADMIN" | "RETIRED_ROLE" }> {
  if (nextRole === "owner") return { ok: false as const, code: "RETIRED_ROLE" as const };
  const db = getDb(), now = new Date();
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(adminUsers).where(eq(adminUsers.id, targetId)).for("update").limit(1);
    if (!target) return { ok: false as const, code: "NOT_FOUND" as const };
    const targetIsActiveSuperAdmin = target.role === "super_admin" && target.active === true;
    const demotingPrivileged = isPrivilegedRole(target.role) && !isPrivilegedRole(nextRole);
    if (targetIsActiveSuperAdmin && demotingPrivileged && !canRemovePrivileged({ activeSuperAdminCount: await countActiveSuperAdminsTx(tx), targetIsActiveSuperAdmin: true })) {
      return { ok: false as const, code: "LAST_SUPER_ADMIN" as const };
    }
    await tx.update(adminUsers).set({ role: nextRole, updatedAt: now }).where(eq(adminUsers.id, targetId));
    if (demotingPrivileged) {
      await tx.update(adminSessions).set({ revokedAt: now }).where(and(eq(adminSessions.adminUserId, targetId), isNull(adminSessions.revokedAt)));
    }
    await auditPrivileged(tx, actor, "role_change", "admin_user", targetId, { email: target.email, from: target.role, to: nextRole });
    return { ok: true as const };
  });
}
export async function hashWithSecret(value:string){const secret=process.env.IP_HASH_SALT;if(!secret||secret.length<32)throw new Error("IP_HASH_SALT must contain at least 32 characters");return sha256(`${secret}:${value}`)}
/** Anything with a Headers-like .get(name) - a real Request, or next/headers' headers() (used by Server Actions, which have no Request object). */
export type HeaderSource={headers:{get(name:string):string|null}};
export function clientIp(request:HeaderSource){return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||request.headers.get("x-real-ip")||"unknown"}
export const sessionCookieName=COOKIE;

// ---- Phase 6D.1: invitations (hash-only token, Resend delivery only) --------------------------------
export type InviteCreateInput = { email: string; role: AdminRole; ttlHours: number };
export type InviteCreateResult = { ok: true; inviteId: string } | { ok: false; code: "RETIRED_ROLE" | "TTL_EXCEEDED" | "MAIL_FAILED" };

/**
 * Creates an invite row (sha256 of the token only) and emails the raw token link
 * through the existing Resend path. The raw token is NEVER returned, logged, or
 * audited - only recipient/role/expiry metadata enters the audit trail.
 */
export async function createAdminInvite(input: InviteCreateInput, actor: { userId: string; email: string }, request: Request): Promise<InviteCreateResult> {
  if (input.role === "owner") return { ok: false as const, code: "RETIRED_ROLE" as const };
  if (!Number.isInteger(input.ttlHours) || input.ttlHours < 1 || input.ttlHours > ADMIN_INVITE_MAX_TTL_HOURS) {
    return { ok: false as const, code: "TTL_EXCEEDED" as const };
  }
  const db = getDb(), now = new Date();
  const token = randomBytes(32).toString("base64url");
  const inviteId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + input.ttlHours * 3_600_000);
  await db.insert(adminInvites).values({ id: inviteId, email: input.email.toLowerCase(), role: input.role, tokenHash: sha256(token), expiresAt, invitedBy: actor.userId });
  const inviteUrl = `${new URL(request.url).origin}/admin/accept-invite?token=${token}`;
  const mail = await sendMail({
    to: input.email,
    subject: "Ege Teknik yönetim daveti",
    text: `Ege Teknik yönetim paneline ${input.role} rolüyle davet edildiniz. Bağlantı ${input.ttlHours} saat geçerlidir.\n\n${inviteUrl}\n\nBu daveti beklemiyorsanız bu e-postayı yok sayın.`,
  });
  if (!mail.ok) {
    await db.update(adminInvites).set({ revokedAt: now }).where(eq(adminInvites.id, inviteId));
    await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.userId, actorEmail: actor.email, action: "invite_failed", entityType: "admin_invite", entityId: inviteId, payload: { email: input.email, role: input.role } });
    return { ok: false as const, code: "MAIL_FAILED" as const };
  }
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.userId, actorEmail: actor.email, action: "invite", entityType: "admin_invite", entityId: inviteId, payload: { email: input.email, role: input.role, ttlHours: input.ttlHours } });
  return { ok: true as const, inviteId };
}

export type InviteAcceptResult = { ok: true; adminId: string } | { ok: false; code: "INVALID" | "EXPIRED" | "RETIRED_ROLE" };

/**
 * Single-use invite acceptance: the conditional UPDATE (WHERE accepted_at IS NULL
 * AND revoked_at IS NULL) is the concurrency guard - a replay or race finds 0 rows.
 */
export async function acceptAdminInvite(rawToken: string, password: string): Promise<InviteAcceptResult> {
  const db = getDb(), now = new Date(), tokenHash = sha256(rawToken);
  const [invite] = await db.select().from(adminInvites).where(eq(adminInvites.tokenHash, tokenHash)).limit(1);
  if (!invite || invite.acceptedAt !== null || invite.revokedAt !== null) return { ok: false as const, code: "INVALID" as const };
  if (invite.expiresAt.getTime() <= now.getTime()) return { ok: false as const, code: "EXPIRED" as const };
  if (invite.role === "owner") return { ok: false as const, code: "RETIRED_ROLE" as const };
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const claimed = await tx.update(adminInvites).set({ acceptedAt: now })
      .where(and(eq(adminInvites.id, invite.id), isNull(adminInvites.acceptedAt), isNull(adminInvites.revokedAt))).returning({ id: adminInvites.id });
    if (!claimed.length) return { ok: false as const, code: "INVALID" as const };
    const adminId = crypto.randomUUID();
    await tx.insert(adminUsers).values({ id: adminId, externalUserId: `invite:${invite.id}`, email: invite.email, passwordHash, role: invite.role });
    await auditPrivileged(tx, { userId: adminId, email: invite.email }, "invite_accepted", "admin_user", adminId, { inviteId: invite.id, role: invite.role });
    return { ok: true as const, adminId };
  });
}

// ---- Phase 6D.1: time-boxed grants ------------------------------------------------------------------
export type GrantCreateResult = { ok: true; grantId: string } | { ok: false; code: "UNGRANTABLE" | "TTL_EXCEEDED" };

/**
 * Creates a time-boxed grant. payments:configure is ungrantable (returns
 * UNGRANTABLE before any write). TTL ceilings: privileged <= 24h, operational <= 168h.
 */
export async function createAdminGrant(input: { adminUserId: string; permission: AdminPermission; ttlHours: number; reason: string }, actor: { userId: string; email: string }): Promise<GrantCreateResult> {
  const ceiling = maxGrantTtlHours(input.permission);
  if (ceiling === 0) return { ok: false as const, code: "UNGRANTABLE" as const };
  if (!Number.isInteger(input.ttlHours) || input.ttlHours < 1 || input.ttlHours > ceiling) {
    return { ok: false as const, code: "TTL_EXCEEDED" as const };
  }
  const db = getDb(), now = new Date();
  const grantId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + input.ttlHours * 3_600_000);
  await db.transaction(async (tx) => {
    await tx.insert(adminGrants).values({ id: grantId, adminUserId: input.adminUserId, permission: input.permission, reason: input.reason.slice(0, 200), expiresAt, grantedBy: actor.userId });
    await auditPrivileged(tx, actor, "grant", "admin_grant", grantId, { targetUserId: input.adminUserId, permission: input.permission, ttlHours: input.ttlHours });
  });
  return { ok: true as const, grantId };
}

export async function revokeAdminGrant(grantId: string, actor: { userId: string; email: string }): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" }> {
  const db = getDb(), now = new Date();
  return db.transaction(async (tx) => {
    const revoked = await tx.update(adminGrants).set({ revokedAt: now })
      .where(and(eq(adminGrants.id, grantId), isNull(adminGrants.revokedAt))).returning({ id: adminGrants.id });
    if (!revoked.length) return { ok: false as const, code: "NOT_FOUND" as const };
    await auditPrivileged(tx, actor, "grant_revoke", "admin_grant", grantId, {});
    return { ok: true as const };
  });
}

// ---- forgot / reset password (Phase 6B) --------------------------------------------------------
export type ResetRequestOutcome = { status: "sent" } | { status: "no_such_admin" } | { status: "email_not_configured" } | { status: "send_failed" };

/**
 * Always does the same amount of DB work whether or not the e-mail belongs to an active admin -
 * the caller (app/api/auth/forgot-password/route.ts) must respond identically regardless of this
 * function's result, which exists only for internal reporting/testing, never for the public
 * response. The raw token is returned to the caller exactly once (embedded in the e-mail body);
 * it is never logged, stored, or included in the audit trail - only its sha256 hash is persisted.
 */
export async function requestPasswordReset(email: string, request: Request): Promise<ResetRequestOutcome> {
  const db = getDb();
  const [admin] = await db.select({ id: adminUsers.id, email: adminUsers.email, active: adminUsers.active }).from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  if (!admin || !admin.active) return { status: "no_such_admin" };

  const token = randomBytes(32).toString("base64url");
  const now = new Date(), expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS);
  // Supersede any still-outstanding token for this admin: only the most recently requested link should ever work.
  await db.update(adminPasswordResets).set({ usedAt: now }).where(and(eq(adminPasswordResets.adminUserId, admin.id), isNull(adminPasswordResets.usedAt)));
  await db.insert(adminPasswordResets).values({ id: crypto.randomUUID(), adminUserId: admin.id, tokenHash: sha256(token), expiresAt, requestIpHash: await hashWithSecret(clientIp(request)) });

  const resetUrl = `${new URL(request.url).origin}/admin/reset-password?token=${token}`;
  const mail = await sendMail({
    to: admin.email,
    subject: "Ege Teknik yönetici parola sıfırlama",
    text: `Parolanızı sıfırlamak için aşağıdaki bağlantıyı kullanın. Bağlantı 1 saat içinde geçersiz olur.\n\n${resetUrl}\n\nBu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; hesabınızda herhangi bir değişiklik yapılmayacaktır.`,
  });
  if (!mail.ok) return { status: mail.reason === "not_configured" ? "email_not_configured" : "send_failed" };
  return { status: "sent" };
}

export type ResetConsumeOutcome = { ok: true } | { ok: false };

/**
 * Single-use, atomically with the password update and full session revocation: the conditional
 * UPDATE (WHERE ... AND used_at IS NULL) is the actual concurrency guard, exactly like
 * lib/reviews-db.ts's moderateReview - a second attempt at the same token (replay, or a race with
 * a concurrent attempt) always finds 0 rows and fails, whatever the initial lookup saw.
 */
export async function consumePasswordResetToken(rawToken: string, newPasswordHash: string): Promise<ResetConsumeOutcome> {
  const db = getDb(), now = new Date(), tokenHash = sha256(rawToken);
  const [row] = await db.select({ id: adminPasswordResets.id, adminUserId: adminPasswordResets.adminUserId, adminEmail: adminUsers.email })
    .from(adminPasswordResets).innerJoin(adminUsers, eq(adminUsers.id, adminPasswordResets.adminUserId))
    .where(and(eq(adminPasswordResets.tokenHash, tokenHash), isNull(adminPasswordResets.usedAt), gt(adminPasswordResets.expiresAt, now), eq(adminUsers.active, true)))
    .limit(1);
  if (!row) return { ok: false };

  return db.transaction(async (tx) => {
    const consumed = await tx.update(adminPasswordResets).set({ usedAt: now }).where(and(eq(adminPasswordResets.id, row.id), isNull(adminPasswordResets.usedAt))).returning({ id: adminPasswordResets.id });
    if (!consumed.length) return { ok: false };
    await tx.update(adminUsers).set({ passwordHash: newPasswordHash, updatedAt: now }).where(eq(adminUsers.id, row.adminUserId));
    await tx.update(adminSessions).set({ revokedAt: now }).where(and(eq(adminSessions.adminUserId, row.adminUserId), isNull(adminSessions.revokedAt)));
    await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: row.adminUserId, actorEmail: row.adminEmail, action: "password_reset", entityType: "admin_user", entityId: row.adminUserId, payload: { method: "forgot_password" } });
    return { ok: true };
  });
}
