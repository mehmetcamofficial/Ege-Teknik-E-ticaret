import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  FIRST_ADMIN_ROLE,
  FirstAdminBootstrapError,
  bootstrapFirstAdmin,
  validateFirstAdminInput,
  type FirstAdminAudit,
  type FirstAdminRow,
  type FirstAdminTransaction,
} from "../lib/first-admin-bootstrap.ts";
import {
  MIGRATION_0011_SHA256,
  PRODUCTION_BOOTSTRAP_CONFIRMATION,
  assertBootstrapEnvironment,
  preparePreGovernanceMigrations,
  safeBootstrapError,
} from "../scripts/bootstrap-first-admin-lib.mjs";

const PASSWORD = "correct horse battery staple 42";
const HASH = "scrypt$test-salt$test-derived-value";
const baseEnv = (overrides: Record<string, string | undefined> = {}) => ({
  DATABASE_URL_UNPOOLED: "postgresql://operator:private@ep-development.example.test/database",
  MIGRATION_TARGET_ENV: "development",
  APP_ENV: "development",
  NEON_BRANCH_ID: "br-development-test",
  EXPECTED_NEON_DEVELOPMENT_BRANCH_ID: "br-development-test",
  ...overrides,
});

type State = { admins: FirstAdminRow[]; audits: FirstAdminAudit[]; grants: unknown[] };

function fakeDatabase(initialAdmins: FirstAdminRow[] = [], failAudit = false) {
  const state: State = { admins: structuredClone(initialAdmins), audits: [], grants: [] };
  let tail = Promise.resolve();
  const transactionExclusive = async <T>(work: (tx: FirstAdminTransaction) => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = structuredClone(state);
    try {
      return await work({
        countAdmins: async () => state.admins.length,
        insertAdmin: async (row) => { state.admins.push(structuredClone(row)); },
        insertAudit: async (row) => {
          if (failAudit) throw new Error("injected transaction failure");
          state.audits.push(structuredClone(row));
        },
      });
    } catch (error) {
      state.admins = snapshot.admins;
      state.audits = snapshot.audits;
      state.grants = snapshot.grants;
      throw error;
    } finally {
      release();
    }
  };
  let nextId = 0;
  return { state, deps: { transactionExclusive, newId: () => `id-${++nextId}`, hashPassword: async () => HASH } };
}

const existingAdmin = (id: string): FirstAdminRow => ({ id, externalUserId: `existing:${id}`, email: `${id}@example.test`, passwordHash: HASH, role: "owner", active: true });

test("A/M: zero-admin bootstrap creates exactly one active legacy owner and one secret-free audit", async () => {
  const db = fakeDatabase();
  assert.deepEqual(await bootstrapFirstAdmin({ email: " Owner@Example.Test ", password: PASSWORD }, db.deps), { ok: true });
  assert.equal(db.state.admins.length, 1);
  assert.equal(db.state.admins[0].role, FIRST_ADMIN_ROLE);
  assert.equal(db.state.admins[0].active, true);
  assert.equal(db.state.admins[0].email, "owner@example.test");
  assert.equal(db.state.admins[0].passwordHash, HASH);
  assert.equal(db.state.audits.length, 1);
  assert.deepEqual(db.state.audits[0].payload, { role: "owner", reason: "pre_migration_first_admin_bootstrap" });
  assert.equal(JSON.stringify(db.state.audits).includes(PASSWORD), false);
  assert.equal(JSON.stringify(db.state.audits).includes(HASH), false);
  assert.deepEqual(db.state.grants, []);
});

test("B/C: one or multiple existing administrators reject bootstrap with zero writes", async () => {
  for (const admins of [[existingAdmin("one")], [existingAdmin("one"), existingAdmin("two")]]) {
    const db = fakeDatabase(admins);
    await assert.rejects(() => bootstrapFirstAdmin({ email: "new@example.test", password: PASSWORD }, db.deps), FirstAdminBootstrapError);
    assert.deepEqual(db.state.admins, admins);
    assert.deepEqual(db.state.audits, []);
    assert.deepEqual(db.state.grants, []);
  }
});

test("D/E: invalid email and project-policy-invalid passwords fail before a transaction", async () => {
  for (const input of [
    { email: "not-an-email", password: PASSWORD },
    { email: "owner@example.test", password: "short" },
    { email: "owner@example.test", password: "password123" },
  ]) {
    let transactions = 0;
    const db = fakeDatabase();
    const deps = { ...db.deps, transactionExclusive: async <T>() => { transactions += 1; return undefined as T; } };
    await assert.rejects(() => bootstrapFirstAdmin(input, deps), FirstAdminBootstrapError);
    assert.equal(transactions, 0);
    assert.deepEqual(db.state.admins, []);
  }
  assert.throws(() => validateFirstAdminInput({ email: "", password: PASSWORD }), FirstAdminBootstrapError);
});

test("F: a failure after the admin insert rolls back admin, audit and grant state", async () => {
  const db = fakeDatabase([], true);
  await assert.rejects(() => bootstrapFirstAdmin({ email: "owner@example.test", password: PASSWORD }, db.deps), /injected transaction failure/);
  assert.deepEqual(db.state, { admins: [], audits: [], grants: [] });
});

