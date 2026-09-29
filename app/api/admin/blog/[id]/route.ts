import { getDb } from "@/db";
import { getAdminUser } from "@/lib/admin-auth";
import { blogPosts } from "@/db/schema";
import { auditedMutation } from "@/lib/admin-audited";
import { eq } from "drizzle-orm";
import { blogSchema } from "../schema";
import { readJson } from "@/lib/http-security";
import { loadBlogPost } from "@/lib/blog-db";

/** Single post by id (P0-A #3), so blog-editor.tsx can open any post instead of only the 100 most recent from GET /api/admin/overview. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser("admin:read");
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const { id } = await context.params;
  const post = await loadBlogPost(getDb(), id);
  if (!post) return Response.json({ error: "Yazı bulunamadı." }, { status: 404 });
  return Response.json({ post }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){const user=await getAdminUser("content:write");if(!user)return Response.json({error:"Yetkisiz erişim"},{status:403});const parsed=blogSchema.partial().safeParse(await readJson(request,40_000));if(!parsed.success||!Object.keys(parsed.data).length)return Response.json({error:"Alanları kontrol edin."},{status:400});const {id}=await context.params;await auditedMutation(user,{action:"update",entityType:"blog_post",entityId:id,payload:{title:parsed.data.title,slug:parsed.data.slug,status:parsed.data.status}},async(tx)=>{await tx.update(blogPosts).set({...parsed.data,...(parsed.data.status==="published"?{publishedAt:new Date()}:{}),updatedAt:new Date()}).where(eq(blogPosts.id,id))});return Response.json({ok:true})}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAdminUser("content:write");
  if (!user) return Response.json({ error: "Yetkisiz erişim" }, { status: 403 });
  const { id } = await context.params;

  const url = new URL(request.url);
  const hard = url.searchParams.get("hard") === "1";

  if (hard) {
    await auditedMutation(user, { action: "delete", entityType: "blog_post", entityId: id, payload: {} }, async (tx) => { await tx.delete(blogPosts).where(eq(blogPosts.id, id)); });
    return Response.json({ ok: true, hard: true });
  }

  await auditedMutation(user, { action: "archive", entityType: "blog_post", entityId: id, payload: {} }, async (tx) => { await tx.update(blogPosts).set({ status: "draft", updatedAt: new Date() }).where(eq(blogPosts.id, id)); });
  return Response.json({ ok: true, archived: true });
}
