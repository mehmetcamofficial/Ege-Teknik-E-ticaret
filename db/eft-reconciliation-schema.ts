import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { adminUsers, orders, payments } from "../db/schema.ts";

/** EFT-04B staging tables: intentionally no default payment settlement. */
export const merchantBankAccounts = pgTable("merchant_bank_accounts", {
 id: text("id").primaryKey(), bankLabel: text("bank_label").notNull(), accountAlias: text("account_alias").notNull(),
 ibanLast4: text("iban_last4").notNull(), currency: text("currency").notNull().default("TRY"),
 active: boolean("active").notNull().default(false),
 createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
 updatedAt: timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
}, t=>[check("merchant_bank_accounts_iban_last4_ck",sql`${t.ibanLast4} ~ '^[0-9]{4}$'`),check("merchant_bank_accounts_currency_ck",sql`${t.currency} = 'TRY'`)]);
export const bankMovements = pgTable("bank_movements", {
 id:text("id").primaryKey(),bankAccountId:text("bank_account_id").notNull().references(()=>merchantBankAccounts.id),
 source:text("source").notNull(),externalTransactionId:text("external_transaction_id"),
 importFingerprint:text("import_fingerprint").notNull(),amount:integer("amount").notNull(),
 currency:text("currency").notNull().default("TRY"),bookedAt:timestamp("booked_at",{withTimezone:true}).notNull(),
 reference:text("reference").notNull().default(""),importedAt:timestamp("imported_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("bank_movements_external_uq").on(t.bankAccountId,t.source,t.externalTransactionId).where(sql`${t.externalTransactionId} IS NOT NULL`),
 uniqueIndex("bank_movements_fingerprint_uq").on(t.bankAccountId,t.source,t.importFingerprint),
 check("bank_movements_amount_ck",sql`${t.amount} <> 0`),check("bank_movements_currency_ck",sql`${t.currency} = 'TRY'`),
 check("bank_movements_fingerprint_ck",sql`${t.importFingerprint} ~ '^[a-f0-9]{64}$'`)]);
export const eftReconciliationReviews = pgTable("eft_reconciliation_reviews",{
 id:text("id").primaryKey(),movementId:text("movement_id").notNull().references(()=>bankMovements.id),
 orderId:text("order_id").references(()=>orders.id),status:text("status").notNull().default("unmatched"),
 proposedAmount:integer("proposed_amount"),createdBy:text("created_by").notNull().references(()=>adminUsers.id),
 reviewedBy:text("reviewed_by").references(()=>adminUsers.id),approvedBy:text("approved_by").references(()=>adminUsers.id),
 paymentId:text("payment_id").unique().references(()=>payments.id),reasonCode:text("reason_code").notNull().default(""),
 revision:integer("revision").notNull().default(1),
 createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
 updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("eft_reviews_movement_approved_uq").on(t.movementId).where(sql`${t.status} = 'approved'`),
 index("eft_reviews_status_created_idx").on(t.status,t.createdAt),
 check("eft_reviews_status_ck",sql`${t.status} IN ('unmatched','proposed','needs_review','approved','rejected')`),
 check("eft_reviews_amount_ck",sql`${t.proposedAmount} IS NULL OR ${t.proposedAmount} > 0`),
 check("eft_reviews_revision_ck",sql`${t.revision} > 0`),
 check("eft_reviews_distinct_actors_ck",sql`${t.approvedBy} IS NULL OR (${t.approvedBy} <> ${t.createdBy} AND (${t.reviewedBy} IS NULL OR ${t.approvedBy} <> ${t.reviewedBy}))`),
 check("eft_reviews_approved_ck",sql`${t.status} <> 'approved' OR (${t.orderId} IS NOT NULL AND ${t.paymentId} IS NOT NULL AND ${t.reviewedBy} IS NOT NULL AND ${t.approvedBy} IS NOT NULL)`)]);
