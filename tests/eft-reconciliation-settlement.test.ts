import assert from "node:assert/strict";
import test from "node:test";
import { settleEftReview } from "../lib/eft-reconciliation-db.ts";
const actor={userId:"finance-1",email:"finance@example.test",permissions:["payments:record","audit:read"]};
test("settlement refuses actors without payment permission before opening a transaction",async()=>{
 const db={transaction:()=>{throw Error("transaction must not start")}};
 const result=await settleEftReview(db as never,{reviewId:"r1",actor:{...actor,permissions:["audit:read"]},sourceVerified:true});
 assert.deepEqual(result,{ok:false,code:"FORBIDDEN"});
});
test("settlement refuses unverified source before opening a transaction",async()=>{
 const db={transaction:()=>{throw Error("transaction must not start")}};
 const result=await settleEftReview(db as never,{reviewId:"r1",actor,sourceVerified:false});
 assert.deepEqual(result,{ok:false,code:"UNVERIFIED_BANK_SOURCE"});
});
test("settlement refuses actors without audit permission",async()=>{
 const db={transaction:()=>{throw Error("transaction must not start")}};
 const result=await settleEftReview(db as never,{reviewId:"r1",actor:{...actor,permissions:["payments:record"]},sourceVerified:true});
 assert.deepEqual(result,{ok:false,code:"FORBIDDEN"});
});
