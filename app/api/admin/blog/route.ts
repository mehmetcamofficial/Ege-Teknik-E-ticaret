import { getAdminUser } from "@/lib/admin-auth";
import { blogPosts } from "@/db/schema";
import { auditedMutation } from "@/lib/admin-audited";
import { readJson } from "@/lib/http-security";
import { blogSchema } from "./schema";

export async function POST(request:Request){const user=await getAdminUser("content:write");if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});const parsed=blogSchema.safeParse(await readJson(request,40_000));if(!parsed.success)return Response.json({error:"Yazı alanlarını kontrol edin."},{status:400});const id=crypto.randomUUID();await auditedMutation(user,{action:"create",entityType:"blog_post",entityId:id,payload:{title:parsed.data.title,slug:parsed.data.slug,status:parsed.data.status}},async(tx)=>{await tx.insert(blogPosts).values({id,...parsed.data,publishedAt:parsed.data.status==="published"?new Date():null})});return Response.json({ok:true,id},{status:201})}
