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

test("legal evidence negatives cannot silently skip in CI", () => {
  assert.match(workflow, /P3B_PG_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/sprintb\w*/);
  assert.match(workflow, /run: pnpm test:legal-postgres\b/);
  assert.match(pkg.scripts["test:legal-postgres"], /test-legal-postgres\.mjs/);
  const runner = readFileSync("scripts/test-legal-postgres.mjs", "utf8");
  assert.match(runner, /tests\/p3-legal-evidence-postgres\.test\.ts/);
  assert.match(runner, /counters\.skipped \?\? 1/);
  assert.match(runner, /counters\.pass !== counters\.tests/);
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

test("PR #37 worker suites run in the PostgreSQL job against this run's marked service container and cannot pass silently", () => {
  const job = workflow.slice(workflow.indexOf("  postgres-integration:"), workflow.indexOf("  build:"));
  const mark = job.indexOf("node scripts/ci-mark-disposable-cluster.mjs"), suites = job.indexOf("node --experimental-strip-types scripts/test-pr37-worker-http.mjs");
  assert.ok(mark > 0 && suites > mark, "the cluster is marked before the suites run");
  assert.ok(suites > job.indexOf("run: pnpm test:http-checkout"), "they run after the existing suites");
  assert.match(job, /MARK_PG_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/sprintb_ci\n/);
  assert.match(job, /PR37_HTTP_PG_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/sprintb_ci\n/);
  assert.match(job, /PR37_HTTP_DB: sprintb_pr37_http\n/, "a new sprintb* database, never the service database itself");
  assert.match(job, /set -euo pipefail\n/, "a failing suite behind tee still fails the step");
  for (const line of ['"[worker-acl] PASS 11/11 checks"', '"[pr37-http] PASS"', '"[pr37-http] cleanup: scratch database and roles dropped"']) {
    assert.ok(job.includes(`grep -qF ${line} "$log"`), `a missing pass line fails the job: ${line}`);
  }
  assert.doesNotMatch(job, /PR37_HTTP_CLONE_FROM|PR37_LAB_WORKER_PASSWORD/, "CI never uses the lab clone mode");
  assert.doesNotMatch(job, /PR37_DISPOSABLE_ATTEST:/, "the marker comes only from the marking step, never from a literal in the workflow");
  assert.equal(workflow.match(/node-version-file/g)?.length, 4, "no extra job was added");
  assert.match(job, /timeout-minutes: 30\n/);
});

test("B9 runs in the PostgreSQL job on the marked container and cannot pass by skipping", () => {
  const job = workflow.slice(workflow.indexOf("  postgres-integration:"), workflow.indexOf("  build:"));
  assert.ok(job.indexOf("node scripts/test-b9-postgres.mjs") > job.indexOf("node scripts/ci-mark-disposable-cluster.mjs"), "the cluster is marked before B9 runs");
  assert.match(job, /B9_PG_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/sprintb_ci\n/);
  assert.doesNotMatch(workflow, /B9_PG_DB|B9_TEST/, "the database name and the test's own variable are set by the runner, never by the workflow");
  for (const line of ['"[b9-postgres] OK: 1 test executed against real PostgreSQL, 0 skipped."', '"[b9-postgres] cleanup: scratch database dropped"']) {
    assert.ok(job.includes(`grep -qF ${line} "$log"`), `a missing line fails the job: ${line}`);
  }
  assert.equal(workflow.match(/node-version-file/g)?.length, 4, "no extra job was added");
  assert.doesNotMatch(workflow, /^[ \t]+permissions:/m);
  assert.match(pkg.scripts["test:b9-postgres"], /test-b9-postgres\.mjs/);
});

test("H5 runs in the PostgreSQL job on the marked container, after the marking step, and can neither skip nor leave resources unnoticed", () => {
  const job = workflow.slice(workflow.indexOf("  postgres-integration:"), workflow.indexOf("  build:"));
  const mark = job.indexOf("node scripts/ci-mark-disposable-cluster.mjs"), h5 = job.indexOf("node --experimental-strip-types scripts/test-h5-notifications-http.mjs");
  assert.ok(mark > 0 && h5 > mark, "the cluster is marked before H5 runs");
  assert.ok(h5 > job.indexOf("node scripts/test-b9-postgres.mjs"), "it runs after the existing PostgreSQL suites");
  assert.match(job, /H5_PG_URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/sprintb_ci\n/);
  assert.doesNotMatch(workflow, /H5_PG_DB|RESEND|MAIL_FROM|ORDER_ALERT/, "no mail variable can reach H5 from the workflow");
  const step = job.slice(job.indexOf("- name: H5 scoped-worker"));
  assert.match(step, /set -euo pipefail\n/, "a failing suite behind tee still fails the step");
  for (const line of ['"[h5-http] PASS: scoped-worker notification integration"', '"[h5-http] cleanup: owned resources removed"']) {
    assert.ok(step.includes(`grep -qF ${line} "$log"`), `a missing line fails the job: ${line}`);
  }
  assert.equal(workflow.match(/node-version-file/g)?.length, 4, "no extra job was added");
  assert.doesNotMatch(workflow, /^[ \t]+permissions:/m, "no job widens the read-only default");
  assert.doesNotMatch(workflow, /secrets\.|continue-on-error/);
});

