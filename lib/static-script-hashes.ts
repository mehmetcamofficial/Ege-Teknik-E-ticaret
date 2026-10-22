import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi;

/* Data blocks (structured data) are never executed by the browser, so CSP script-src does not apply to them. */
const DATA_BLOCK_TYPE = /\stype\s*=\s*["']?application\/(ld\+)?json["']?/i;

export function inlineScriptBodies(html: string): string[] {
  const bodies: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    if (DATA_BLOCK_TYPE.test(match[1])) continue;
    const body = match[2];
    if (body.trim()) bodies.push(body);
  }
  return bodies;
}

export function sha256Source(body: string): string {
  return `sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`;
}

/** Hashes every inline script in the legacy static pages so the CSP needs no 'unsafe-inline'. */
export function collectStaticScriptHashes(publicDir: string): string[] {
  const hashes = new Set<string>();
  for (const entry of readdirSync(publicDir)) {
    if (!entry.endsWith(".html")) continue;
    for (const body of inlineScriptBodies(readFileSync(join(publicDir, entry), "utf8"))) hashes.add(sha256Source(body));
  }
  return [...hashes].sort();
}
