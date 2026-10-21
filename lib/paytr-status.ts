import { readPaytrConfig } from "./paytr.ts";
import { staticContentSecurityPolicy } from "./security-headers.ts";

/**
 * Admin-visible PayTR configuration status (read-only). Built ONLY from booleans, a masked merchant id and variable
 * NAMES: the merchant key and salt are reduced to "configured / not configured" here and never leave this function.
 */
export const PAYTR_CALLBACK_PATH = "/api/payments/paytr/callback";
export const PAYTR_SUCCESS_PATH = "/payment/success";
export const PAYTR_FAIL_PATH = "/payment/fail";

export type PaytrAdminState = "disabled" | "misconfigured" | "test" | "live";
export type PaytrAdminStatus = {
  provider: "paytr";
  state: PaytrAdminState;
  enabled: boolean;
  testMode: boolean;
  merchantIdMasked: string | null;
  merchantKeyConfigured: boolean;
  merchantSaltConfigured: boolean;
  okUrlConfigured: boolean;
  failUrlConfigured: boolean;
  missing: string[];
  callbackPath: string;
  successPath: string;
  failPath: string;
  cspFrameAllowed: boolean;
};

/** "1234567890" -> "12••••90"; anything of 4 characters or fewer is fully masked. */
export function maskMerchantId(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return v.length <= 4 ? "••••" : `${v.slice(0, 2)}••••${v.slice(-2)}`;
}

/** Whether the live CSP would let the PayTR iframe load. Read from the real policy string, not assumed. */
export function paytrFrameAllowedByCsp(csp = staticContentSecurityPolicy([])): boolean {
  const directive = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-src "));
  return Boolean(directive && /(^|\s)https:\/\/www\.paytr\.com(\s|$)/.test(directive));
}

export function buildPaytrAdminStatus(env: Record<string, string | undefined>): PaytrAdminStatus {
  const config = readPaytrConfig(env);
  const enabled = env.PAYTR_ENABLED === "true";
  const testMode = env.PAYTR_TEST_MODE !== "false";
  const state: PaytrAdminState = config.state === "disabled" ? "disabled" : config.state === "misconfigured" ? "misconfigured" : testMode ? "test" : "live";
  return {
    provider: "paytr", state, enabled, testMode,
    merchantIdMasked: maskMerchantId(env.PAYTR_MERCHANT_ID),
    merchantKeyConfigured: Boolean(env.PAYTR_MERCHANT_KEY?.trim()),
    merchantSaltConfigured: Boolean(env.PAYTR_MERCHANT_SALT?.trim()),
    okUrlConfigured: Boolean(env.PAYTR_OK_URL?.trim()),
    failUrlConfigured: Boolean(env.PAYTR_FAIL_URL?.trim()),
    missing: config.state === "misconfigured" ? config.missing : [],
    callbackPath: PAYTR_CALLBACK_PATH, successPath: PAYTR_SUCCESS_PATH, failPath: PAYTR_FAIL_PATH,
    cspFrameAllowed: paytrFrameAllowedByCsp(),
  };
}
