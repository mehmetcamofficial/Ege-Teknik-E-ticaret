import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { runMigration, safeErrorSummary } from "./migrate-lib.mjs";

// Thin runner. All guards, timeouts and bounded cleanup live in migrate-lib.mjs (unit-tested).
// process.exit is deliberate: after the bounded cleanup, a half-dead socket must not keep the process alive.
runMigration({ Pool: pg.Pool, drizzle, migrate }).then(
  () => process.exit(0),
  (error) => { console.error(`Migration failed: ${safeErrorSummary(error)}`); process.exit(1); },
);
