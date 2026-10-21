import { z } from "zod";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { orders } from "../db/schema.ts";
import { orderStatuses } from "./order-domain.ts";
import { FINANCE_PAGE_SIZE, pageCountFor } from "./finance.ts";

/**
 * Paginated admin order list (P0-A #3). GET /api/admin/overview silently capped orders/serviceRequests/blogPosts
 * at 100 rows with no way to reach anything older; this reuses the exact page/pageSize/pageCount shape and
 * pageCountFor helper that lib/finance-db.ts already proved out for the sales report, rather than inventing a
 * second pagination scheme. Relative imports on purpose: must load under plain `node --test` (see finance-db.ts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OrdersDb = NodePgDatabase<any>;

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
export const ordersQuerySchema = z.object({
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(10_000).default(1)),
  status: z.preprocess(emptyToUndefined, z.enum(orderStatuses).optional()),
  /** Free text against order number, customer name, city and phone. */
  q: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
});
export type OrdersQuery = z.infer<typeof ordersQuerySchema>;

export type OrderListRow = {
  id: string; orderNumber: string; createdAt: string; customerName: string; city: string;
  total: number; paymentStatus: string; status: string;
};
export type OrderListPage = { rows: OrderListRow[]; page: number; pageSize: number; pageCount: number; total: number };

function filterClause(input: OrdersQuery): SQL | undefined {
  const parts: SQL[] = [];
  if (input.status) parts.push(eq(orders.status, input.status));
  if (input.q) {
    const like = `%${input.q}%`;
    const search = or(ilike(orders.orderNumber, like), ilike(orders.customerName, like), ilike(orders.city, like), ilike(orders.phone, like));
    if (search) parts.push(search);
  }
  return parts.length ? and(...parts) : undefined;
}

/**
 * `status` and `paymentStatus` here are the orders table's own stored columns - exactly what the overview
 * endpoint's orders array already exposed, no new derivation. Ordered newest-first, same tie-break as the
 * finance report (created_at desc, id desc) so pages stay stable while new orders come in.
 */
export async function loadOrdersPage(db: OrdersDb, input: OrdersQuery, pageSize = FINANCE_PAGE_SIZE): Promise<OrderListPage> {
  const where = filterClause(input);
  const [countRow] = await db.select({ n: sql<string>`count(*)::int` }).from(orders).where(where);
  const total = Number(countRow?.n ?? 0);
  const pageCount = pageCountFor(total, pageSize);
  const page = Math.min(input.page, pageCount);
  const rows = await db.select({
    id: orders.id, orderNumber: orders.orderNumber, createdAt: orders.createdAt, customerName: orders.customerName, city: orders.city,
    total: orders.total, paymentStatus: orders.paymentStatus, status: orders.status,
  }).from(orders).where(where).orderBy(desc(orders.createdAt), desc(orders.id)).limit(pageSize).offset((page - 1) * pageSize);
  return { rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), page, pageSize, pageCount, total };
}
