const ROOT = new URL("../../", import.meta.url);
const INFRA = new URL("./p3-order-postgres.ts", import.meta.url).href;
export async function resolve(specifier, context, nextResolve) {
  if (["@/db", "@/lib/http-security", "@/lib/request-security"].includes(specifier)) return { url: INFRA, shortCircuit: true };
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, ROOT).href, context);
  return nextResolve(specifier, context);
}
