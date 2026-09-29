import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { blogPosts } from "../db/schema.ts";
import { blogListQuerySchema, loadBlogPost, loadBlogPostsPage, type BlogDb } from "../lib/blog-db.ts";

/**
 * P0-A #3: GET /api/admin/overview silently capped blog posts at 100 rows, and blog-editor.tsx
 * depended on that same capped array to look up a single post by id. loadBlogPostsPage /
 * loadBlogPost replace both, reusing lib/finance.ts's FINANCE_PAGE_SIZE/pageCountFor.
 */
test("blogListQuerySchema: page defaults to 1 and coerces", () => {
  assert.deepEqual(blogListQuerySchema.parse({}), { page: 1 });
  assert.equal(blogListQuerySchema.parse({ page: "4" }).page, 4);
});

// ---- real-PostgreSQL checks, opt-in exactly like tests/finance-db.test.ts -----------------------------------
const url = process.env.FINANCE_TEST_DATABASE_URL;
const skip = !url && "FINANCE_TEST_DATABASE_URL not set (disposable migrated database required)";
let pool: pg.Pool;
let db: BlogDb;
const run = crypto.randomUUID().slice(0, 8);
const at = (day: number) => new Date(Date.UTC(2007, 0, 1 + day, 3));

async function makePost(n: number, opts: { status?: string } = {}) {
  const id = `blog-db-${run}-${n}`;
  await db.insert(blogPosts).values({
    id, slug: `blog-db-${run}-${n}`, title: `Yazı ${n}`, excerpt: "Özet", content: "İçerik ".repeat(5),
    status: opts.status ?? "draft", publishedAt: opts.status === "published" ? at(n) : null, createdAt: at(n), updatedAt: at(n),
  });
  return id;
}

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: url });
  db = drizzle(pool) as BlogDb;
  for (let n = 1; n <= 7; n++) await makePost(n);
  await makePost(8, { status: "published" });
});
after(async () => { if (pool) await pool.end(); });

test("loadBlogPostsPage paginates newest-updated-first with a correct pageCount", { skip }, async () => {
  const page1 = await loadBlogPostsPage(db, { page: 1 }, 3);
  assert.equal(page1.rows.length, 3);
  assert.equal(page1.total >= 8, true);
  assert.equal(page1.rows[0]!.id, `blog-db-${run}-8`);
  const overshoot = await loadBlogPostsPage(db, { page: 999 }, 3);
  assert.equal(overshoot.page, overshoot.pageCount);
});

test("loadBlogPost returns a full single post by id, or null when it does not exist", { skip }, async () => {
  const found = await loadBlogPost(db, `blog-db-${run}-8`);
  assert.ok(found);
  assert.equal(found!.status, "published");
  assert.equal(found!.title, "Yazı 8");
  assert.equal(await loadBlogPost(db, "not-a-real-post-id"), null);
});
