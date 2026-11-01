/**
 * EFT-04: read-only bank-statement assessment.
 *
 * No database, filesystem, network, secrets, or payment writes. This module never
 * marks an order paid and never treats a customer's receipt as proof of funds.
 * A bank account must first be independently verified by the business.
 *
 * Amounts are WHOLE TL, matching the existing finance ledger's amount unit.
 * Bank files with decimal kuruş must be normalized in a separate reviewed adapter,
 * not silently rounded here.
 */
const ORDER_NUMBER = /^[A-Z0-9][A-Z0-9-]{3,39}$/;
const BANK_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/-]{3,99}$/;

export function maskedIban(iban) {
  if (typeof iban !== "string") return null;
  const value = iban.replace(/\s/g, "").toUpperCase();
  // A masked identifier is for review only: it does NOT certify that the
  // account belongs to Ege Teknik, or that the IBAN checksum is valid.
  if (!/^TR\d{24}$/.test(value)) return null;
  return `TR•• •••• •••• •••• •••• ••${value.slice(-4)}`;
}

/**
 * Explicitly separate review-only bank account metadata from activated accounts.
 * An empty record is never inferred as an account to send customers.
 */
export function reviewBankAccount(account) {
  if (!account || typeof account !== "object") return { ok: false, code: "ACCOUNT_MISSING" };
  const masked = maskedIban(account.iban);
  if (!masked) return { ok: false, code: "IBAN_FORMAT_INVALID" };
  if (account.verified !== true || !account.verifiedBy || !account.verifiedAt) {
    return { ok: false, code: "ACCOUNT_VERIFICATION_REQUIRED", maskedIban: masked };
  }
  return { ok: true, maskedIban: masked, status: "VERIFIED_METADATA_ONLY" };
}

const reject = (code) => ({ status: "REVIEW_REQUIRED", code, canRecordPayment: false });

/**
 * A bank statement row contains bank-assigned transaction reference, amount and
 * customer-entered transfer memo. The memo is not the unique bank transaction ID.
 *
 * orders: candidate order records previously read via a privileged, authenticated
 * admin route. No customer or bank upload directly calls a payment write.
 *
 * Strictly one candidate with exact memo and outstanding balance is required.
 * All decisions are advisory: successful assessment returns CANDIDATE_ONLY,
 * never an approval, settlement or payment.
 */
export function assessEftMovement(movement, orders, existingBankReferences = []) {
  if (!movement || !Array.isArray(orders) || !Array.isArray(existingBankReferences)) return reject("INVALID_INPUT");
  if (movement.bankAccountVerified !== true) return reject("BANK_ACCOUNT_NOT_VERIFIED");
  if (typeof movement.bankTransactionId !== "string" || !BANK_REFERENCE.test(movement.bankTransactionId.trim())) return reject("BANK_REFERENCE_INVALID");
  const bankTransactionId = movement.bankTransactionId.trim();
  if (existingBankReferences.includes(bankTransactionId)) return reject("BANK_REFERENCE_REUSED");
  if (!Number.isSafeInteger(movement.amountTl) || movement.amountTl <= 0) return reject("INVALID_AMOUNT");
  if (typeof movement.memo !== "string") return reject("ORDER_REFERENCE_MISSING");
  const memo = movement.memo.trim().toUpperCase();
  if (!ORDER_NUMBER.test(memo)) return reject("ORDER_REFERENCE_INVALID");

  const matches = orders.filter(o => o && typeof o.orderNumber === "string" && o.orderNumber.toUpperCase() === memo);
  if (matches.length === 0) return reject("ORDER_NOT_FOUND");
  if (matches.length !== 1) return reject("AMBIGUOUS_ORDER");
  const order = matches[0];
  if (order.status === "cancelled" || order.status === "returned") return reject("ORDER_CLOSED");
  if (!Number.isSafeInteger(order.outstandingTl) || order.outstandingTl <= 0) return reject("NO_BALANCE");
  if (movement.amountTl > order.outstandingTl) return reject("OVERPAYMENT");
  if (movement.amountTl < order.outstandingTl) return reject("PARTIAL_PAYMENT_REVIEW");

  return {
    status: "CANDIDATE_ONLY",
    code: "MATCH_REQUIRES_HUMAN_APPROVAL",
    canRecordPayment: false,
    orderId: order.id,
    orderNumber: order.orderNumber,
    bankTransactionId,
    amountTl: movement.amountTl,
  };
}
