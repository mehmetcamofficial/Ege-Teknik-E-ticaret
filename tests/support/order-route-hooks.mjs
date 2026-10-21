/**
 * Module resolution for tests/order-marketing-consent.test.ts and tests/order-lookup-route.test.ts,
 * registered with node:module register() inside those test files only (each test file runs in its own
 * process, so no other test is affected).
 *
 * "@/..." resolves to the project root, like the tsconfig path alias, so both routes load their real
 * domain modules (order-domain, delivery, checkout-charges, legal, order-lookup, db/schema). Only the
 * infrastructure modules - database, legal-document loading, Idempotency-Key header, HTTP helpers and
 * the server-only lookup store - resolve to the in-memory stand-ins in order-route-fakes.ts.
 */
const ROOT = new URL("../../", import.meta.url);
const FAKES = new URL("./order-route-fakes.ts", import.meta.url).href;
const FAKED = new Set(["@/db", "@/lib/legal-db", "@/lib/request-security", "@/lib/http-security", "@/lib/order-lookup-db"]);

export async function resolve(specifier, context, nextResolve) {
  if (FAKED.has(specifier)) return { url: FAKES, shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, ROOT).href, context);
  return nextResolve(specifier, context);
}
