import { getAdminUser } from "@/lib/admin-auth";
import { claimProfitabilityAiMonthlyQuota } from "@/lib/ai/profitability-quota";
import { readJson, assertSameOrigin, rateLimit, HttpError } from "@/lib/http-security";
import { z } from "zod";
import { aiConfig, aiReady, generateProfitAdvice, AiAdviceError } from "@/lib/ai/profitability-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const unauthorized = () => Response.json({ error: "Yetkisiz erişim" }, { status: 403, headers });
async function authorize() {
  const user = await getAdminUser("payments:configure");
  return user?.role === "super_admin";
}
export async function GET() {
  if (!(await authorize())) return unauthorized();
  return Response.json({ enabled: aiReady(aiConfig()) }, { headers });
}
export async function POST(request: Request) {
  if (!(await authorize())) return unauthorized();
  const config = aiConfig();
  if (!aiReady(config)) return Response.json({ error: "AI kapalı veya eksik yapılandırılmış." }, { status: 503, headers });
  let body: unknown;
  try { body = await readJson(request); }
  catch { return Response.json({ error: "Geçersiz istek." }, { status: 400, headers }); }
  const parsed = z.object({ question: z.string().trim().min(1).max(1000) }).strict().safeParse(body);
  if (!parsed.success) return Response.json({ error: "Geçersiz soru." }, { status: 400, headers });
  try {
    // Fail closed if the distributed rate-limit store cannot be reached.
    assertSameOrigin(request);
    await rateLimit(request, "admin-profitability-ai", 10, 60 * 60_000);
    if (!(await claimProfitabilityAiMonthlyQuota())) return Response.json({ error: "Aylık AI istek kotası doldu." }, { status: 429, headers });
    const answer = await generateProfitAdvice(config, parsed.data.question);
    return Response.json({ answer }, { headers });
  } catch (e) {
    const status = e instanceof AiAdviceError || e instanceof HttpError ? e.status : 502;
    const message = e instanceof AiAdviceError || e instanceof HttpError ? e.message : "AI yanıtı oluşturulamadı.";
    return Response.json({ error: message }, { status, headers });
  }
}
