/**
 * P3-B: the commerce persistence gate must actually be wired, must name every test file that opts into
 * FINANCE_TEST_DATABASE_URL, and must fail closed. Purely hermetic - it spawns the runner only in the
 * three cases where the runner is REQUIRED to refuse before it opens a socket, so it never needs a
 * database and never touches one.
 *
 * The drift guard is the point: a new real-PostgreSQL suite added to tests/ would otherwise only ever
 * SKIP, and this file is what turns that into a red CI.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import test from "node:test";
import { LEGACY_OWNER_SQL, bootstrapDisposableDatabase, preOwnerConsolidationEntries } from "../scripts/disposable-postgres-bootstrap.mjs";

const RUNNER = "scripts/test-commerce-postgres.mjs";
const BOOTSTRAP = "scripts/disposable-postgres-bootstrap.mjs";
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const runnerSource = readFileSync(RUNNER, "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

/** Every top-level test file that reads the variable, minus this one, which only names it. */
const consumers = readdirSync("tests")
  .filter((name) => name.endsWith(".test.ts") && name !== "ci-commerce-postgres.test.ts")
  .filter((name) => readFileSync(`tests/${name}`, "utf8").includes("FINANCE_TEST_DATABASE_URL"))
  .map((name) => `tests/${name}`)
  .sort();

const allowList = [
  ...(runnerSource.match(/const TEST_FILES = \[([\s\S]*?)\];/)?.[1].matchAll(/"(tests\/[^"]+)"/g) ?? []),
].map((match) => match[1]).sort();

/** Spawns the runner with a deliberately clean environment: neither variable is inherited. */
const run = (env: { COMMERCE_PG_URL?: string } = {}) => {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.COMMERCE_PG_URL;
  delete childEnv.FINANCE_TEST_DATABASE_URL;
  if (env.COMMERCE_PG_URL) childEnv.COMMERCE_PG_URL = env.COMMERCE_PG_URL;
  return spawnSync(process.execPath, [RUNNER], { env: childEnv, encoding: "utf8" });
};

test("the runner's allow-list is exactly every test file that needs FINANCE_TEST_DATABASE_URL", () => {
  assert.deepEqual(allowList, consumers, "a new real-PostgreSQL suite must be added to the runner's TEST_FILES, or it will only ever skip");
  assert.ok(allowList.length > 0, "the gate must name at least one suite");
});

