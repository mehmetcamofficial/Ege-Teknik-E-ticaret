import test from "node:test";
import assert from "node:assert/strict";
import { assessEftMovement, maskedIban, reviewBankAccount } from "../lib/eft-reconciliation.mjs";

const order = { id:"synthetic-order-1", orderNumber:"ETS-20261102-000101", status:"pending_payment", outstandingTl:12500 };
const movement = { bankAccountVerified:true, bankTransactionId:"BANK-TRANSFER-TEST-001", memo:order.orderNumber, amountTl:12500 };
const matched = (m=movement,orders=[order],seen=[])=>assessEftMovement(m,orders,seen);

test("no real IBAN appears; account activation requires separate verification metadata",()=>{
  const synthetic = "TR" + "0".repeat(24);
  assert.equal(maskedIban(synthetic)?.includes(synthetic),false);
  assert.equal(maskedIban("invalid"),null);
  assert.equal(reviewBankAccount({iban:synthetic,verified:false}).code,"ACCOUNT_VERIFICATION_REQUIRED");
  assert.equal(reviewBankAccount({iban:synthetic,verified:true,verifiedBy:"",verifiedAt:""}).ok,false);
  assert.equal(reviewBankAccount({iban:synthetic,verified:true,verifiedBy:"synthetic-finance",verifiedAt:"2026-11-02"}).ok,true);
});
test("an exact order and total match is advisory, not a payment",()=>{
  const r=matched();
  assert.equal(r.status,"CANDIDATE_ONLY");
  assert.equal(r.canRecordPayment,false);
  assert.equal(r.orderId,order.id);
  assert.equal(r.bankTransactionId,movement.bankTransactionId);
});
test("unverified bank account or reused bank transaction id is refused",()=>{
  assert.equal(matched({...movement,bankAccountVerified:false}).code,"BANK_ACCOUNT_NOT_VERIFIED");
  assert.equal(matched(movement,[order],[movement.bankTransactionId]).code,"BANK_REFERENCE_REUSED");
  assert.equal(matched({...movement,bankTransactionId:""}).code,"BANK_REFERENCE_INVALID");
});
test("unknown, ambiguous and invalid order memo never match",()=>{
  assert.equal(matched({...movement,memo:"ETS-20261102-UNKNOWN"}).code,"ORDER_NOT_FOUND");
  assert.equal(matched({...movement,memo:"my receipt file"}).code,"ORDER_REFERENCE_INVALID");
  assert.equal(matched(movement,[order,{...order,id:"duplicate"}]).code,"AMBIGUOUS_ORDER");
  assert.equal(matched({...movement,memo:""}).code,"ORDER_REFERENCE_INVALID");
});
test("overpayments, partial payments, closed orders and no balance need review",()=>{
  assert.equal(matched({...movement,amountTl:12501}).code,"OVERPAYMENT");
  assert.equal(matched({...movement,amountTl:12499}).code,"PARTIAL_PAYMENT_REVIEW");
  assert.equal(matched({...movement,amountTl:12.5}).code,"INVALID_AMOUNT");
  assert.equal(matched(movement,[{...order,status:"cancelled"}]).code,"ORDER_CLOSED");
  assert.equal(matched(movement,[{...order,outstandingTl:0}]).code,"NO_BALANCE");
});
test("functions do not mutate customer orders or bank movements",()=>{
  const frozenMovement=Object.freeze({...movement});
  const frozenOrder=Object.freeze({...order});
  const frozenList=Object.freeze([frozenOrder]);
  assert.equal(assessEftMovement(frozenMovement,frozenList).status,"CANDIDATE_ONLY");
  assert.equal(frozenMovement.amountTl,12500);
  assert.equal(frozenOrder.outstandingTl,12500);
});
