import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * PayTR iFrame API foundation (Phase 3.3B prep) - pure helpers only: config, money, merchant_oid, hashes, status
 * mapping. No DB, no network, no framework import, so every rule is unit-testable without credentials.
 *
 * SECRETS: merchant key and salt only ever enter createHmac below. No function returns, logs or embeds them in an
 * error message; the config reader reports missing variable NAMES, never values. Nothing here is imported by client code.
 *
 * Algorithm (PayTR iFrame API, official):
 *   token  = base64(HMAC-SHA256(key = merchant_key, merchant_id + user_ip + merchant_oid + email + payment_amount +
 *            user_basket + no_installment + max_installment + currency + test_mode + merchant_salt))
 *   notify = base64(HMAC-SHA256(key = merchant_key, merchant_oid + merchant_salt + status + total_amount))
 */

export const PAYTR_PROVIDER = "paytr";
export const PAYTR_TOKEN_URL = "https://www.paytr.com/odeme/api/get-token";
export const PAYTR_IFRAME_BASE = "https://www.paytr.com/odeme/guvenli/";
export const PAYTR_TIMEOUT_MINUTES = 30;

export type PaytrConfig = {
  merchantId: string; merchantKey: string; merchantSalt: string;
  testMode: boolean; okUrl: string; failUrl: string; iframeV2: boolean;
};
export type PaytrConfigResult =
  | { state: "disabled" }
  | { state: "misconfigured"; missing: string[] }
  | { state: "enabled"; config: PaytrConfig };

const REQUIRED = ["PAYTR_MERCHANT_ID", "PAYTR_MERCHANT_KEY", "PAYTR_MERCHANT_SALT", "PAYTR_OK_URL", "PAYTR_FAIL_URL"] as const;
const validUrl = (value: string) => { try { const u = new URL(value); return u.protocol === "https:" || (u.protocol === "http:" && u.hostname === "localhost"); } catch { return false; } };

/**
 * Server-side only. PAYTR_ENABLED must be exactly "true" to enable; anything else is off. Test mode stays ON unless
 * PAYTR_TEST_MODE is exactly "false". A misconfiguration names the offending variables, never their values.
 */
export function readPaytrConfig(env: Record<string, string | undefined>): PaytrConfigResult {
  if (env.PAYTR_ENABLED !== "true") return { state: "disabled" };
  const missing: string[] = REQUIRED.filter((name) => !env[name]?.trim());
  if (env.PAYTR_MERCHANT_ID?.trim() && !/^\d{1,20}$/.test(env.PAYTR_MERCHANT_ID.trim())) missing.push("PAYTR_MERCHANT_ID(format)");
  for (const name of ["PAYTR_OK_URL", "PAYTR_FAIL_URL"] as const) if (env[name]?.trim() && !validUrl(env[name]!.trim())) missing.push(`${name}(https)`);
  if (missing.length) return { state: "misconfigured", missing };
  return {
    state: "enabled",
    config: {
      merchantId: env.PAYTR_MERCHANT_ID!.trim(), merchantKey: env.PAYTR_MERCHANT_KEY!.trim(), merchantSalt: env.PAYTR_MERCHANT_SALT!.trim(),
      testMode: env.PAYTR_TEST_MODE !== "false", okUrl: env.PAYTR_OK_URL!.trim(), failUrl: env.PAYTR_FAIL_URL!.trim(),
      // Carried for the Preview integration step; no code path depends on it until the v2 behaviour is confirmed with PayTR.
      iframeV2: env.PAYTR_IFRAME_V2 !== "false",
    },
  };
}

// ---- money --------------------------------------------------------------------------------------------------------
/**
 * TL -> kuruş without floating point. Integers are whole TL (the unit of orders.total); a string may carry up to two
 * decimals ("99.99" or "99,99"). Anything else throws - an amount that cannot be represented exactly is never sent.
 */
export function tlToKurus(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("amount must be a non-negative whole TL integer");
    const kurus = value * 100;
    if (!Number.isSafeInteger(kurus)) throw new RangeError("amount too large");
    return kurus;
  }
  const m = /^(\d{1,13})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new RangeError("amount is not a TL value with at most two decimals");
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
/** "12345" kuruş -> "123.45" for the basket, again integer-only. */
export const kurusToTlString = (kurus: number) => `${Math.floor(kurus / 100)}.${String(kurus % 100).padStart(2, "0")}`;

// ---- merchant_oid -------------------------------------------------------------------------------------------------
/**
 * PayTR requires merchant_oid to be alphanumeric (max 64). It is the customer-visible order number without dashes plus
 * a random attempt suffix: unique per attempt, never reused, and it reveals no internal id. Stored in
 * payments.provider_transaction_id, whose (provider, provider_transaction_id) unique index is the callback lookup.
 */
export function newMerchantOid(orderNumber: string, random: (n: number) => Buffer = randomBytes): string {
  const base = orderNumber.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 40);
  const suffix = random(8).toString("hex").toUpperCase();
  return `${base}P${suffix}`;
}
export const isMerchantOid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9]{1,64}$/.test(value);

