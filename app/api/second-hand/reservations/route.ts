import { getDb } from "@/db";
import { secondHandProducts, secondHandReservations } from "@/db/schema";
import { publicRoute, rateLimit, readJson } from "@/lib/http-security";
import { idempotencyKey } from "@/lib/request-security";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
const schema=z.object({productId:z.string().min(1).max(160),name:z.string().trim().min(2).max(100),phone:z.string().trim().min(7).max(30)});
async function reserve(request:Request){await rateLimit(request,"second-hand-reservation",5,30*60_000);const key=idempotencyKey(request);if(!key)return Response.json({error:"Güvenli istek anahtarı eksik."},{status:400});const parsed=schema.safeParse(await readJson(request,8_000));if(!parsed.success)return Response.json({error:"Rezervasyon bilgilerini kontrol edin."},{status:400});const db=getDb(),id=`reservation-${key}`;const [existing]=await db.select({id:secondHandReservations.id,expiresAt:secondHandReservations.expiresAt}).from(secondHandReservations).where(eq(secondHandReservations.id,id)).limit(1);if(existing)return Response.json({ok:true,reservationId:existing.id,expiresAt:existing.expiresAt});const [product]=await db.select({id:secondHandProducts.id}).from(secondHandProducts).where(and(eq(secondHandProducts.id,parsed.data.productId),eq(secondHandProducts.status,"published"),gt(secondHandProducts.stock,0))).limit(1);if(!product)return Response.json({error:"Ürün rezervasyona uygun değil."},{status:409});const expiresAt=new Date(Date.now()+30*60_000);await db.insert(secondHandReservations).values({id,productId:product.id,name:parsed.data.name,phone:parsed.data.phone,expiresAt});return Response.json({ok:true,reservationId:id,expiresAt},{status:201})}
export const POST=publicRoute(reserve);
