import { createHmac } from "node:crypto";
import { domainToASCII } from "node:url";

/**
 * Normalises a recipient address for COMPARISON ONLY (never for sending): trim, Unicode NFC, lower-case, and the domain in its ASCII (punycode) form.
 * Nothing else is rewritten. In particular `+tag` and dots in the local part are KEPT: stripping them is a provider-specific rule (Gmail ignores dots,
 * most others do not), and a rule that is wrong merges two real people's mailboxes into one budget. The alias route is closed by the per-domain and the
 * global caps instead (see send-budget.ts). Returns null for anything that is not a plain `local@domain` address.
 */
export function normalizeRecipient(address: string): { local: string; domain: string } | null {
  const value = address.normalize("NFC").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1 || /[\s\u0000-\u001f<>(),;:"\\\[\]]/.test(value)) return null;
  const local = value.slice(0, at), domain = domainToASCII(value.slice(at + 1));
  if (!domain || !domain.includes(".") || local.length > 64 || domain.length > 253) return null;
  return { local, domain };
}

/**
 * The identity a recipient is COUNTED under (never used to send anything). Addresses are only merged where the provider documents that they are one
 * mailbox: for consumer Gmail (gmail.com and its twin googlemail.com) dots in the local part are ignored, `+suffix` aliases deliver to the base inbox and the
 * two domains are the same (https://support.google.com/mail/answer/7436150, https://support.google.com/a/users/answer/9308648). That does NOT hold for
 * Google Workspace on a custom domain or for any other provider, so no other domain is touched. Returns null when nothing is left of the local part.
 */
export function budgetIdentity(n: { local: string; domain: string }): { local: string; domain: string } | null {
  if (n.domain !== "gmail.com" && n.domain !== "googlemail.com") return n;
  const local = n.local.split("+")[0].replace(/\./g, "");
  return local ? { local, domain: "gmail.com" } : null;
}

/**
 * Opaque, non-reversible bucket component for a normalised string: HMAC-SHA256 under a server-side key, base64url (43 chars). The database only ever
 * sees this value, so a leaked table reveals no address and cannot be brute-forced without the key. The key id is part of the bucket key, so a
 * rotation (new key + new id) starts fresh buckets by design: it resets the counters once (at most one extra budget window for a recipient) and
 * leaves the old buckets to age out. Rotate on suspected exposure, not on a schedule shorter than a day.
 */
export const recipientDigest = (key: string, scope: "recipient" | "domain", value: string): string =>
  createHmac("sha256", key).update(`notification-budget:v1:${scope}:${value}`).digest("base64url");
