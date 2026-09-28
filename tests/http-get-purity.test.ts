import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * TD-02 follow-up: no API route's GET handler may write business state. This is a static guard over the handler body
 * (direct writes and transactions). Session rotation inside getAdminUser and the rate-limit counter are security
 * infrastructure, not business state, and are covered by their own tests.
 */
const root = new URL("../app/api", import.meta.url).pathname;
function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? routes(full) : name === "route.ts" ? [full] : [];
  });
}
const WRITE = /\.(insert|update|delete)\(|\.execute\(|\.transaction\(|auditedMutation\(/;

test("every GET handler under app/api is free of direct database writes", () => {
  let checked = 0;
  for (const file of routes(root)) {
    const src = readFileSync(file, "utf8");
    const start = src.search(/export (?:async )?function GET\b|export const GET\b/);
    if (start < 0) continue;
    checked += 1;
    const rest = src.slice(start + 10);
    const next = rest.search(/\nexport (?:async )?function (?:POST|PUT|PATCH|DELETE)\b|\nexport const (?:POST|PUT|PATCH|DELETE)\b/);
    const body = src.slice(start, next < 0 ? undefined : start + 10 + next);
    assert.doesNotMatch(body, WRITE, `${file.replace(root, "app/api")} GET writes to the database`);
  }
  assert.ok(checked >= 20, `expected to scan the GET routes (found ${checked})`);
});

test("the public catalog read path no longer seeds data", () => {
  const products = readFileSync(new URL("../app/api/products/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(products, /ensureCatalogInitialized|seed/i);
});
