import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/** Locks the security/safety contract of .github/workflows/ci.yml (comment lines are ignored). */
const raw = readFileSync(".github/workflows/ci.yml", "utf8");
const workflow = raw.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

test("least privilege: top-level read-only permissions and no pull_request_target", () => {
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /^[ \t]+permissions:/m, "no job widens the read-only default");
});

test("no critical gate may be softened, and nothing may deploy, migrate remotely or read secrets", () => {
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.doesNotMatch(workflow, /secrets\./i);
  assert.doesNotMatch(workflow, /vercel|neon|deploy|db:migrate|ALLOW_PRODUCTION|DATABASE_URL|CLERK|SENTRY|RESEND|BLOB_/i);
});

test("the four required jobs exist, each with a timeout", () => {
  for (const job of ["quality", "postgres-integration", "build", "migration-safety"]) {
    assert.match(workflow, new RegExp(`^  ${job}:\\n    name: ${job}\\n    runs-on: ubuntu-latest\\n    timeout-minutes: \\d+`, "m"), job);
  }
});

test("Node comes from .nvmrc, pnpm from packageManager via Corepack, and every install is frozen", () => {
  assert.equal(workflow.match(/node-version-file: \.nvmrc/g)?.length, 4);
  assert.equal(workflow.match(/run: corepack enable/g)?.length, 4);
  assert.equal(workflow.match(/pnpm install --frozen-lockfile/g)?.length, 4);
  assert.doesNotMatch(workflow, /pnpm install(?! --frozen-lockfile)/);
  assert.match(readFileSync(".nvmrc", "utf8").trim(), /^22/);
});

test("only first-party actions are used and checkout does not persist credentials", () => {
  const uses = [...workflow.matchAll(/uses: ([^\s]+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 8);
  for (const action of uses) assert.match(action, /^actions\/(checkout|setup-node)@v\d+$/, action);
  assert.equal(workflow.match(/persist-credentials: false/g)?.length, 4);
});

test("the PostgreSQL job talks only to its own loopback service container and uses the fail-on-skip runner", () => {
  assert.match(workflow, /image: postgres:\d+/);
  assert.match(workflow, /--health-cmd "pg_isready/);
  assert.match(workflow, /POSTGRES_DB: sprintb\w*/);
  assert.match(workflow, /SPRINTB_PG_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/sprintb\w*/);
  assert.match(workflow, /run: pnpm test:postgres\b/);
  assert.equal(workflow.match(/SPRINTB_PG_URL/g)?.length, 1, "set once, on the one step that needs it");
  assert.match(pkg.scripts["test:postgres"], /test-postgres-integration\.mjs/);
});

test("the build job fails on any tracked or untracked change", () => {
  assert.match(workflow, /run: pnpm build/);
  assert.match(workflow, /LOCAL_BUILD_NO_UPLOAD: "1"/, "CI builds never upload source maps or send build telemetry");
  assert.match(workflow, /git diff --exit-code/);
  assert.match(workflow, /test -z "\$\(git status --porcelain\)"/);
});

test("the migration job verifies 0011 and 0012 hashes offline and runs the safety tests without a database", () => {
  assert.match(workflow, /f740bd31ff771742ed335aa2c2f1c3f4c44d03d30dcc9c4488c612a2c95d7626  drizzle-pg\/0011_admin_governance\.sql/);
  assert.match(workflow, /70f1d12ff909a8377dac4bad436fee1155456c82f433bc9259c64b2b4a03c3cb  drizzle-pg\/0012_delivery_class\.sql/);
  assert.match(workflow, /pnpm verify:migrations/);
  for (const file of ["migration-integrity", "admin-governance-migration-safety", "first-admin-bootstrap", "migrator"]) assert.match(workflow, new RegExp(`tests/${file}\\.test\\.ts`));
});

test("every script the workflow calls exists in package.json", () => {
  for (const script of ["lint", "typecheck", "test", "build", "test:postgres", "verify:migrations"]) assert.ok(pkg.scripts[script], script);
});
