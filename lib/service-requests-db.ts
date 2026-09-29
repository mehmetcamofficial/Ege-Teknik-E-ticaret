import { z } from "zod";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { serviceRequests } from "../db/schema.ts";
import { OPEN_SERVICE_STATUSES, serviceStatuses } from "./admin-ui.ts";
import { FINANCE_PAGE_SIZE, pageCountFor } from "./finance.ts";

/**
 * Paginated admin service-request list (P0-A #3). Same page/pageSize/pageCount shape and
 * pageCountFor helper as lib/orders-db.ts / lib/finance-db.ts - one pagination scheme, not three.
 * Relative imports on purpose: must load under plain `node --test` (see finance-db.ts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServiceRequestsDb = NodePgDatabase<any>;

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
/** "open" (the service-requests-view.tsx default) | "all" | one exact status. */
export const serviceRequestsQuerySchema = z.object({
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(10_000).default(1)),
  filter: z.preprocess(emptyToUndefined, z.union([z.literal("open"), z.literal("all"), z.enum(serviceStatuses)]).default("open")),
  /** Free text against request number, name, city, type, phone and email. */
  q: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
});
export type ServiceRequestsQuery = z.infer<typeof serviceRequestsQuerySchema>;

export type ServiceRequestListRow = {
  id: string; requestNumber: string; createdAt: string; type: string; name: string; phone: string; email: string; city: string; message: string; status: string;
};
export type ServiceRequestListPage = { rows: ServiceRequestListRow[]; page: number; pageSize: number; pageCount: number; total: number };

function filterClause(input: ServiceRequestsQuery): SQL | undefined {
  const parts: SQL[] = [];
  if (input.filter === "open") parts.push(inArray(serviceRequests.status, OPEN_SERVICE_STATUSES));
  else if (input.filter !== "all") parts.push(eq(serviceRequests.status, input.filter));
  if (input.q) {
    const like = `%${input.q}%`;
    const search = or(ilike(serviceRequests.requestNumber, like), ilike(serviceRequests.name, like), ilike(serviceRequests.city, like), ilike(serviceRequests.type, like), ilike(serviceRequests.phone, like), ilike(serviceRequests.email, like));
    if (search) parts.push(search);
  }
  return parts.length ? and(...parts) : undefined;
}

/** `status` is the service_requests table's own stored column, unchanged meaning from the overview endpoint this replaces. */
export async function loadServiceRequestsPage(db: ServiceRequestsDb, input: ServiceRequestsQuery, pageSize = FINANCE_PAGE_SIZE): Promise<ServiceRequestListPage> {
  const where = filterClause(input);
  const [countRow] = await db.select({ n: sql<string>`count(*)::int` }).from(serviceRequests).where(where);
  const total = Number(countRow?.n ?? 0);
  const pageCount = pageCountFor(total, pageSize);
  const page = Math.min(input.page, pageCount);
  const rows = await db.select({
    id: serviceRequests.id, requestNumber: serviceRequests.requestNumber, createdAt: serviceRequests.createdAt, type: serviceRequests.type,
    name: serviceRequests.name, phone: serviceRequests.phone, email: serviceRequests.email, city: serviceRequests.city, message: serviceRequests.message, status: serviceRequests.status,
  }).from(serviceRequests).where(where).orderBy(desc(serviceRequests.createdAt), desc(serviceRequests.id)).limit(pageSize).offset((page - 1) * pageSize);
  return { rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), page, pageSize, pageCount, total };
}
