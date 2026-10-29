import { Client } from "pg";
import { resolveScopedDatabaseUrl, scopedCheckoutEnabled } from "@/lib/db-access-scope";
import { handleDbAttestation } from "@/lib/db-attestation-handler";

// Node.js runtime only (pg needs it); never statically optimised or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preview-only database identity attestation (POST + `Authorization: Bearer <DB_ATTESTATION_SECRET>` + a same-origin `Origin` header, which the global
 * proxy requires of every mutating /api call). All behaviour lives in lib/db-attestation-handler.ts, where it is unit-tested with injected dependencies.
 *
 * Every HTTP method reaches the same handler: outside Preview, with the feature off or the secret weak, ALL of them answer 404, so the route's existence
 * is not revealed by trying another method. OPTIONS is exported on purpose: without it Next.js answers OPTIONS itself (204 with an `Allow` list), which would
 * reveal the route on a Production deployment. HEAD is derived from GET by Next.js and therefore goes through the handler as well. It opens a short-lived session of its own per scope (never the shared checkout pools in db/index.ts) with the same
 * certificate-verifying TLS policy as db/index.ts, and only after the caller has been authorised. It logs nothing.
 */
const handle = (request: Request) => handleDbAttestation(request, {
  env: process.env,
  resolveUrl: resolveScopedDatabaseUrl,
  scopedCheckoutEnabled,
  connect: async (connectionString) => {
    // TLS is not negotiable here. The driver lets ANY `sslmode` in the URL (Neon-issued URLs always carry one) replace the explicit `ssl` option below, which would
    // leave certificate checking to Node's default - and NODE_TLS_REJECT_UNAUTHORIZED=0 switches that off. The handler has already vetted this string, so the
    // parameter is dropped and the pinned option is the only TLS setting: certificate AND host name are always verified.
    const target = new URL(connectionString); target.searchParams.delete("sslmode");
    const client = new Client({ connectionString: target.toString(), ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 5000, application_name: "db-attestation" });
    client.on("error", () => {});   // a dropped session surfaces as a failed query; the event itself carries a driver message and is never printed
    await client.connect();
    return { query: (text: string) => client.query(text), close: () => client.end() };
  },
});

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
