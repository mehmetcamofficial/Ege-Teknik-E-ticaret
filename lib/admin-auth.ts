import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import { verifyPassword } from "@/lib/password";
import { SESSION_TTL_MS, roleHasPermission, shouldRotateSession, type AdminPermission, type AdminRole } from "@/lib/security-policy";

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
export function clientIp(request:Request){return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||request.headers.get("x-real-ip")||"unknown"}
export const sessionCookieName=COOKIE;
