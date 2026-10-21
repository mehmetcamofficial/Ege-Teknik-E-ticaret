import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { blogPosts } from "@/db/schema";
import { auditedMutation } from "@/lib/admin-audited";
import { readJson } from "@/lib/http-security";
import { blogSchema } from "./schema";
import { blogListQuerySchema, loadBlogPostsPage } from "@/lib/blog-db";

/**
 * Paginated blog post list (P0-A #3). Replaces the admin panel's dependence on GET
 * /api/admin/overview's posts array, which silently capped at 100 rows. Same page/pageSize/
 * pageCount shape as GET /api/admin/orders and GET /api/admin/service-requests.
 */
export async function GET(request: Request) {
  const user = await getAdminUser("admin:read");
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const query = blogListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: "Geçersiz sorgu." }, { status: 400 });
  const result = await loadBlogPostsPage(getDb(), query.data);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

export async function POST(request:Request){const user=await getAdminUser("content:write");if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});const parsed=blogSchema.safeParse(await readJson(request,40_000));if(!parsed.success)return Response.json({error:"Yazı alanlarını kontrol edin."},{status:400});const id=crypto.randomUUID();await auditedMutation(user,{action:"create",entityType:"blog_post",entityId:id,payload:{title:parsed.data.title,slug:parsed.data.slug,status:parsed.data.status}},async(tx)=>{await tx.insert(blogPosts).values({id,...parsed.data,publishedAt:parsed.data.status==="published"?new Date():null})});return Response.json({ok:true,id},{status:201})}
