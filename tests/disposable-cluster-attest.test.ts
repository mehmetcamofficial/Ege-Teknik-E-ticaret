import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { attestDisposableCluster, clusterProblems, readClusterFacts } from "../scripts/disposable-cluster-attest.mjs";

const RUN = { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "123456789", GITHUB_RUN_ATTEMPT: "1" };
const MARK = "ege-disposable-ci:123456789:1:0123456789abcdef0123456789abcdef";
const ciEnv = (over: Record<string, string | undefined> = {}) => ({ CI: "true", ...RUN, PR37_DISPOSABLE_ATTEST: MARK, ...over });
const labEnv = (over: Record<string, string | undefined> = {}) => ({ CI: "true", ...over });
const facts = (over: Record<string, unknown> = {}) => ({ databases: ["postgres", "sprintb_ci"], neon: false, dataDirectory: null, markers: [MARK], ...over });
const problems = (host: string, port: string, f: unknown, env: Record<string, string | undefined>) => clusterProblems({ host, port, facts: f as never }, env);

test("a CI service container marked by THIS run is accepted; so is the lab cluster", () => {
  assert.deepEqual(problems("127.0.0.1", "5432", facts(), ciEnv()), []);
  assert.deepEqual(problems("localhost", "", facts({ markers: [], dataDirectory: "/x/pr37-worker-pg/data" }), labEnv()), []);
});

test("every hard check refuses on its own, even with a valid attestation", () => {
  const cases: [string, string[]][] = [
    ["not_ci", problems("127.0.0.1", "5432", facts(), ciEnv({ CI: undefined }))],
    ["not_loopback", problems("db.example.test", "5432", facts(), ciEnv())],
    ["not_loopback", problems("10.0.0.5", "5432", facts(), ciEnv())],
    ["recovery_port", problems("127.0.0.1", "55432", facts(), ciEnv())],
    ["foreign_database_present", problems("127.0.0.1", "5432", facts({ databases: ["postgres", "sprintb_ci", "neondb"] }), ciEnv())],
    ["foreign_database_present", problems("127.0.0.1", "5432", facts({ databases: ["postgres", "sprintb_ci", "sprintbX"] }), ciEnv())],
    ["databases_unreadable", problems("127.0.0.1", "5432", facts({ databases: [] }), ciEnv())],
    ["neon_or_unknown", problems("127.0.0.1", "5432", facts({ neon: true }), ciEnv())],
    ["neon_or_unknown", problems("127.0.0.1", "5432", null, ciEnv())],
  ];
  for (const [reason, got] of cases) assert.ok(got.includes(reason), `${reason} in ${JSON.stringify(got)}`);
  assert.ok(problems("127.0.0.1", "55432", facts({ markers: [], dataDirectory: "/x/pr37-worker-pg/data" }), labEnv()).includes("recovery_port"), "the lab route cannot reach the recovery port either");
});

test("the CI attestation cannot be forged, replayed or borrowed", () => {
  const missingMarkerInDb = problems("127.0.0.1", "5432", facts({ markers: [] }), ciEnv());
  const otherRun = problems("127.0.0.1", "5432", facts(), ciEnv({ GITHUB_RUN_ID: "999" }));
  const otherAttempt = problems("127.0.0.1", "5432", facts(), ciEnv({ GITHUB_RUN_ATTEMPT: "2" }));
  const notActions = problems("127.0.0.1", "5432", facts(), ciEnv({ GITHUB_ACTIONS: undefined }));
  const noEnvMarker = problems("127.0.0.1", "5432", facts(), ciEnv({ PR37_DISPOSABLE_ATTEST: undefined }));
  const malformed = problems("127.0.0.1", "5432", facts({ markers: ["ege-disposable-ci:1:1:short"] }), ciEnv({ PR37_DISPOSABLE_ATTEST: "ege-disposable-ci:1:1:short", GITHUB_RUN_ID: "1" }));
  const wrongDbMarker = problems("127.0.0.1", "5432", facts({ markers: ["ege-disposable-ci:123456789:1:ffffffffffffffffffffffffffffffff"] }), ciEnv());
  for (const [label, got] of Object.entries({ missingMarkerInDb, otherRun, otherAttempt, notActions, noEnvMarker, malformed, wrongDbMarker })) {
    assert.ok(got.includes("no_attestation"), `${label}: ${JSON.stringify(got)}`);
  }
  // A path that merely CONTAINS the lab name in another position is not enough to be "the lab" unless it really contains the token.
  assert.ok(problems("127.0.0.1", "5432", facts({ markers: [], dataDirectory: "/var/lib/postgresql/data" }), labEnv()).includes("no_attestation"), "an ordinary data directory is not an attestation");
});

