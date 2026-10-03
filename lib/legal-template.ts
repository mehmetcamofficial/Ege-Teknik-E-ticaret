import { dateTr } from "./legal-render.ts";

/**
 * P3-LEGAL-3C.3 / P1 - the pure legal-template renderer foundation.
 *
 * The canonical drafts in `docs/legal-drafts` carry `{{TOKEN}}` placeholders that describe order-specific facts
 * (buyer, order number, line items, totals). P3-LEGAL-3C.1 proved nothing in the application ever substituted them:
 * a customer accepted a document still showing `{{ALICI_AD_SOYAD}}`. This module is the foundation for closing that.
 *
 * DESIGN RULES (all load-bearing):
 *  - PURE. No database, no network, no browser state, no clock, no randomness, no mutation. The same context always
 *    produces byte-identical output, so a rendered document can later be hashed and proven against.
 *  - FAIL CLOSED. An unknown token, a required token with no authoritative value, or any surviving `{{...}}` throws.
 *    There is no silent partial rendering and no invented value.
 *  - NO ESCAPING HERE. This returns PLAIN TEXT. HTML escaping stays in exactly one place - `renderLegalBody` in
 *    `lib/legal-render.ts` - so there is one authoritative escaping behaviour and no competing implementation.
 *  - AUTHORITATIVE INPUT ONLY. Money and identity come from the caller's server-computed context; this module never
 *    reads a client-supplied total and never derives a value the server did not decide.
 *
 * P1 scope: `SIPARIS_NO` and `SIPARIS_TARIHI` are REQUIRED here, but P1 deliberately does not decide when or how
 * they are minted. See ORDER_IDENTIFIER_PRE_ACCEPTANCE_DECISION.
 */

/** Every token the canonical drafts are allowed to use. Anything else is a blocker, not a guess. */
export const LEGAL_TEMPLATE_TOKENS = [
  "ALICI_AD_SOYAD",
  "ALICI_EPOSTA",
  "ALICI_TELEFON",
  "TESLIMAT_ADRESI",
  "TESLIMAT_YONTEMI",
  "SIPARIS_NO",
  "SIPARIS_TARIHI",
  "URUN_SATIRLARI",
  "URUN_TOPLAMI",
  "TOPLAM_TUTAR",
  "KARGO_UCRETI",
  "DIGER_EK_MASRAFLAR",
  "FATURA_BILGILERI",
] as const;

export type LegalTemplateToken = (typeof LEGAL_TEMPLATE_TOKENS)[number];

const SUPPORTED = new Set<string>(LEGAL_TEMPLATE_TOKENS);

/** One order line, in the order the authoritative checkout produced. */
export type LegalTemplateLine = { productName: string; quantity: number; unitPrice: number; lineTotal: number };

/**
 * The authoritative, server-decided values a legal document may contain. Every field is required: an absent value is
 * a fail-closed error, never an empty string silently rendered into a contract.
 */
export type OrderLegalContext = {
  ALICI_AD_SOYAD: string;
  ALICI_EPOSTA: string;
  ALICI_TELEFON: string;
  TESLIMAT_ADRESI: string;
  TESLIMAT_YONTEMI: string;
  /** Order number. P1 requires it be supplied; it does not decide where it is minted. */
  SIPARIS_NO: string;
  /** Order date. Rendered with the shared Europe/Istanbul formatter. */
  SIPARIS_TARIHI: Date;
  /** Explicitly ordered; the renderer preserves this order and never re-sorts or iterates a map. */
  URUN_SATIRLARI: readonly LegalTemplateLine[];
  URUN_TOPLAMI: number;
  TOPLAM_TUTAR: number;
  KARGO_UCRETI: number;
  DIGER_EK_MASRAFLAR: number;
  FATURA_BILGILERI: string;
};

export type LegalTemplateErrorCode = "UNKNOWN_TOKEN" | "MISSING_TOKEN_VALUE" | "INVALID_TOKEN_VALUE" | "UNRESOLVED_TOKEN_REMAINS";

export class LegalTemplateError extends Error {
  // Declared explicitly rather than as a constructor parameter property: the suite runs on Node's
  // `--experimental-strip-types`, which erases types without emitting code and so rejects parameter properties.
  readonly code: LegalTemplateErrorCode;

  constructor(code: LegalTemplateErrorCode, message: string) {
    super(message);
    this.name = "LegalTemplateError";
    this.code = code;
  }
}

/**
 * Deterministic TRY amount, matching the repository's existing money display (`tryCurrency` in lib/admin-ui.ts:
 * tr-TR, maximumFractionDigits 0, symbol first) but computed arithmetically instead of through `Intl`, so the
 * output cannot drift with the host's ICU/locale data. Same integer input, same string, on every machine.
 */
export function formatTry(amount: number): string {
  if (!Number.isInteger(amount)) throw new LegalTemplateError("INVALID_TOKEN_VALUE", `Tutar tam sayı olmalı: ${amount}`);
  const negative = amount < 0;
  const grouped = String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}₺${grouped}`;
}

const renderLines = (lines: readonly LegalTemplateLine[]): string =>
  lines.map((line) => `- ${line.productName} x${line.quantity}: ${formatTry(line.lineTotal)}`).join("\n");

const TOKEN_PATTERN = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

/**
 * Substitute every `{{TOKEN}}` in `template` from `context`, or throw.
 *
 * @throws {LegalTemplateError} UNKNOWN_TOKEN when the template uses a token outside the allow-list,
 * MISSING_TOKEN_VALUE / INVALID_TOKEN_VALUE when an authoritative value is absent or unusable, and
 * UNRESOLVED_TOKEN_REMAINS if any brace-delimited token still survives the substitution pass.
 */
export function renderOrderLegalDocument(template: string, context: OrderLegalContext): string {
  const seen = new Set<string>();
  for (const match of template.matchAll(TOKEN_PATTERN)) {
    const token = match[1];
    if (!SUPPORTED.has(token)) throw new LegalTemplateError("UNKNOWN_TOKEN", `Desteklenmeyen şablon değişkeni: {{${token}}}`);
    seen.add(token);
  }
  for (const token of seen) {
    const value = context[token as LegalTemplateToken];
    if (value === undefined || value === null) throw new LegalTemplateError("MISSING_TOKEN_VALUE", `Eksik yetkili değer: ${token}`);
    if (typeof value === "string" && value.trim() === "") throw new LegalTemplateError("MISSING_TOKEN_VALUE", `Boş yetkili değer: ${token}`);
  }
  const rendered = template.replace(TOKEN_PATTERN, (_whole, token: string) => {
    const value = context[token as LegalTemplateToken];
    if (token === "URUN_SATIRLARI") return renderLines(context.URUN_SATIRLARI);
    if (token === "SIPARIS_TARIHI") return dateTr(value as Date);
    if (typeof value === "number") return formatTry(value);
    return value as string;
  });
  if (/\{\{|\}\}/.test(rendered)) throw new LegalTemplateError("UNRESOLVED_TOKEN_REMAINS", "Çözümlenmemiş şablon değişkeni kaldı.");
  return rendered;
}
