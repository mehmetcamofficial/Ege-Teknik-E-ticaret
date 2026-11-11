import { and, eq, sql } from "drizzle-orm";
import { orders, payments } from "../db/schema.ts";
import { bankMovements, eftReconciliationReviews } from "../db/eft-reconciliation-schema.ts";
import { audit, ledgerSums, type FinanceActor, type FinanceDb } from "./finance-db.ts";
import { derivePaymentStatus, validateManualPayment } from "./finance.ts";

/**
 * EFT-04B internal-only settlement primitive. No HTTP route is wired to this function.
 * The caller MUST verify the bank source independently; a receipt uploaded by a buyer
 * is never bank verification. Actor permissions are checked again here.
 * An approved review can only be created in the same transaction as its payment.
 */
export async function settleEftReview(db: FinanceDb, input: {
 reviewId: string; actor: FinanceActor; sourceVerified: boolean; now?: Date;
}) {
 if (!input.actor.permissions.includes("payments:record") || !input.actor.permissions.includes("audit:read"))
   return { ok:false as const, code:"FORBIDDEN" };
 if (!input.sourceVerified) return { ok:false as const, code:"UNVERIFIED_BANK_SOURCE" };
 const now=input.now??new Date();
 return db.transaction(async tx=>{
   const [candidate]=await tx.select({id:eftReconciliationReviews.id,orderId:eftReconciliationReviews.orderId})
     .from(eftReconciliationReviews).where(eq(eftReconciliationReviews.id,input.reviewId)).limit(1);
   if (!candidate?.orderId) return {ok:false as const,code:"REVIEW_NOT_FOUND"};
   // Existing finance writes lock the order first. Preserve this global lock ordering.
   const [order]=await tx.select({id:orders.id,status:orders.status,total:orders.total,paymentStatus:orders.paymentStatus})
     .from(orders).where(eq(orders.id,candidate.orderId)).for("update").limit(1);
   if (!order) return {ok:false as const,code:"ORDER_NOT_FOUND"};
   const [review]=await tx.select().from(eftReconciliationReviews)
     .where(eq(eftReconciliationReviews.id,input.reviewId)).for("update").limit(1);
   if (!review || review.orderId!==order.id) return {ok:false as const,code:"REVIEW_CHANGED"};
   if (review.status==="approved") return {ok:false as const,code:"ALREADY_APPROVED"};
   if (review.status!=="proposed" || !review.reviewedBy || !review.proposedAmount)
     return {ok:false as const,code:"REVIEW_NOT_READY"};
   if ([review.createdBy,review.reviewedBy].includes(input.actor.userId) || review.createdBy===review.reviewedBy)
     return {ok:false as const,code:"DUAL_CONTROL_REQUIRED"};
   const [movement]=await tx.select().from(bankMovements).where(eq(bankMovements.id,review.movementId)).for("update").limit(1);
   if (!movement || movement.currency!=="TRY" || movement.amount!==review.proposedAmount || movement.amount<=0)
     return {ok:false as const,code:"MOVEMENT_MISMATCH"};
   const [prior]=await tx.select({id:eftReconciliationReviews.id}).from(eftReconciliationReviews)
     .where(and(eq(eftReconciliationReviews.movementId,movement.id),eq(eftReconciliationReviews.status,"approved"))).limit(1);
   if (prior) return {ok:false as const,code:"MOVEMENT_ALREADY_USED"};
   const {collected,refunded}=await ledgerSums(tx,order.id);
   const valid=validateManualPayment({orderStatus:order.status,total:order.total,collected,amount:movement.amount});
   if (!valid.ok) return {ok:false as const,code:valid.refusal.code};
   if (order.total-collected!==movement.amount) return {ok:false as const,code:"NOT_EXACT_BALANCE"};
   const paymentId=crypto.randomUUID();
   // Both constraints prevent replay; unique provider transaction ID is tied to movement ID.
   await tx.insert(payments).values({
     id:paymentId,orderId:order.id,provider:"manual",providerTransactionId:"eft:"+movement.id,
     amount:movement.amount,currency:"TRY",status:"paid",paidAt:now,method:"bank_transfer",
     reference:"",note:"EFT reconciliation",recordedBy:input.actor.userId,
     idempotencyKey:"eft-review:"+review.id,
   });
   const [updated]=await tx.update(eftReconciliationReviews).set({
     status:"approved",approvedBy:input.actor.userId,paymentId,updatedAt:now,revision:review.revision+1,
   }).where(and(eq(eftReconciliationReviews.id,review.id),eq(eftReconciliationReviews.revision,review.revision)))
     .returning({id:eftReconciliationReviews.id});
   if (!updated) throw new Error("EFT_REVIEW_CONCURRENT_MODIFICATION");
   const next=derivePaymentStatus({total:order.total,orderStatus:order.status,collected:collected+movement.amount,refunded});
   await tx.update(orders).set({paymentStatus:next,updatedAt:now}).where(eq(orders.id,order.id));
   await audit(tx,input.actor,"eft_reconciliation_approved","order",order.id,{
     reviewId:review.id,movementId:movement.id,paymentId,amount:movement.amount,
     paymentStatus:{from:order.paymentStatus,to:next},
   });
   return {ok:true as const,paymentId,paymentStatus:next};
 });
}
