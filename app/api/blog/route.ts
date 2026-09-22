import { getDb } from "@/db";
import { blogPosts } from "@/db/schema";
import { desc,eq } from "drizzle-orm";
export async function GET(){const posts=await getDb().select().from(blogPosts).where(eq(blogPosts.status,"published")).orderBy(desc(blogPosts.publishedAt));return Response.json({posts})}
