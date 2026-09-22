import { getAdminUser } from "@/lib/admin-auth";
import { getDb } from "@/db";
import { auditLogs, blogPosts } from "@/db/schema";
import { readJson } from "@/lib/http-security";
import { blogSchema } from "./schema";

export async function POST(request:Request){const user=await getAdminUser("content:write");if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});const parsed=blogSchema.safeParse(await readJson(request,40_000));if(!parsed.success)return Response.json({error:"Yazı alanlarını kontrol edin."},{status:400});const id=crypto.randomUUID(),db=getDb();await db.insert(blogPosts).values({id,...parsed.data,publishedAt:parsed.data.status==="published"?new Date():null});await db.insert(auditLogs).values({id:crypto.randomUUID(),actorUserId:user.userId,actorEmail:user.email,action:"create",entityType:"blog_post",entityId:id,payload:{title:parsed.data.title,slug:parsed.data.slug,status:parsed.data.status}});return Response.json({ok:true,id},{status:201})}