test("G: retry after success is rejected and leaves exactly one administrator", async () => {
  const db = fakeDatabase();
  await bootstrapFirstAdmin({ email: "owner@example.test", password: PASSWORD }, db.deps);
  await assert.rejects(() => bootstrapFirstAdmin({ email: "owner@example.test", password: PASSWORD }, db.deps), /exactly zero/);
  assert.equal(db.state.admins.length, 1);
  assert.equal(db.state.audits.length, 1);
});

test("H: two concurrent attempts are serialized; exactly one succeeds and final count is one", async () => {
  const db = fakeDatabase();
  const results = await Promise.allSettled([
    bootstrapFirstAdmin({ email: "one@example.test", password: PASSWORD }, db.deps),
    bootstrapFirstAdmin({ email: "two@example.test", password: PASSWORD }, db.deps),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(db.state.admins.length, 1);
  assert.equal(db.state.audits.length, 1);
});

test("I: missing variables, environment mismatch, branch mismatch and pooled URLs fail closed", () => {
  for (const env of [
    baseEnv({ NEON_BRANCH_ID: undefined }),
    baseEnv({ APP_ENV: "preview" }),
    baseEnv({ NEON_BRANCH_ID: "br-wrong" }),
    baseEnv({ DATABASE_URL_UNPOOLED: "postgresql://operator:private@ep-development-pooler.example.test/database" }),
  ]) assert.throws(() => assertBootstrapEnvironment(env));
});

test("J/K: Production requires both migration and first-admin confirmations; mock path proceeds only with both", () => {
  const production = baseEnv({
    DATABASE_URL_UNPOOLED: "postgresql://operator:private@ep-production.example.test/database",
    MIGRATION_TARGET_ENV: "production",
    APP_ENV: "production",
    NEON_BRANCH_ID: "br-production-test",
    EXPECTED_NEON_PRODUCTION_BRANCH_ID: "br-production-test",
  });
  assert.throws(() => assertBootstrapEnvironment(production), /Production migration is blocked/);
  assert.throws(() => assertBootstrapEnvironment({ ...production, ALLOW_PRODUCTION_MIGRATION: "I_UNDERSTAND_PRODUCTION" }), /first-admin bootstrap is blocked/);
  assert.equal(assertBootstrapEnvironment({
    ...production,
    ALLOW_PRODUCTION_MIGRATION: "I_UNDERSTAND_PRODUCTION",
    ALLOW_PRODUCTION_FIRST_ADMIN_BOOTSTRAP: PRODUCTION_BOOTSTRAP_CONFIRMATION,
  }).target, "production");
});

test("L: safe failures never echo a password, hash or database URL", () => {
  const secrets = [PASSWORD, HASH, baseEnv().DATABASE_URL_UNPOOLED];
  for (const error of [new FirstAdminBootstrapError("First-admin bootstrap requires exactly zero existing administrators."), Object.assign(new Error("database exploded with a secret"), { code: "XX999" }), new Error(secrets.join(" "))]) {
    const output = safeBootstrapError(error);
    for (const secret of secrets) assert.equal(output.includes(secret), false);
  }
});

test("M: staged chain ends at 0010 and immutable 0011 remains pending with its pinned hash", async () => {
  const staged = await preparePreGovernanceMigrations("drizzle-pg");
  try {
    const migrations = readMigrationFiles({ migrationsFolder: staged.directory });
    assert.equal(migrations.length, 11);
    assert.equal(migrations.at(-1)?.folderMillis, staged.lastPreGovernanceTimestamp);
    assert.ok(staged.governanceTimestamp > staged.lastPreGovernanceTimestamp);
    assert.equal(readFileSync("drizzle-pg/0011_admin_governance.sql").includes("active_owner_count = 1"), true);
    assert.equal(MIGRATION_0011_SHA256, "f740bd31ff771742ed335aa2c2f1c3f4c44d03d30dcc9c4488c612a2c95d7626");
  } finally {
    await staged.cleanup();
  }
});

test("CLI is explicit, holds an advisory lock before staging, and no HTTP route can bootstrap", () => {
  const script = readFileSync("scripts/bootstrap-first-admin.mts", "utf8");
  const login = readFileSync("app/api/auth/login/route.ts", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(script.indexOf("pg_advisory_lock") < script.indexOf("await migrate"));
  assert.ok(script.indexOf("await migrate") < script.indexOf("await bootstrapFirstAdmin"));
  assert.match(script, /BEGIN[\s\S]*countAdmins[\s\S]*insertAdmin[\s\S]*insertAudit[\s\S]*COMMIT/);
  assert.match(script, /ROLLBACK/);
  assert.equal(packageJson.scripts["admin:bootstrap-first"], "node --experimental-strip-types scripts/bootstrap-first-admin.mts");
  for (const automatic of ["build", "dev", "start", "install:ci", "db:migrate"]) assert.doesNotMatch(packageJson.scripts[automatic], /bootstrap-first-admin/);
  assert.doesNotMatch(login, /bootstrap|ADMIN_BOOTSTRAP|insert\(adminUsers\)/i);
});
