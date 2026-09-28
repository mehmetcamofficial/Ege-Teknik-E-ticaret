import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg, { type PoolClient } from "pg";
import { bootstrapFirstAdmin, validateFirstAdminInput, type FirstAdminTransaction } from "../lib/first-admin-bootstrap.ts";
import { assertBootstrapEnvironment, preparePreGovernanceMigrations, projectRoot, readPassword, safeBootstrapError } from "./bootstrap-first-admin-lib.mjs";
import { closePoolBounded, createMigrationPool, MigrationGuardError } from "./migrate-lib.mjs";

const BOOTSTRAP_LOCK_NAMESPACE = 1_164_674_121;
const BOOTSTRAP_LOCK_KEY = 1;

async function main() {
  const { url } = assertBootstrapEnvironment(process.env);
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  if (!email) throw new MigrationGuardError("ADMIN_BOOTSTRAP_EMAIL is required.");
  const password = await readPassword();
  validateFirstAdminInput({ email, password });
  const staged = await preparePreGovernanceMigrations(join(projectRoot, "drizzle-pg"));
  const pool = createMigrationPool({ url, Pool: pg.Pool });
  pool.on("error", () => {});
  let client: PoolClient | undefined;

  try {
    const connected: PoolClient = await pool.connect();
    client = connected;
    await connected.query("SELECT pg_advisory_lock($1::integer, $2::integer)", [BOOTSTRAP_LOCK_NAMESPACE, BOOTSTRAP_LOCK_KEY]);
    console.log("Environment validated.");

    // The operator explicitly invoked this command. Apply only 0000..0010 with the
    // official Drizzle migrator, then stop before immutable governance migration 0011.
    await migrate(drizzle(connected), { migrationsFolder: staged.directory });

    await bootstrapFirstAdmin({ email, password }, {
      newId: randomUUID,
      transactionExclusive: async (work) => {
        await connected.query("BEGIN");
        try {
          const ledger = await connected.query<{ created_at: string }>(
            "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1",
          );
          if (Number(ledger.rows[0]?.created_at) !== staged.lastPreGovernanceTimestamp) {
            throw new Error("Database migration state is not immediately before governance migration 0011.");
          }
          const tx: FirstAdminTransaction = {
            countAdmins: async () => {
              const result = await connected.query<{ value: string }>('SELECT count(*)::text AS value FROM "admin_users"');
              return Number(result.rows[0]?.value);
            },
            insertAdmin: async (row) => {
              await connected.query(
                'INSERT INTO "admin_users" ("id","external_user_id","email","password_hash","role","active") VALUES ($1,$2,$3,$4,$5,$6)',
                [row.id, row.externalUserId, row.email, row.passwordHash, row.role, row.active],
              );
            },
            insertAudit: async (row) => {
              await connected.query(
                'INSERT INTO "audit_logs" ("id","actor_user_id","actor_email","action","entity_type","entity_id","payload") VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',
                [row.id, row.actorUserId, row.actorEmail, row.action, row.entityType, row.entityId, JSON.stringify(row.payload)],
              );
            },
          };
          const result = await work(tx);
          await connected.query("COMMIT");
          return result;
        } catch (error) {
          await connected.query("ROLLBACK").catch(() => {});
          throw error;
        }
      },
    });

    console.log("Admin state validated: 0 existing administrators.");
    console.log("First administrator created successfully.");
    console.log("You may now run migrations.");
  } finally {
    if (client) {
      await client.query("SELECT pg_advisory_unlock($1::integer, $2::integer)", [BOOTSTRAP_LOCK_NAMESPACE, BOOTSTRAP_LOCK_KEY]).catch(() => {});
      client.release();
    }
    await closePoolBounded(pool);
    await staged.cleanup();
  }
}

main().catch((error) => {
  console.error(`First-admin bootstrap failed: ${safeBootstrapError(error)}`);
  process.exitCode = 1;
});
