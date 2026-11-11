/** EFT-04B fail-closed reconciliation decision logic. No payment writes or bank connectivity. */
export type EftCandidate = { amount:number; currency:string; orderOutstanding:number; orderCurrency:string; orderStatus:string; sourceVerified:boolean };
export type EftDecision = { status:"proposed"|"needs_review"; reason:string };
export function classifyEftMovement(input:EftCandidate):EftDecision {
 if (!input.sourceVerified) return {status:"needs_review",reason:"UNVERIFIED_SOURCE"};
 if (!Number.isSafeInteger(input.amount) || input.amount<=0) return {status:"needs_review",reason:"INVALID_AMOUNT"};
 if (input.currency!=="TRY" || input.orderCurrency!=="TRY") return {status:"needs_review",reason:"CURRENCY_MISMATCH"};
 if (input.orderStatus==="cancelled" || input.orderStatus==="returned") return {status:"needs_review",reason:"ORDER_CLOSED"};
 if (!Number.isSafeInteger(input.orderOutstanding) || input.orderOutstanding<=0) return {status:"needs_review",reason:"NOTHING_DUE"};
 if (input.amount!==input.orderOutstanding) return {status:"needs_review",reason:input.amount<input.orderOutstanding?"PARTIAL_PAYMENT":"OVERPAYMENT"};
 return {status:"proposed",reason:"AWAITING_HUMAN_REVIEW"};
}
export function canApproveEft(input:{createdBy:string;reviewedBy:string|null;approvedBy:string;sourceVerified:boolean;paymentRecorded:boolean}):boolean {
 return input.sourceVerified && input.paymentRecorded && !!input.reviewedBy &&
 input.createdBy!==input.reviewedBy && input.approvedBy!==input.createdBy && input.approvedBy!==input.reviewedBy;
}
