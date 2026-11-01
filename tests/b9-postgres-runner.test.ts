import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

/** The B9 runner must refuse BEFORE opening any connection; every case below points at a port nothing listens on. */
const run = (env: Record<string, string>) => spawnSync(process.execPath, ["scripts/test-b9-postgres.mjs"], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 20000 });
const URL_OK = "postgresql://postgres:pw@127.0.0.1:1/sprintb_ci";

test("the B9 runner refuses every unsafe target before connecting, without echoing credentials", () => {
  const cases: [string, Record<string, string>, RegExp][] = [
    ["not CI", { B9_PG_URL: URL_OK }, /requires CI=true/],
    ["no URL", { CI: "true" }, /must be a PostgreSQL URL/],
    ["not a postgres URL", { CI: "true", B9_PG_URL: "https://example.test/x" }, /must be a PostgreSQL URL/],
    ["remote host", { CI: "true", B9_PG_URL: "postgresql://postgres:pw@db.example.test:5432/sprintb_ci" }, /loopback PostgreSQL URL required/],
    ["hosted-looking host", { CI: "true", B9_PG_URL: "postgresql://u:pw@ep-prod-123.eu-central-1.aws.neon.tech/neondb" }, /loopback PostgreSQL URL required/],
    ["recovery port", { CI: "true", B9_PG_URL: "postgresql://postgres:pw@127.0.0.1:55432/sprintb_ci" }, /recovery cluster port is never allowed/],
    ["database name is not sprintb_b9*", { CI: "true", B9_PG_URL: URL_OK, B9_PG_DB: "neondb" }, /new sprintb_b9\* database name/],
    ["database name sprintb_ci", { CI: "true", B9_PG_URL: URL_OK, B9_PG_DB: "sprintb_ci" }, /new sprintb_b9\* database name/],
    ["injection in the name", { CI: "true", B9_PG_URL: URL_OK, B9_PG_DB: 'sprintb_b9"; drop database x; --' }, /new sprintb_b9\* database name/],
  ];
  for (const [label, env, expected] of cases) {
    const r = run(env);
    assert.equal(r.status, 1, label);
    assert.match(r.stderr, expected, label);
    assert.doesNotMatch(r.stdout + r.stderr, /:pw@|pw@/, `${label}: no credential is printed`);
    assert.doesNotMatch(r.stdout, /cleanup/, `${label}: refused before anything could be created or dropped`);
  }
});

test("with a valid-looking target but a cluster that cannot be attested, nothing is created and nothing is dropped", () => {
  const r = run({ CI: "true", B9_PG_URL: URL_OK });   // 127.0.0.1:1 refuses the connection
  assert.equal(r.status, 1);
  assert.match(r.stdout, /cleanup: nothing was created by this run, nothing is dropped/);
  assert.doesNotMatch(r.stdout + r.stderr, /scratch database dropped|:pw@/);
});
