import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { roleHasPermission } from "../lib/security-policy.ts";
const read=(p:string)=>readFileSync(p,"utf8");
test("EFT migration is registered and staging tables exist",()=>{
 const journal=JSON.parse(read("drizzle-pg/meta/_journal.json"));
 assert.equal(journal.entries.at(-1).tag,"0026_eft_reconciliation");
 const sql=read("drizzle-pg/0026_eft_reconciliation.sql");
 for(const table of ["merchant_bank_accounts","bank_movements","eft_reconciliation_reviews"]) assert.ok(sql.includes('CREATE TABLE "'+table+'"'));
 assert.match(sql,/REVOKE ALL ON/);
 assert.match(sql,/bank_movements_fingerprint_uq/);
 assert.match(sql,/eft_reviews_movement_approved_uq/);
});
test("canonical schema owns EFT tables and contains replay constraints",()=>{
 const schema=read("db/schema.ts");
 for(const name of ["merchantBankAccounts","bankMovements","eftReconciliationReviews"]) assert.ok(new RegExp("export const "+name+"\\s*=").test(schema));
 assert.match(schema,/bank_movements_external_uq/);
 assert.match(schema,/eft_reviews_distinct_actors_ck/);
});
test("existing roles deny EFT money recording except finance manager and super admin",()=>{
 for(const role of ["viewer","support_agent","catalog_manager","operations_manager","admin","owner"])
   assert.equal(roleHasPermission(role,"payments:record"),false);
 assert.equal(roleHasPermission("finance_manager","payments:record"),true);
 assert.equal(roleHasPermission("super_admin","payments:record"),true);
});
test("approval primitive has transaction, order lock, replay guards and audit",()=>{
 const service=read("lib/eft-reconciliation-db.ts");
 assert.match(service,/db\.transaction\(/);
 assert.match(service,/\.for\("update"\)/);
 assert.match(service,/MOVEMENT_ALREADY_USED/);
 assert.match(service,/DUAL_CONTROL_REQUIRED/);
 assert.match(service,/audit\(tx/);
 assert.match(service,/UNVERIFIED_BANK_SOURCE/);
});