type Row = Record<string, unknown>;
const fakeQuery = (answers: { databases: string[]; neonExtensions?: number; neonSettings?: number; dataDirectory?: string | "denied"; markerHit?: boolean }) =>
  async (text: string): Promise<{ rows: Row[] }> => {
    if (/FROM pg_database WHERE NOT datistemplate/.test(text)) return { rows: answers.databases.map((datname) => ({ datname })) };
    if (/FROM pg_extension/.test(text)) return { rows: [{ n: answers.neonExtensions ?? 0 }] };
    if (/FROM pg_settings WHERE name LIKE 'neon\.%'/.test(text)) return { rows: [{ n: answers.neonSettings ?? 0 }] };
    if (/SHOW data_directory/.test(text)) { if (answers.dataDirectory === "denied" || answers.dataDirectory === undefined) throw new Error("permission denied"); return { rows: [{ data_directory: answers.dataDirectory }] }; }
    if (/shobj_description/.test(text)) return { rows: answers.markerHit ? [{ "?column?": 1 }] : [] };
    throw new Error("unexpected query");
  };

test("attestDisposableCluster: accepts the CI cluster, reports the route, and refuses with fixed reasons only", async () => {
  const good = fakeQuery({ databases: ["postgres", "sprintb_ci"], markerHit: true, dataDirectory: "denied" });
  assert.equal(await attestDisposableCluster({ url: "postgresql://u:pw@127.0.0.1:5432/sprintb_ci", query: good, env: ciEnv() }), "ci");
  const lab = fakeQuery({ databases: ["postgres", "sprintb_a"], dataDirectory: "/tmp/x/pr37-worker-pg" });
  assert.equal(await attestDisposableCluster({ url: "postgresql://u:pw@[::1]:5433/postgres", query: lab, env: labEnv() }), "lab");

  const refusals: [string, Parameters<typeof fakeQuery>[0], string, Record<string, string | undefined>][] = [
    ["foreign_database_present", { databases: ["postgres", "sprintb_ci", "neondb"], markerHit: true }, "postgresql://u:SECRETPW@127.0.0.1:5432/sprintb_ci", ciEnv()],
    ["neon_or_unknown", { databases: ["postgres"], neonExtensions: 1, markerHit: true }, "postgresql://u:SECRETPW@127.0.0.1:5432/sprintb_ci", ciEnv()],
    ["neon_or_unknown", { databases: ["postgres"], neonSettings: 3, markerHit: true }, "postgresql://u:SECRETPW@127.0.0.1:5432/sprintb_ci", ciEnv()],
    ["no_attestation", { databases: ["postgres", "sprintb_ci"], markerHit: false }, "postgresql://u:SECRETPW@127.0.0.1:5432/sprintb_ci", ciEnv()],
    ["recovery_port", { databases: ["postgres", "sprintb_ci"], markerHit: true }, "postgresql://u:SECRETPW@127.0.0.1:55432/sprintb_ci", ciEnv()],
    ["not_loopback", { databases: ["postgres", "sprintb_ci"], markerHit: true }, "postgresql://u:SECRETPW@ep-prod.neon.example/sprintb_ci", ciEnv()],
  ];
  for (const [reason, answers, url, env] of refusals) {
    await assert.rejects(attestDisposableCluster({ url, query: fakeQuery(answers), env }), (error: Error) => {
      assert.match(error.message, new RegExp(`^disposable cluster refused: .*${reason}`));
      assert.doesNotMatch(error.message, /SECRETPW|ep-prod|postgresql:/, "no credential or host in the message");
      return true;
    });
  }
  // a cluster that cannot even answer the questions is refused, never accepted
  await assert.rejects(attestDisposableCluster({ url: "postgresql://u@127.0.0.1:5432/sprintb_ci", query: async () => { throw new Error("boom"); }, env: ciEnv() }), /disposable cluster refused: .*neon_or_unknown/);
});

test("readClusterFacts only asks for the marker when the environment carries a well-formed one", async () => {
  const asked: string[] = [];
  const query = async (text: string, params?: unknown[]) => { asked.push(text); void params; return fakeQuery({ databases: ["postgres"], markerHit: true, dataDirectory: "denied" })(text); };
  assert.deepEqual((await readClusterFacts(query, { PR37_DISPOSABLE_ATTEST: "garbage" })).markers, []);
  assert.ok(!asked.some((t) => /shobj_description/.test(t)));
  assert.deepEqual((await readClusterFacts(query, { PR37_DISPOSABLE_ATTEST: MARK })).markers, [MARK]);
});

