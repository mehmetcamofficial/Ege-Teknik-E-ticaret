import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const source=readFileSync("scripts/test-eft04c-http.mjs","utf8");
const wrapper=readFileSync("scripts/test-eft-isolated-pg18.sh","utf8");
test("real HTTP test refuses any database except the owned loopback PG18 fixture",()=>{
  assert.match(source,/EFT04C_ISOLATED_QA/);
  assert.match(source,/target\.hostname !== "127\.0\.0\.1"/);
  assert.match(source,/target\.port !== "55571"/);
  assert.match(source,/sprintb_eft_isolated_20261102/);
  assert.match(wrapper,/mktemp -d/);
});
test("HTTP tests use actual admin session cookies and route GET, not mocked auth",()=>{
  assert.match(source,/admin_sessions/);
  assert.match(source,/ege_admin_session/);
  assert.match(source,/startNextDev/);
  assert.match(source,/fetch\(base\+"\/api\/admin\/eft-reconciliation"/);
  assert.match(source,/finance_manager/);
  assert.match(source,/operations_manager/);
});
test("test asserts denial, authorized read, no unsafe writes or secret leakage",()=>{
  for(const token of ['a.status,403','b.status,403','c.status,200','d.status,200','e.status,405','count("payments")','count("eft_reconciliation_reviews")','settlementEnabled,false']) assert.ok(source.includes(token),token);
  assert.match(source,/const noOrigin=await req\(server\.base,financeCookie,"POST"\)/);
  assert.match(source,/noOrigin\.status,403/);
  assert.match(source,/req\(server\.base,financeCookie,"POST",true\)/);
  assert.match(source,/origin:base/);
  assert.match(wrapper,/node scripts\/test-eft04c-http\.mjs/);
});
