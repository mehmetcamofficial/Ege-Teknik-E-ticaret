import { desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { bankMovements, eftReconciliationReviews, merchantBankAccounts } from "../db/schema.ts";

/**
 * EFT-04C read-only persistence. No mutations; existing payments ledger untouched.
 * Only the caller's already-authorized server route may invoke this with getDb().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = NodePgDatabase<any>;
export const EFT_REVIEW_LIMIT = 50;

export async function loadEftReviewQueue(db: Db) {
  const rows = await db.select({
    movementId: bankMovements.id,
    accountId: merchantBankAccounts.id,
    bankCode: merchantBankAccounts.bankCode,
    accountLabel: merchantBankAccounts.accountLabel,
    ibanLast4: merchantBankAccounts.ibanLast4,
    accountStatus: merchantBankAccounts.status,
    bankTransactionId: bankMovements.bankTransactionId,
    amountTl: bankMovements.amountTl,
    direction: bankMovements.direction,
    memo: bankMovements.memo,
    occurredAt: bankMovements.occurredAt,
    movementStatus: bankMovements.status,
    reviewId: eftReconciliationReviews.id,
    reviewStatus: eftReconciliationReviews.status,
    reviewOrderId: eftReconciliationReviews.orderId,
    reviewedAt: eftReconciliationReviews.reviewedAt,
    approvedAt: eftReconciliationReviews.approvedAt,
  }).from(bankMovements)
    .innerJoin(merchantBankAccounts, eq(bankMovements.bankAccountId, merchantBankAccounts.id))
    .leftJoin(eftReconciliationReviews, eq(eftReconciliationReviews.movementId, bankMovements.id))
    .orderBy(desc(bankMovements.occurredAt), desc(bankMovements.id))
    .limit(EFT_REVIEW_LIMIT);
  return {
    mode: "read_only" as const,
    settlementEnabled: false as const,
    paymentsWritten: false as const,
    limit: EFT_REVIEW_LIMIT,
    movements: rows.map(row => ({
      ...row,
      // No full IBAN is stored in EFT-04B.
      ibanLast4: row.ibanLast4,
      // A review's approval is NOT evidence that a payment has been recorded.
      reviewStatus: row.reviewStatus ?? "not_reviewed",
      occurredAt: row.occurredAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
    })),
  };
}
