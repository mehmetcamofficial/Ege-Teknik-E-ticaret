import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.ts";
export { rateLimit, readJson, idempotencyKey } from "./order-route-fakes.ts";
const target = new URL(process.env.P3B_PG_URL ?? "invalid:");
if (!["127.0.0.1", "localhost"].includes(target.hostname) || !target.pathname.startsWith("/sprintb")) throw new Error("P3 tests require disposable loopback PostgreSQL");
export const pool = new pg.Pool({ connectionString: target.href, max: 24 });
const db = drizzle(pool, { schema });
export const getDb = () => db;

export function publicRoute(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try { return await handler(request); }
    catch { return Response.json({ error: "İşlem tamamlanamadı." }, { status: 500 }); }
  };
}
