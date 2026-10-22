import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { blogPosts } from "../db/schema.ts";
import { FINANCE_PAGE_SIZE, pageCountFor } from "./finance.ts";

/**
 * Paginated admin blog post list + single-post lookup (P0-A #3). Same page/pageSize/pageCount
 * shape as lib/orders-db.ts / lib/service-requests-db.ts / lib/finance-db.ts - one pagination
 * scheme. blog-view.tsx had no search or status filter before this change and still has none
 * here; only the 100-row cap is being fixed, nothing else is added. Relative imports on
 * purpose: must load under plain `node --test` (see finance-db.ts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlogDb = NodePgDatabase<any>;

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
export const blogListQuerySchema = z.object({
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(10_000).default(1)),
});
export type BlogListQuery = z.infer<typeof blogListQuerySchema>;

export type BlogListRow = { id: string; title: string; slug: string; status: string; publishedAt: string | null; updatedAt: string };
export type BlogListPage = { rows: BlogListRow[]; page: number; pageSize: number; pageCount: number; total: number };

/** Same ordering GET /api/admin/overview used for posts (desc(updatedAt)) - most recently touched first. */
export async function loadBlogPostsPage(db: BlogDb, input: BlogListQuery, pageSize = FINANCE_PAGE_SIZE): Promise<BlogListPage> {
  const [countRow] = await db.select({ n: sql<string>`count(*)::int` }).from(blogPosts);
  const total = Number(countRow?.n ?? 0);
  const pageCount = pageCountFor(total, pageSize);
  const page = Math.min(input.page, pageCount);
  const rows = await db.select({
    id: blogPosts.id, title: blogPosts.title, slug: blogPosts.slug, status: blogPosts.status, publishedAt: blogPosts.publishedAt, updatedAt: blogPosts.updatedAt,
  }).from(blogPosts).orderBy(desc(blogPosts.updatedAt), desc(blogPosts.id)).limit(pageSize).offset((page - 1) * pageSize);
  return { rows: rows.map((r) => ({ ...r, publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null, updatedAt: r.updatedAt.toISOString() })), page, pageSize, pageCount, total };
}

export type BlogPostDetail = { id: string; title: string; slug: string; excerpt: string; content: string; imageUrl: string; status: string; publishedAt: string | null; updatedAt: string };

/** Single post by id, for blog-editor.tsx - so a post past the old 100-row cap can still be opened. */
export async function loadBlogPost(db: BlogDb, id: string): Promise<BlogPostDetail | null> {
  const [row] = await db.select({
    id: blogPosts.id, title: blogPosts.title, slug: blogPosts.slug, excerpt: blogPosts.excerpt, content: blogPosts.content, imageUrl: blogPosts.imageUrl,
    status: blogPosts.status, publishedAt: blogPosts.publishedAt, updatedAt: blogPosts.updatedAt,
  }).from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
  if (!row) return null;
  return { ...row, publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null, updatedAt: row.updatedAt.toISOString() };
}