const run = (script: string, env: Record<string, string>) => spawnSync(process.execPath, ["--experimental-strip-types", script], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 20000 });
const GOOD_MARK_ENV = { CI: "true", ...RUN, GITHUB_ENV: "/dev/null", MARK_PG_URL: "postgresql://u:pw@127.0.0.1:1/sprintb_ci" };

test("the marker script refuses everything except a GitHub Actions job and a loopback sprintb database (no database is contacted)", () => {
  const cases: [string, Record<string, string>, RegExp][] = [
    ["outside Actions", { ...GOOD_MARK_ENV, GITHUB_ACTIONS: "" }, /runs only inside a GitHub Actions job/],
    ["not CI", { ...GOOD_MARK_ENV, CI: "" }, /runs only inside a GitHub Actions job/],
    ["no run id", { ...GOOD_MARK_ENV, GITHUB_RUN_ID: "x" }, /run identity is incomplete/],
    ["no GITHUB_ENV", { ...GOOD_MARK_ENV, GITHUB_ENV: "" }, /run identity is incomplete/],
    ["no URL", { ...GOOD_MARK_ENV, MARK_PG_URL: "" }, /PostgreSQL URL is required/],
    ["remote host", { ...GOOD_MARK_ENV, MARK_PG_URL: "postgresql://u:pw@db.example.test:5432/sprintb_ci" }, /loopback service container only/],
    ["recovery port", { ...GOOD_MARK_ENV, MARK_PG_URL: "postgresql://u:pw@127.0.0.1:55432/sprintb_ci" }, /loopback service container only/],
    ["non-sprintb database", { ...GOOD_MARK_ENV, MARK_PG_URL: "postgresql://u:pw@127.0.0.1:5432/neondb" }, /must start with sprintb/],
  ];
  for (const [label, env, expected] of cases) {
    const r = run("scripts/ci-mark-disposable-cluster.mjs", env);
    assert.equal(r.status, 1, label);
    assert.match(r.stderr, expected, label);
    assert.doesNotMatch(r.stdout + r.stderr, /:pw@|ege-disposable-ci:/, `${label}: no credential or nonce is printed`);
  }
});

test("both worker suites refuse before touching any database when the environment is not a CI disposable one", () => {
  const acl = run("scripts/test-notification-worker-acl.mjs", { WORKER_ACL_ADMIN_URL: "postgresql://a:pw@127.0.0.1:1/sprintb_x", WORKER_ACL_WORKER_URL: "postgresql://w:pw@127.0.0.1:1/sprintb_x" });
  assert.equal(acl.status, 1); assert.match(acl.stderr, /requires CI=true/);
  const aclRemote = run("scripts/test-notification-worker-acl.mjs", { CI: "true", WORKER_ACL_ADMIN_URL: "postgresql://a:pw@db.example.test/sprintb_x", WORKER_ACL_WORKER_URL: "postgresql://w:pw@db.example.test/sprintb_x" });
  assert.equal(aclRemote.status, 1); assert.match(aclRemote.stderr, /loopback sprintb database only/);
  const http = run("scripts/test-pr37-worker-http.mjs", { PR37_HTTP_PG_URL: "postgresql://postgres:pw@127.0.0.1:1/postgres", PR37_HTTP_DB: "sprintb_x" });
  assert.equal(http.status, 1); assert.match(http.stderr, /requires CI=true/);
  const httpRemote = run("scripts/test-pr37-worker-http.mjs", { CI: "true", PR37_HTTP_PG_URL: "postgresql://postgres:pw@db.example.test:5432/postgres", PR37_HTTP_DB: "sprintb_x" });
  assert.equal(httpRemote.status, 1); assert.match(httpRemote.stderr, /loopback PostgreSQL URL required/);
  const httpName = run("scripts/test-pr37-worker-http.mjs", { CI: "true", PR37_HTTP_PG_URL: "postgresql://postgres:pw@127.0.0.1:1/postgres", PR37_HTTP_DB: "neondb" });
  assert.equal(httpName.status, 1); assert.match(httpName.stderr, /new sprintb\* database name/);
  for (const r of [acl, aclRemote, http, httpRemote, httpName]) assert.doesNotMatch(r.stdout + r.stderr, /:pw@/);
});
