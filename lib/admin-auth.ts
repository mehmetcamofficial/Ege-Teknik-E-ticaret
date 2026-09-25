import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { adminPasswordResets, adminSessions, adminUsers, auditLogs } from "@/db/schema";
import { sendMail } from "@/lib/mail";
import { verifyPassword } from "@/lib/password";
import { PASSWORD_RESET_TOKEN_TTL_MS, SESSION_TTL_MS, roleHasPermission, shouldRotateSession, type AdminPermission, type AdminRole } from "@/lib/security-policy";

const COOKIE = "ege_admin_session";
export type { AdminPermission, AdminRole };
export { verifyPassword };
export type AuthorizedAdmin={userId:string;email:string;displayName:string;role:AdminRole};

const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");
const cookieOptions=(extra:Record<string,unknown>)=>({httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict" as const,path:"/",...extra});
export async function createAdminSession(adminUserId:string,request:Request){const token=randomBytes(32).toString("base64url"),now=new Date(),expiresAt=new Date(now.getTime()+SESSION_TTL_MS),db=getDb();await db.insert(adminSessions).values({id:crypto.randomUUID(),adminUserId,tokenHash:sha256(token),expiresAt,lastRotatedAt:now,ipHash:await hashWithSecret(clientIp(request)),userAgentHash:sha256(request.headers.get("user-agent")||"")});const jar=await cookies();jar.set(COOKIE,token,cookieOptions({expires:expiresAt}));return expiresAt}
export async function revokeAdminSession(){const jar=await cookies(),token=jar.get(COOKIE)?.value;if(token)await getDb().update(adminSessions).set({revokedAt:new Date()}).where(eq(adminSessions.tokenHash,sha256(token)));jar.set(COOKIE,"",cookieOptions({maxAge:0}))}
export async function getAdminUser(required:AdminPermission="admin:read"):Promise<AuthorizedAdmin|null>{const jar=await cookies(),token=jar.get(COOKIE)?.value;if(!token)return null;const db=getDb(),now=new Date();const [row]=await db.select({session:adminSessions,user:adminUsers}).from(adminSessions).innerJoin(adminUsers,eq(adminUsers.id,adminSessions.adminUserId)).where(and(eq(adminSessions.tokenHash,sha256(token)),isNull(adminSessions.revokedAt),gt(adminSessions.expiresAt,now),eq(adminUsers.active,true))).limit(1);if(!row)return null;const role=row.user.role as AdminRole;if(!roleHasPermission(role,required))return null;if(shouldRotateSession(row.session.lastRotatedAt,now)){const next=randomBytes(32).toString("base64url");await db.update(adminSessions).set({tokenHash:sha256(next),lastRotatedAt:now}).where(eq(adminSessions.id,row.session.id));try{jar.set(COOKIE,next,cookieOptions({expires:row.session.expiresAt}))}catch{}}return{userId:row.user.id,email:row.user.email,displayName:row.user.email,role}}
export async function hashWithSecret(value:string){const secret=process.env.IP_HASH_SALT;if(!secret||secret.length<32)throw new Error("IP_HASH_SALT must contain at least 32 characters");return sha256(`${secret}:${value}`)}
/** Anything with a Headers-like .get(name) - a real Request, or next/headers' headers() (used by Server Actions, which have no Request object). */
export type HeaderSource={headers:{get(name:string):string|null}};
export function clientIp(request:HeaderSource){return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||request.headers.get("x-real-ip")||"unknown"}
export const sessionCookieName=COOKIE;

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