test("package.json exposes the gate and the workflow runs it on the existing PostgreSQL job", () => {
  assert.match(pkg.scripts["test:commerce-postgres"] ?? "", /test-commerce-postgres\.mjs/);
  // The new gate reuses the one service container: a second job would add a checkout/setup-node pair
  // that tests/ci-workflow-policy.test.ts counts exactly four of.
  assert.match(workflow, /run: pnpm test:commerce-postgres\b/);
  assert.match(workflow, /run: pnpm test:postgres\b/, "the existing Sprint-B gate must stay");
  assert.equal(workflow.match(/COMMERCE_PG_URL/g)?.length, 1, "set once, on the one step that needs it");
  assert.match(workflow, /COMMERCE_PG_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/sprintb\w*/);
  assert.doesNotMatch(workflow.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n"), /DATABASE_URL/);
});

test("the gate fails closed: no variable, a remote host, or a non-disposable database name are all refused", () => {
  const absent = run({});
  assert.notEqual(absent.status, 0, "must refuse to run without its variable");
  assert.match(absent.stderr, /COMMERCE_PG_URL is not set/);
  assert.doesNotMatch(`${absent.stdout}${absent.stderr}`, /postgres:\/\//, "a refused run must not echo a connection string");

  const remote = run({ COMMERCE_PG_URL: "postgresql://user:secret@db.example.invalid:5432/sprintb_ci" });
  assert.notEqual(remote.status, 0, "a non-loopback database must be refused before any connection");
  assert.match(remote.stderr, /loopback/);
  assert.doesNotMatch(`${remote.stdout}${remote.stderr}`, /secret/, "the refused value must never be printed");

  const localDeveloperDb = run({ COMMERCE_PG_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres" });
  assert.notEqual(localDeveloperDb.status, 0, "a developer's own local database must be refused");
  assert.match(localDeveloperDb.stderr, /must start with "sprintb"/);
});

test("the gate refuses on any skip, failure or omission, never reporting a skip as verified", () => {
  for (const needle of ["SKIPPED", "failed on real PostgreSQL", "is missing", "setup/migration failed", "could not read the TAP summary"]) {
    assert.ok(runnerSource.includes(needle), `the runner must be able to fail with: ${needle}`);
  }
  assert.match(runnerSource, /bootstrapDisposableDatabase\(/, "each suite must be prepared by the reviewed disposable bootstrap");
  assert.equal(/MIGRATIONS_FOLDER = "([^"]+)"/.exec(runnerSource)?.[1], "drizzle-pg", "the repository's own migration folder");
});

// --- the disposable bootstrap ---------------------------------------------------------------------------------------

const bootstrapSource = readFileSync(BOOTSTRAP, "utf8");
const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };

test("the bootstrap reproduces the reviewed history: reset, 0000-0010, ONE legacy owner, then head", async () => {
  // Every dependency is a fake, so this proves the exact sequence - and the fact that the owner exists
  // before 0011 is applied - without a database.
  const steps: string[] = [];
  const written: string[] = [];
  const staged: string[] = [];
  const pool = {
    on: () => {},
    end: async () => {},
    query: async (sql: string) => {
      // Named steps rather than truncated SQL, so the assertion does not depend on string length.
      if (sql.startsWith("drop schema")) steps.push("reset-schema");
      else if (sql.startsWith("insert into admin_users")) steps.push("seed-legacy-owner");
      else steps.push(`query:${sql}`);
      return { rows: [] };
    },
  };
  const fakeFs = {
    mkdtempSync: () => "/tmp/staged",
    mkdirSync: () => {},
    writeFileSync: (path: string) => written.push(path),
    cpSync: (from: string) => staged.push(from.split("/").pop() ?? from),
    rmSync: () => steps.push("cleanup"),
  };
  const result = await bootstrapDisposableDatabase({
    Pool: class { constructor() { return pool; } } as never,
    drizzle: (value: unknown) => value,
    migrate: async (_db: unknown, options: { migrationsFolder: string }) => { steps.push(`migrate:${options.migrationsFolder}`); },
    url: "postgresql://postgres:postgres@127.0.0.1:5432/sprintb_ci",
    journal,
    fs: fakeFs as never,
    paths: { join: (...parts: string[]) => parts.join("/"), tmpdir: () => "/tmp" } as never,
  });

  // 0011's guard sees exactly one active owner, because the fixture is inserted between the two migrations.
  const flow = steps.filter((step) => ["reset-schema", "seed-legacy-owner"].includes(step) || step.startsWith("migrate:"));
  assert.deepEqual(flow, ["reset-schema", "migrate:/tmp/staged", "seed-legacy-owner", "migrate:drizzle-pg"], "reset, pre-0011 migration, owner fixture, head migration - and nothing else");
  // The staged history is 0000-0010: everything before 0011, and nothing after it.
  assert.deepEqual(result.staged, journal.entries.filter((entry) => entry.tag < "0011_admin_governance").map((entry) => entry.tag));
  assert.equal(result.staged.length, 11);
  assert.ok(!result.staged.some((tag) => tag.startsWith("0011")), "0011 must never be part of the staged pre-owner history");
  assert.ok(written.some((path) => path.endsWith("meta/_journal.json")), "the real migrator needs a journal to read");
  assert.equal(staged.length, 11, "every staged migration file is copied from the committed drizzle-pg folder");
  assert.ok(steps.includes("cleanup"), "the temporary folder is removed again");
});

test("the owner fixture is the one legacy owner 0011 expects, and the guard is never bypassed", () => {
  assert.match(LEGACY_OWNER_SQL, /^insert into admin_users \(id, external_user_id, email, role, active\) values \('owner-1',.*'owner', true\)$/);
  assert.equal((LEGACY_OWNER_SQL.match(/values \(/g) ?? []).length, 1, "exactly one owner, which is what 0011's preflight requires");
  // 0011 keeps its fail-closed guard: this change never relaxes, reorders or replaces it.
  const migration = readFileSync("drizzle-pg/0011_admin_governance.sql", "utf8");
  assert.match(migration, /IF active_owner_count = 1 THEN/);
  assert.match(migration, /abort 0011: 0 active owners found; refusing to invent a privileged identity/);
  // Comment-proof: the executable code must contain no way to switch a guard off, and the ONLY row it
  // writes anywhere is the single legacy owner.
  const executable = bootstrapSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\*.*$/gm, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(executable, /DROP TRIGGER|DISABLE TRIGGER|session_replication_role|ALTER ROLE|SET\s+check_function/i);
  assert.equal((executable.match(/insert into/gi) ?? []).length, 1, "the only row the bootstrap writes is the legacy owner fixture");
  assert.equal(preOwnerConsolidationEntries(journal).length, 11);
  assert.throws(() => preOwnerConsolidationEntries({ entries: [{ tag: "0000_x" }] }), /no 0011_admin_governance entry/);
});

test("migration 0011 is byte-identical to the reviewed version this repository already pins", () => {
  // The same digest the migration-safety CI job verifies, asserted here so the follow-up commit itself
  // is proof that no historical migration was touched.
  assert.equal(createHash("sha256").update(readFileSync("drizzle-pg/0011_admin_governance.sql")).digest("hex"), "f740bd31ff771742ed335aa2c2f1c3f4c44d03d30dcc9c4488c612a2c95d7626");
  assert.equal(createHash("sha256").update(readFileSync("drizzle-pg/0012_delivery_class.sql")).digest("hex"), "70f1d12ff909a8377dac4bad436fee1155456c82f433bc9259c64b2b4a03c3cb");
});

test("the bootstrap is test-only: nothing in the application imports it", () => {
  const importers = execFileSync("grep", ["-rl", "disposable-postgres-bootstrap", "app", "lib", "db", "components", "scripts", "public"], { encoding: "utf8" })
    .split("\n").filter(Boolean).sort();
  assert.ok(existsSync(BOOTSTRAP), "the bootstrap module must exist");
  assert.deepEqual(importers, ["scripts/test-checkout-http-e2e.mjs", RUNNER].sort(),
    "only the two disposable PostgreSQL CI runners may import the destructive bootstrap");
  const httpRunner = readFileSync("scripts/test-checkout-http-e2e.mjs", "utf8");
  assert.match(httpRunner, /process\.env\.CI !== "true"/, "HTTP E2E must refuse non-CI execution");
  assert.match(httpRunner, /target\.pathname\.slice\(1\)\.startsWith\("sprintb"\)/, "HTTP E2E must refuse non-disposable databases");
  assert.match(httpRunner, /\["127\.0\.0\.1", "localhost", "::1"\]/, "HTTP E2E must refuse remote databases");
  assert.doesNotMatch(bootstrapSource, /DATABASE_URL_UNPOOLED|NEON_BRANCH_ID|MIGRATION_TARGET_ENV/);
  assert.doesNotMatch(bootstrapSource, /process\.env/, "it has no environment of its own: the caller passes the URL in");
});
