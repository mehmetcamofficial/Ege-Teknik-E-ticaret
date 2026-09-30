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
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const RUNNER = "scripts/test-commerce-postgres.mjs";
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
  assert.match(runnerSource, /drop schema if exists public cascade/, "each suite gets a clean, re-migrated schema");
  assert.match(runnerSource, /migrationsFolder: MIGRATIONS_FOLDER/);
  assert.equal(/MIGRATIONS_FOLDER = "([^"]+)"/.exec(runnerSource)?.[1], "drizzle-pg", "the repository's own migration folder");
});
