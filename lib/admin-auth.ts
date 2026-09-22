import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";

const scrypt = promisify(scryptCallback), COOKIE = "ege_admin_session", SESSION_MS = 8 * 60 * 60 * 1000, ROTATE_MS = 30 * 60 * 1000;
export type AdminRole = "owner" | "operations_manager" | "catalog_manager" | "support_agent" | "viewer";
export type AdminPermission = "catalog:write" | "orders:write" | "service:write" | "content:write" | "admin:read";
const permissions: Record<AdminRole, AdminPermission[]> = { owner:["catalog:write","orders:write","service:write","content:write","admin:read"],operations_manager:["catalog:write","orders:write","service:write","admin:read"],catalog_manager:["catalog:write","content:write","admin:read"],support_agent:["orders:write","service:write","admin:read"],viewer:["admin:read"] };
export type AuthorizedAdmin={userId:string;email:string;displayName:string;role:AdminRole};

const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");
export async function verifyPassword(password:string,encoded:string){const [algorithm,salt,expected]=encoded.split("$");if(algorithm!=="scrypt"||!salt||!expected)return false;const actual=await scrypt(password,salt,64) as Buffer;const expectedBuffer=Buffer.from(expected,"hex");return actual.length===expectedBuffer.length&&timingSafeEqual(actual,expectedBuffer)}
export async function createAdminSession(adminUserId:string,request:Request){const token=randomBytes(32).toString("base64url"),now=new Date(),expiresAt=new Date(now.getTime()+SESSION_MS),db=getDb();await db.insert(adminSessions).values({id:crypto.randomUUID(),adminUserId,tokenHash:sha256(token),expiresAt,lastRotatedAt:now,ipHash:await hashWithSecret(clientIp(request)),userAgentHash:sha256(request.headers.get("user-agent")||"")});const jar=await cookies();jar.set(COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",expires:expiresAt});return expiresAt}
export async function revokeAdminSession(){const jar=await cookies(),token=jar.get(COOKIE)?.value;if(token)await getDb().update(adminSessions).set({revokedAt:new Date()}).where(eq(adminSessions.tokenHash,sha256(token)));jar.set(COOKIE,"",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:0})}
export async function getAdminUser(required:AdminPermission="admin:read"):Promise<AuthorizedAdmin|null>{const jar=await cookies(),token=jar.get(COOKIE)?.value;if(!token)return null;const db=getDb(),now=new Date();const [row]=await db.select({session:adminSessions,user:adminUsers}).from(adminSessions).innerJoin(adminUsers,eq(adminUsers.id,adminSessions.adminUserId)).where(and(eq(adminSessions.tokenHash,sha256(token)),isNull(adminSessions.revokedAt),gt(adminSessions.expiresAt,now),eq(adminUsers.active,true))).limit(1);if(!row)return null;const role=row.user.role as AdminRole;if(!permissions[role]?.includes(required))return null;if(now.getTime()-row.session.lastRotatedAt.getTime()>ROTATE_MS){const next=randomBytes(32).toString("base64url");await db.update(adminSessions).set({tokenHash:sha256(next),lastRotatedAt:now}).where(eq(adminSessions.id,row.session.id));try{jar.set(COOKIE,next,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",expires:row.session.expiresAt})}catch{}}return{userId:row.user.id,email:row.user.email,displayName:row.user.email,role}}
export async function hashWithSecret(value:string){const secret=process.env.IP_HASH_SALT;if(!secret||secret.length<32)throw new Error("IP_HASH_SALT must contain at least 32 characters");return sha256(`${secret}:${value}`)}
export function clientIp(request:Request){return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||request.headers.get("x-real-ip")||"unknown"}
export const sessionCookieName=COOKIE;
