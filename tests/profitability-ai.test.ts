import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { calculateProfit } from "../lib/profitability.ts";
import { aiConfig, aiReady, generateProfitAdvice, AiAdviceError } from "../lib/ai/profitability-gateway.ts";

const base = { saleGrossKurus: 3_000_000, saleVatBps: 2000, purchaseNetKurus: 2_000_000, shippingNetKurus: 50_000, installationNetKurus: 150_000, otherNetKurus: 10_000, posFeeBps: 300, posFixedKurus: 0 };
test("sale VAT and POS commission reduce contribution correctly", () => {
  const result = calculateProfit(base);
  assert.equal(result.revenueNetKurus, 2_500_000);
  assert.equal(result.posFeeKurus, 90_000);
  assert.equal(result.contributionKurus, 200_000);
  assert.equal(result.contributionMarginBps, 800);
});
test("loss and zero sales", () => {
  assert.equal(calculateProfit({ ...base, purchaseNetKurus: 3_000_000 }).lossWarning, true);
  assert.equal(calculateProfit({ ...base, saleGrossKurus: 0 }).contributionMarginBps, null);
});
test("invalid amounts and rates rejected", () => {
  assert.throws(() => calculateProfit({ ...base, purchaseNetKurus: -1 }));
  assert.throws(() => calculateProfit({ ...base, saleVatBps: 10001 }));
  assert.throws(() => calculateProfit({ ...base, posFeeBps: 10001 }));
  assert.throws(() => calculateProfit({ ...base, saleGrossKurus: Number.MAX_SAFE_INTEGER }));
});
test("AI disabled by default and without key", () => {
  assert.equal(aiReady(aiConfig({} as NodeJS.ProcessEnv)), false);
  assert.equal(aiReady({ enabled: true, model: "provider/model" }), false);
});
test("AI adapter sends no tools or costs by itself", async () => {
  const config = { enabled: true, key: "unit-test-key", model: "provider/model" };
  const answer = await generateProfitAdvice(config, "Teklif nasıl hazırlanır?", async (_url, init) => {
    assert.equal((init?.headers as Record<string,string>).Authorization, "Bearer unit-test-key");
    const payload = JSON.parse(init?.body as string);
    assert.equal(payload.tools, undefined);
    assert.equal(payload.messages[1].content, "Teklif nasıl hazırlanır?");
    return new Response(JSON.stringify({ choices: [{ message: { content: "Maliyetleri kontrol edin." } }] }), { status: 200 });
  });
  assert.equal(answer, "Maliyetleri kontrol edin.");
});
test("AI errors do not expose provider diagnostics", async () => {
  const config = { enabled: true, key: "unit-test-key", model: "provider/model" };
  await assert.rejects(
    generateProfitAdvice(config, "Soru", async () => new Response("private diagnostic unit-test-key", { status: 500 })),
    (e: unknown) => e instanceof AiAdviceError && !e.message.includes("unit-test-key"),
  );
});

test("AI admin endpoint enforces same-origin and a distributed request cap", () => {
  const route = readFileSync("app/api/admin/finance/profitability/ai/route.ts", "utf8");
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /await rateLimit\(request, "admin-profitability-ai", 10, 60 \* 60_000\)/);
  assert.match(route, /await getAdminUser\("payments:configure"\)/);
  assert.match(route, /user\?\.role === "super_admin"/);
});

test("AI quota is global, atomic, and checked before any paid request", () => {
  const route = readFileSync("app/api/admin/finance/profitability/ai/route.ts", "utf8");
  const quota = readFileSync("lib/ai/profitability-quota.ts", "utf8");
  assert.match(route, /await claimProfitabilityAiMonthlyQuota\(\)/);
  assert.ok(route.indexOf("await claimProfitabilityAiMonthlyQuota()") < route.indexOf("await generateProfitAdvice("));
  assert.match(quota, /limit: 100/);
  assert.match(quota, /claimRateLimit\(createRateLimitStore\(getDb\(\)\)/);
  assert.match(quota, /Date\.UTC\(year, month \+ 1, 1\)/);
});
test("AI endpoint rejects unauthorized requests before config, database writes or provider call", () => {
  const route = readFileSync("app/api/admin/finance/profitability/ai/route.ts", "utf8");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.match(post, /if \(!\(await authorize\(\)\)\) return unauthorized\(\)/);
  assert.ok(post.indexOf("if (!(await authorize())) return unauthorized()") < post.indexOf("const config = aiConfig()"));
  assert.match(route, /private, no-store/);
});

test("finance visuals never invent profitability and gate the scenario entry", () => {
  const visual = readFileSync("app/admin/(panel)/finance/finance-visuals.tsx", "utf8");
  const page = readFileSync("app/admin/(panel)/finance/page.tsx", "utf8");
  assert.match(visual, /summary\.collected/);
  assert.match(visual, /summary\.outstanding/);
  assert.match(visual, /methods\.map/);
  assert.match(visual, /canViewProfitability \?/);
  assert.match(visual, /Gerçek alış maliyetleri henüz kaydedilmediğinden/);
  assert.match(page, /admin\.role === "super_admin"/);
});

test("finance report has mobile cards and direct authorized order detail links", () => {
  const view = readFileSync("app/admin/(panel)/finance/finance-view.tsx", "utf8");
  assert.match(view, /aria-label="Mobil satış raporu"/);
  assert.match(view, /hidden lg:block/);
  assert.match(view, /Sipariş ve ödeme detayları/);
  assert.match(view, /href=\{`\/admin\/orders\/\$\{r\.orderId\}`\}/);
});
