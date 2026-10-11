/** Ege Teknik profitability: integer kurus, basis points (10000 = 100%). */
export type ProfitInput = {
  saleGrossKurus: number;
  saleVatBps: number;
  purchaseNetKurus: number;
  shippingNetKurus: number;
  installationNetKurus: number;
  otherNetKurus: number;
  posFeeBps: number;
  posFixedKurus?: number;
};
const MAX_KURUS = 100_000_000_000;
const divRound = (n: bigint, d: bigint) => (n + d / 2n) / d;
const safe = (n: bigint) => {
  const value = Number(n);
  if (!Number.isSafeInteger(value)) throw new Error("Amount out of range");
  return value;
};
export function calculateProfit(input: ProfitInput) {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid " + name);
    if (name.endsWith("Kurus") && value > MAX_KURUS) throw new Error("Amount too large");
  }
  if (input.saleVatBps > 10000 || input.posFeeBps > 10000) throw new Error("Invalid rate");
  const gross = BigInt(input.saleGrossKurus);
  const revenue = divRound(gross * 10000n, BigInt(10000 + input.saleVatBps));
  const pos = divRound(gross * BigInt(input.posFeeBps), 10000n) + BigInt(input.posFixedKurus ?? 0);
  const costs = BigInt(input.purchaseNetKurus) + BigInt(input.shippingNetKurus)
    + BigInt(input.installationNetKurus) + BigInt(input.otherNetKurus) + pos;
  const contribution = revenue - costs;
  return {
    revenueNetKurus: safe(revenue),
    posFeeKurus: safe(pos),
    variableCostKurus: safe(costs),
    contributionKurus: safe(contribution),
    contributionMarginBps: revenue === 0n ? null : safe(contribution * 10000n / revenue),
    lossWarning: contribution < 0n,
  };
}
