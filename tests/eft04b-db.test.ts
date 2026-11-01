import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import pg from "pg";
import { readFileSync } from "node:fs";
import { roleHasPermission } from "../lib/security-policy.ts";

/**
 * EFT-04B: real PostgreSQL candidate-schema gate. Never run on Production/Preview.
 * The existing commerce PG runner resets and migrates ONLY a disposable sprintb
 * DB on loopback, then supplies FINANCE_TEST_DATABASE_URL to this test.
 */
const url = process.env.FINANCE_TEST_DATABASE_URL;
const skip = !url && "disposable PostgreSQL required";
let pool: pg.Pool;
const prefix = "eft04b-" + crypto.randomUUID();
const account = prefix + "-account";
const movement = prefix + "-movement";
const movement2 = prefix + "-movement-2";
const reviewedAt = new Date("2026-10-01T10:00:00Z");
const txTime = new Date("2026-10-01T08:00:00Z");
before(async () => {
  if (skip) return;
  const target = new URL(url!);
  if (!["127.0.0.1","localhost","::1"].includes(target.hostname) || !target.pathname.slice(1).startsWith("sprintb"))
    throw new Error("EFT04B_DB_TARGET_REFUSED");
  pool = new pg.Pool({ connectionString: url });
});
after(async () => { if (pool) await pool.end(); });

test("migration is additive, journaled and never changes orders, payments, users or roles",()=>{
  const sql = readFileSync("drizzle-pg/0026_eft04b_bank_reconciliation.sql","utf8");
  const journal = JSON.parse(readFileSync("drizzle-pg/meta/_journal.json","utf8"));
  assert.equal(journal.entries.at(-1)?.tag,"0026_eft04b_bank_reconciliation");
  assert.equal((sql.match(/CREATE TABLE/g)||[]).length,3);
  assert.doesNotMatch(sql,/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER TABLE|GRANT)\b/i);
  assert.doesNotMatch(sql,/\b(?:iban_full|iban_ciphertext|bank_password|api_secret)\b/i);
});
test("finance RBAC requires money permissions; normal staff cannot configure or record",()=>{
  assert.equal(roleHasPermission("finance_manager","payments:record"),true);
  assert.equal(roleHasPermission("operations_manager","payments:record"),false);
  assert.equal(roleHasPermission("finance_manager","payments:configure"),false);
  assert.equal(roleHasPermission("super_admin","payments:configure"),true);
});
test("bank account requires distinct reviewer and approver, and stores only last four digits", {skip}, async()=>{
  await pool.query(`INSERT INTO merchant_bank_accounts (id,bank_code,account_label,iban_last4) VALUES ($1,'SYNTH','Synthetic business account','0101')`,[account]);
  await assert.rejects(pool.query(`UPDATE merchant_bank_accounts SET status='verified' WHERE id=$1`,[account]), /eft_accounts_approval_ck/);
  await assert.rejects(pool.query(`UPDATE merchant_bank_accounts SET status='verified',verified_by='same-person',approved_by='same-person',verified_at=now(),approved_at=now() WHERE id=$1`,[account]),/eft_accounts_approval_ck/);
  await pool.query(`UPDATE merchant_bank_accounts SET status='verified',verified_by='reviewer-a',approved_by='approver-b',verified_at=now(),approved_at=now() WHERE id=$1`,[account]);
  const result=await pool.query(`SELECT status,iban_last4 FROM merchant_bank_accounts WHERE id=$1`,[account]);
  assert.deepEqual(result.rows[0],{status:"verified",iban_last4:"0101"});
});
test("bank transaction id is unique per account, and zero/negative amount is refused", {skip},async()=>{
  await pool.query(`INSERT INTO bank_movements (id,bank_account_id,bank_transaction_id,amount_tl,direction,memo,occurred_at) VALUES ($1,$2,'BANK-ID-10001',12500,'credit','SYNTH-ORDER', $3)`,[movement,account,txTime]);
  await assert.rejects(pool.query(`INSERT INTO bank_movements (id,bank_account_id,bank_transaction_id,amount_tl,direction,occurred_at) VALUES ($1,$2,'BANK-ID-10001',12500,'credit',$3)`,[movement2,account,txTime]),/eft_movements_account_tx_uq/);
  await assert.rejects(pool.query(`INSERT INTO bank_movements (id,bank_account_id,bank_transaction_id,amount_tl,direction,occurred_at) VALUES ($1,$2,'BANK-ID-10002',0,'credit',$3)`,[movement2,account,txTime]),/eft_movements_amount_ck/);
});
test("review approval requires separate humans and a real order, never creates payment itself", {skip},async()=>{
  const review = prefix + "-review";
  await pool.query(`INSERT INTO eft_reconciliation_reviews (id,movement_id) VALUES ($1,$2)`,[review,movement]);
  await assert.rejects(pool.query(`UPDATE eft_reconciliation_reviews SET status='approved' WHERE id=$1`,[review]),/eft_reviews_approval_ck/);
  const orderId=prefix+"-order";
  await pool.query(`INSERT INTO orders (id,order_number,idempotency_key,customer_name,phone,city,address,subtotal,vat_total,total) VALUES ($1,$2,$3,'Synthetic tester','05000000000','Aydın','Synthetic address',1000,0,1000)`,[orderId,prefix.toUpperCase(),prefix+'-idempotency']);
  await assert.rejects(pool.query(`UPDATE eft_reconciliation_reviews SET status='approved',order_id=$2,reviewed_by='same',approved_by='same',reviewed_at=$3,approved_at=$3 WHERE id=$1`,[review,orderId,reviewedAt]),/eft_reviews_approval_ck/);
  await pool.query(`UPDATE eft_reconciliation_reviews SET status='approved',order_id=$2,reviewed_by='checker-1',approved_by='approver-2',reviewed_at=$3,approved_at=$3 WHERE id=$1`,[review,orderId,reviewedAt]);
  const p=await pool.query(`SELECT count(*)::int AS n FROM payments WHERE order_id=$1`,[orderId]);
  assert.equal(p.rows[0].n,0,"approving a bank movement cannot mark an order paid");
});
