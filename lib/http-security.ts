import { getDb } from "@/db";
import { rateLimitBuckets } from "@/db/schema";
import { sql } from "drizzle-orm";
import { clientIp, hashWithSecret, type HeaderSource } from "@/lib/admin-auth";
import { containsCardData, isSameOrigin } from "@/lib/security-policy";
import { claimRateLimit, maybePurgeExpiredBuckets, type RateLimitStore } from "@/lib/rate-limit";

export function safeError(status=500,message="İşlem tamamlanamadı."){return Response.json({error:message},{status})}
export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export async function readJson(request:Request,maxBytes=32_000){const length=Number(request.headers.get("content-length")||0);if(length>maxBytes)throw new HttpError(413,"İstek boyutu çok büyük.");const text=await request.text();if(new TextEncoder().encode(text).byteLength>maxBytes)throw new HttpError(413,"İstek boyutu çok büyük.");try{const value=JSON.parse(text) as unknown;if(containsCardData(value))throw new HttpError(400,"Kart verisi bu sistem tarafından kabul edilmez.");return value}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,"Geçersiz JSON.")}}
export function assertSameOrigin(request:Request){const origin=request.headers.get("origin"),host=request.headers.get("x-forwarded-host")||request.headers.get("host");if(!origin||!host)throw new HttpError(403,"İstek kaynağı doğrulanamadı.");if(!isSameOrigin(origin,host))throw new HttpError(403,"İstek kaynağı reddedildi.")}
const rateLimitStore:RateLimitStore={
  async claim({key,limit,now,expiresAt}){
    const expired=sql`${rateLimitBuckets.expiresAt} <= ${now}`;
    const rows=await getDb().insert(rateLimitBuckets).values({key,count:1,windowStartedAt:now,expiresAt}).onConflictDoUpdate({
      target:rateLimitBuckets.key,
      set:{count:sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,windowStartedAt:sql`CASE WHEN ${expired} THEN ${now} ELSE ${rateLimitBuckets.windowStartedAt} END`,expiresAt:sql`CASE WHEN ${expired} THEN ${expiresAt} ELSE ${rateLimitBuckets.expiresAt} END`},
      setWhere:sql`${expired} OR ${rateLimitBuckets.count} < ${limit}`,
    }).returning({count:rateLimitBuckets.count});
    return rows.length>0;
  },
  async purgeExpired(cutoff,batch){
    const removed=await getDb().execute(sql`DELETE FROM ${rateLimitBuckets} WHERE ${rateLimitBuckets.key} IN (SELECT ${rateLimitBuckets.key} FROM ${rateLimitBuckets} WHERE ${rateLimitBuckets.expiresAt} < ${cutoff} LIMIT ${batch})`);
    return removed.rowCount??0;
  },
};
export async function rateLimit(request:HeaderSource,scope:string,limit:number,windowMs:number){const key=`${scope}:${await hashWithSecret(clientIp(request))}`,now=new Date();if(!(await claimRateLimit(rateLimitStore,{key,limit,windowMs,now})))throw new HttpError(429,"Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.");await maybePurgeExpiredBuckets(rateLimitStore,now)}
export function publicRoute(handler:(request:Request)=>Promise<Response>){return async(request:Request)=>{try{return await handler(request)}catch(error){if(error instanceof HttpError)return safeError(error.status,error.message);console.error("public_route_error",{name:error instanceof Error?error.name:"unknown"});return safeError()}}}
