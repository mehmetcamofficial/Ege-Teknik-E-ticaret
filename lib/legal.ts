import { createHash } from "node:crypto";

/**
 * Canonical form of a legal document, hashed for immutable versioning:
 *  - Unicode NFC normalization
 *  - line endings normalized to "\n" (CRLF / CR -> LF)
 *  - trailing whitespace stripped from every line
 *  - leading/trailing blank lines removed
 * The title and body are joined as `${title}\n\n${body}` after each is canonicalized.
 * Any other change (wording, inner spacing, case) is meaningful and changes the hash.
 */
export function canonicalizeLegalText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

export function canonicalizeLegalDocument(input: { title: string; body: string }): string {
  return `${canonicalizeLegalText(input.title)}\n\n${canonicalizeLegalText(input.body)}`;
}

/** SHA-256 (lowercase hex) of the canonical document content. */
export function hashLegalDocument(input: { title: string; body: string }): string {
  return createHash("sha256").update(canonicalizeLegalDocument(input), "utf8").digest("hex");
}
