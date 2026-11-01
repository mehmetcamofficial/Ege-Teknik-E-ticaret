#!/usr/bin/env node
/**
 * EFT-04C.2 real HTTP + PostgreSQL test. Explicitly scoped to the private PG18
 * instance created by scripts/test-eft-isolated-pg18.sh. Resets its OWN schema.
 * Never reads banking credentials or hosted DB URLs. Never prints DB URL.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { bootstrapDisposableDatabase, defaultStageDeps } from "./disposable-postgres-bootstrap.mjs";
import { startNextDev } from "./http-test-server.mjs";

const raw = process.env.EFT04C_HTTP_PG_URL;
let target;
try { target = new URL(raw); } catch {}
if (process.env.EFT04C_ISOLATED_QA !== "1" || !target ||
  !["postgres:","postgresql:"].includes(target.protocol) ||
  target.hostname !== "127.0.0.1" || target.port !== "55571" ||
  target.pathname !== "/sprintb_eft_isolated_20261102") {
  console.error("[eft04c-http] BLOCKED: requires owned, loopback, disposable PG18 QA environment");
  process.exit(1);
}
const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json","utf8"));
const owner = new pg.Pool({connectionString: raw, max: 3});
let server;
const marker = randomBytes(8).toString("hex");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const cookieFor = async (role) => {
  const token = randomBytes(32).toString("base64url");
  const id = "eft04c-" + role + "-" + marker;
  await owner.query("INSERT INTO admin_users (id,external_user_id,email,role,active) VALUES ($1,$2,$3,$4,true)",
    [id,"test-"+id,id+"@example.test",role]);
  await owner.query(`INSERT INTO admin_sessions (id,admin_user_id,token_hash,expires_at,last_rotated_at)
    VALUES ($1,$2,$3,now() + interval '2 hours',now())`,["sess-"+id,id,sha(token)]);
  return "ege_admin_session="+token;
};
const count = async (table) => Number((await owner.query("SELECT count(*)::int AS n FROM "+table)).rows[0].n);
const req = async (base,cookie,method="GET") => {
  const result=await fetch(base+"/api/admin/eft-reconciliation",{method,redirect:"manual",
    headers:cookie?{cookie}:undefined,signal:AbortSignal.timeout(25000)});
  let data=null;
  const body=await result.text();
  try {data=JSON.parse(body);}catch {}
  return {status:result.status,data,headers:result.headers};
};
try {
  await bootstrapDisposableDatabase({Pool:pg.Pool,drizzle,migrate,url:raw,journal,
    migrationsFolder:"drizzle-pg",...defaultStageDeps,log:()=>{}});
  const financeCookie=await cookieFor("finance_manager");
  const staffCookie=await cookieFor("operations_manager");
  const ownerCookie=await cookieFor("super_admin");
  await owner.query(`INSERT INTO merchant_bank_accounts
    (id,bank_code,account_label,iban_last4,status,verified_by,verified_at,approved_by,approved_at)
    VALUES ('eft04c-account','TESTBANK','Sentetik şirket hesabı','9081','verified','reviewer-1',now(),'approver-2',now())`);
  await owner.query(`INSERT INTO bank_movements
    (id,bank_account_id,bank_transaction_id,amount_tl,direction,memo,occurred_at)
    VALUES ('eft04c-movement','eft04c-account','TEST-BANK-REF-001',12500,'credit','TEST-ORDER-001',now())`);
  const p0=await count("payments");
  const r0=await count("eft_reconciliation_reviews");
  server=await startNextDev({env:{
    ...process.env,
    APP_ENV:"development",
    NEON_BRANCH_ID:"eft04c-disposable-qa",
    EXPECTED_NEON_DEVELOPMENT_BRANCH_ID:"eft04c-disposable-qa",
    DATABASE_URL:raw,
    CHECKOUT_SCOPED_DB_ENABLED:"false",
    IP_HASH_SALT:randomBytes(32).toString("hex"),
    LOCAL_BUILD_NO_UPLOAD:"1", NEXT_TELEMETRY_DISABLED:"1",
  }});
  const a=await req(server.base);
  assert.equal(a.status,403,"anonymous must be denied");
  const b=await req(server.base,staffCookie);
  assert.equal(b.status,403,"ordinary staff must be denied");
  const c=await req(server.base,financeCookie);
  assert.equal(c.status,200,"finance manager should have read access");
  assert.equal(c.headers.get("cache-control"),"no-store");
  assert.equal(c.data?.mode,"read_only");
  assert.equal(c.data?.settlementEnabled,false);
  assert.equal(c.data?.paymentsWritten,false);
  assert.equal(c.data?.movements?.length,1);
  const m=c.data.movements[0];
  assert.equal(m.bankTransactionId,"TEST-BANK-REF-001");
  assert.equal(m.ibanLast4,"9081");
  assert.equal(m.amountTl,12500);
  assert.equal(m.reviewStatus,"not_reviewed");
  assert.equal(JSON.stringify(c.data).includes("TR000000000000000000000000"),false);
  const d=await req(server.base,ownerCookie);
  assert.equal(d.status,200,"super admin should have read access");
  const e=await req(server.base,financeCookie,"POST");
  assert.equal(e.status,405,"write method must not be implemented");
  assert.equal(await count("payments"),p0,"no payments created");
  assert.equal(await count("eft_reconciliation_reviews"),r0,"no reviews created");
  console.log("[eft04c-http] PASS: anonymous 403, staff 403, finance 200, super-admin 200, POST 405, 1 synthetic movement, zero payment/review writes");
} catch(e) {
  console.error("[eft04c-http] FAIL: "+(e?.message??"unknown"));
  process.exitCode=1;
} finally {
  if(server) await server.stop();
  await owner.end();
}
