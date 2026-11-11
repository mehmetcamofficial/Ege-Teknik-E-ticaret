import assert from "node:assert/strict";
import test from "node:test";
import { classifyEftMovement, canApproveEft } from "../lib/eft-reconciliation.ts";
const base={amount:1000,currency:"TRY",orderOutstanding:1000,orderCurrency:"TRY",orderStatus:"pending_payment",sourceVerified:true};
test("verified exact movement stays proposed, never paid",()=>assert.deepEqual(classifyEftMovement(base),{status:"proposed",reason:"AWAITING_HUMAN_REVIEW"}));
test("unverified import fails closed",()=>assert.equal(classifyEftMovement({...base,sourceVerified:false}).reason,"UNVERIFIED_SOURCE"));
test("partial and excess amounts require review",()=>{
 assert.equal(classifyEftMovement({...base,amount:999}).reason,"PARTIAL_PAYMENT");
 assert.equal(classifyEftMovement({...base,amount:1001}).reason,"OVERPAYMENT");
});
test("currency and closed orders require review",()=>{
 assert.equal(classifyEftMovement({...base,currency:"USD"}).reason,"CURRENCY_MISMATCH");
 assert.equal(classifyEftMovement({...base,orderStatus:"cancelled"}).reason,"ORDER_CLOSED");
});
test("three distinct actors and recorded payment required",()=>{
 const actors={createdBy:"a",reviewedBy:"b",approvedBy:"c",sourceVerified:true,paymentRecorded:true};
 assert.equal(canApproveEft(actors),true);
 assert.equal(canApproveEft({...actors,approvedBy:"a"}),false);
 assert.equal(canApproveEft({...actors,approvedBy:"b"}),false);
 assert.equal(canApproveEft({...actors,paymentRecorded:false}),false);
});