// ---- hashes -------------------------------------------------------------------------------------------------------
const hmacBase64 = (key: string, data: string) => createHmac("sha256", key).update(data, "utf8").digest("base64");

export type TokenHashInput = {
  merchantId: string; userIp: string; merchantOid: string; email: string; paymentAmount: number; userBasket: string;
  noInstallment: 0 | 1; maxInstallment: number; currency: "TL"; testMode: 0 | 1;
};
export function paytrTokenHash(input: TokenHashInput, secrets: { merchantKey: string; merchantSalt: string }): string {
  const hashStr = `${input.merchantId}${input.userIp}${input.merchantOid}${input.email}${input.paymentAmount}${input.userBasket}${input.noInstallment}${input.maxInstallment}${input.currency}${input.testMode}`;
  return hmacBase64(secrets.merchantKey, hashStr + secrets.merchantSalt);
}

export function paytrCallbackHash(fields: { merchantOid: string; status: string; totalAmount: string }, secrets: { merchantKey: string; merchantSalt: string }): string {
  return hmacBase64(secrets.merchantKey, `${fields.merchantOid}${secrets.merchantSalt}${fields.status}${fields.totalAmount}`);
}

/** Constant-time comparison of the received hash against the expected one; any length or type mismatch is false. */
export function verifyPaytrCallbackHash(fields: { merchantOid: string; status: string; totalAmount: string; hash: string }, secrets: { merchantKey: string; merchantSalt: string }): boolean {
  const expected = Buffer.from(paytrCallbackHash(fields, secrets), "utf8");
  const received = Buffer.from(String(fields.hash ?? ""), "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// ---- basket / token request ---------------------------------------------------------------------------------------
export type BasketLine = { name: string; unitPriceKurus: number; quantity: number };
export const encodeBasket = (lines: readonly BasketLine[]) => Buffer.from(JSON.stringify(lines.map((l) => [l.name.slice(0, 200), kurusToTlString(l.unitPriceKurus), l.quantity])), "utf8").toString("base64");

export type TokenRequestInput = {
  merchantOid: string; userIp: string; email: string; paymentAmountKurus: number; basket: readonly BasketLine[];
  userName: string; userAddress: string; userPhone: string; okUrl: string; failUrl: string;
};
/** The form body POSTed to PayTR's get-token endpoint. Contains the token hash, never the key or salt themselves. */
export function buildTokenRequest(config: PaytrConfig, input: TokenRequestInput): Record<string, string> {
  const userBasket = encodeBasket(input.basket);
  const testMode = config.testMode ? 1 : 0;
  const fields = { merchantId: config.merchantId, userIp: input.userIp, merchantOid: input.merchantOid, email: input.email, paymentAmount: input.paymentAmountKurus, userBasket, noInstallment: 1 as const, maxInstallment: 0, currency: "TL" as const, testMode: testMode as 0 | 1 };
  return {
    merchant_id: config.merchantId, user_ip: input.userIp, merchant_oid: input.merchantOid, email: input.email,
    payment_amount: String(input.paymentAmountKurus), paytr_token: paytrTokenHash(fields, config), user_basket: userBasket,
    debug_on: String(testMode), no_installment: "1", max_installment: "0", user_name: input.userName.slice(0, 60),
    user_address: input.userAddress.slice(0, 400), user_phone: input.userPhone.slice(0, 20), merchant_ok_url: input.okUrl,
    merchant_fail_url: input.failUrl, timeout_limit: String(PAYTR_TIMEOUT_MINUTES), currency: "TL", test_mode: String(testMode), lang: "tr",
  };
}

/** Appends the attempt reference to the configured result URL so the result page can read the real payment state. */
export function resultUrl(base: string, merchantOid: string): string {
  const u = new URL(base);
  u.searchParams.set("ref", merchantOid);
  return u.toString();
}

// ---- callback -----------------------------------------------------------------------------------------------------
export type PaytrCallback = {
  merchantOid: string; status: string; totalAmount: string; hash: string; paymentAmount: string | null;
  failedReasonCode: string | null; failedReasonMsg: string | null; paymentType: string | null; testMode: string | null; currency: string | null;
};
/** Reads the notification form. Only these fields are ever read; anything else PayTR sends is ignored. */
export function parsePaytrCallback(form: URLSearchParams): PaytrCallback {
  const get = (k: string) => form.get(k);
  return {
    merchantOid: get("merchant_oid") ?? "", status: get("status") ?? "", totalAmount: get("total_amount") ?? "", hash: get("hash") ?? "",
    paymentAmount: get("payment_amount"), failedReasonCode: get("failed_reason_code"), failedReasonMsg: get("failed_reason_msg"),
    paymentType: get("payment_type"), testMode: get("test_mode"), currency: get("currency"),
  };
}

/** Provider status -> internal payment status. Refunds are a separate lifecycle and never arrive through here. */
export function mapPaytrStatus(status: string): "paid" | "failed" | null {
  if (status === "success") return "paid";
  if (status === "failed") return "failed";
  return null;
}

/** Server-side failure detail: bounded, control characters stripped. Never rendered to the customer. */
export const sanitizeProviderText = (value: string | null, max = 200) => (value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
