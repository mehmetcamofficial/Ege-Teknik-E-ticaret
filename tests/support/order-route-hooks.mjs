/**
 * Module resolution for tests/order-marketing-consent.test.ts, registered with node:module register()
 * inside that test file only (each test file runs in its own process, so no other test is affected).
 *
 * "@/..." resolves to the project root, like the tsconfig path alias, so the order route loads its real
 * domain modules (order-domain, delivery, checkout-charges, legal, db/schema). Only the four
 * infrastructure modules - database, legal-document loading, Idempotency-Key header and HTTP helpers -
 * resolve to the in-memory stand-ins in order-route-fakes.ts.
 */
const ROOT = new URL("../../", import.meta.url);
const FAKES = new URL("./order-route-fakes.ts", import.meta.url).href;
const FAKED = new Set(["@/db", "@/lib/legal-db", "@/lib/request-security", "@/lib/http-security"]);

export async function resolve(specifier, context, nextResolve) {
  if (FAKED.has(specifier)) return { url: FAKES, shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, ROOT).href, context);
  return nextResolve(specifier, context);
}
