/**
 * AI Gateway boundary for the super-admin-only profitability advisor.
 * No DB access, tool calling, or automatic transmission of product-cost rows.
 */
export type AdviceInput = { question: string };
export type AiConfig = { enabled: boolean; key?: string; model?: string };
export function aiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    enabled: env.EGE_AI_ENABLED === "true",
    key: env.AI_GATEWAY_API_KEY?.trim(),
    model: env.AI_GATEWAY_MODEL?.trim(),
  };
}
export function aiReady(c: AiConfig): boolean {
  return !!(c.enabled && c.key && c.model && /^[a-z\d._-]+\/[a-z\d._:-]+$/i.test(c.model));
}
export class AiAdviceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export async function generateProfitAdvice(
  config: AiConfig,
  question: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (!aiReady(config)) throw new AiAdviceError(503, "AI henüz etkin değil.");
  if (!question.trim() || question.length > 1000) throw new AiAdviceError(400, "Geçersiz soru.");
  const payload = {
    model: config.model,
    stream: false,
    max_tokens: 450,
    messages: [
      {
        role: "system",
        content: "Ege Teknik için Türkçe, salt-okunur finans danışmanısın. Yalnızca kullanıcının verdiği sayıları kullan. Eksik maliyet, KDV ya da net kâr uydurma. Muhasebe veya vergi danışmanlığı iddiasında bulunma. Ürün, sipariş, stok veya veritabanını değiştiremezsin. Kısa yanıt ver.",
      },
      { role: "user", content: question },
    ],
  };
  let response: Response;
  try {
    response = await fetcher("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  } catch {
    throw new AiAdviceError(502, "AI servisine erişilemiyor.");
  }
  if (response.status === 429) throw new AiAdviceError(429, "AI istek sınırına ulaşıldı.");
  if (!response.ok) throw new AiAdviceError(502, "AI yanıtı alınamadı.");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > 64_000) throw new AiAdviceError(502, "AI yanıtı çok büyük.");
  const raw = await response.text();
  if (raw.length > 64_000) throw new AiAdviceError(502, "AI yanıtı çok büyük.");
  let value: unknown;
  try {
    const parsed = JSON.parse(raw) as { choices?: { message?: { content?: unknown } }[] };
    value = parsed.choices?.[0]?.message?.content;
  } catch { throw new AiAdviceError(502, "AI yanıtı geçersiz."); }
  if (typeof value !== "string" || !value.trim()) throw new AiAdviceError(502, "AI boş yanıt verdi.");
  return value.slice(0, 5000);
}
