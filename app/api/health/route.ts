import { getPool } from "@/db";
import { logHealthFailure, type HealthFailurePhase } from "@/lib/health-diagnostics";

export const dynamic = "force-dynamic";

export async function GET() {
  let phase: HealthFailurePhase = "pool_init";
  try {
    const pool = getPool();
    phase = "db_query";
    await pool.query("select 1");
    return Response.json(
      { ok: true, environment: process.env.APP_ENV, branchId: process.env.NEON_BRANCH_ID },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    logHealthFailure(phase, error);
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
