import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { serviceRequests } from "../db/schema.ts";
import { loadServiceRequestsPage, serviceRequestsQuerySchema, type ServiceRequestsDb } from "../lib/service-requests-db.ts";

/**
 * P0-A #3: GET /api/admin/overview silently capped service requests at 100 rows. loadServiceRequestsPage
 * replaces that, reusing lib/finance.ts's FINANCE_PAGE_SIZE/pageCountFor - not a new pagination scheme.
 */
test("serviceRequestsQuerySchema: filter defaults to open, coerces page, and rejects an unknown status", () => {
  assert.deepEqual(serviceRequestsQuerySchema.parse({}), { page: 1, filter: "open" });
  assert.equal(serviceRequestsQuerySchema.parse({ filter: "all" }).filter, "all");
  assert.equal(serviceRequestsQuerySchema.parse({ filter: "scheduled" }).filter, "scheduled");
  assert.equal(serviceRequestsQuerySchema.safeParse({ filter: "not-a-status" }).success, false);
  assert.equal(serviceRequestsQuerySchema.parse({ page: "2" }).page, 2);
});

// ---- real-PostgreSQL checks, opt-in exactly like tests/finance-db.test.ts -----------------------------------
const url = process.env.FINANCE_TEST_DATABASE_URL;
const skip = !url && "FINANCE_TEST_DATABASE_URL not set (disposable migrated database required)";
let pool: pg.Pool;
let db: ServiceRequestsDb;
const run = crypto.randomUUID().slice(0, 8);
const at = (day: number) => new Date(Date.UTC(2006, 0, 1 + day, 3));

async function makeRequest(n: number, opts: { status?: string; name?: string; city?: string; phone?: string; type?: string } = {}) {
  const id = `sr-db-${run}-${n}`;
  await db.insert(serviceRequests).values({
    id, requestNumber: `SRDB-${run}-${n}`, idempotencyKey: `sr-db-key-${run}-${n}`, type: opts.type ?? "Bakım",
    name: opts.name ?? `Müşteri ${n}`, phone: opts.phone ?? "05000000000", city: opts.city ?? "Aydın", message: "Test mesajı",
    status: opts.status ?? "new", createdAt: at(n), updatedAt: at(n),
  });
  return id;
}

before(async () => {
  if (skip) return;
  pool = new pg.Pool({ connectionString: url });
  db = drizzle(pool) as ServiceRequestsDb;
  for (let n = 1; n <= 6; n++) await makeRequest(n);
  await makeRequest(7, { status: "completed", name: `Tamamlandı-${run} Müşteri` });
  await makeRequest(8, { status: "cancelled" });
});
after(async () => { if (pool) await pool.end(); });

test("loadServiceRequestsPage's default 'open' filter excludes completed and cancelled requests", { skip }, async () => {
  const open = await loadServiceRequestsPage(db, { page: 1, filter: "open" }, 20);
  const ids = open.rows.map((r) => r.id);
  assert.ok(ids.includes(`sr-db-${run}-1`));
  assert.ok(!ids.includes(`sr-db-${run}-7`));
  assert.ok(!ids.includes(`sr-db-${run}-8`));
});

test("loadServiceRequestsPage 'all' includes every status, and a specific status filters to just that one", { skip }, async () => {
  const all = await loadServiceRequestsPage(db, { page: 1, filter: "all" }, 20);
  assert.ok(all.total >= 8);
  const completed = await loadServiceRequestsPage(db, { page: 1, filter: "completed" }, 20);
  assert.ok(completed.rows.every((r) => r.status === "completed"));
  assert.ok(completed.rows.some((r) => r.id === `sr-db-${run}-7`));
});

test("loadServiceRequestsPage paginates newest-first and searches by name", { skip }, async () => {
  const page1 = await loadServiceRequestsPage(db, { page: 1, filter: "all" }, 3);
  assert.equal(page1.rows.length, 3);
  assert.equal(page1.rows[0]!.id, `sr-db-${run}-8`);

  const byName = await loadServiceRequestsPage(db, { page: 1, filter: "all", q: `Tamamlandı-${run}` }, 20);
  assert.deepEqual(byName.rows.map((r) => r.id), [`sr-db-${run}-7`]);
});
