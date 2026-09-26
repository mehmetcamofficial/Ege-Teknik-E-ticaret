"use client";

import { useState } from "react";
import { AnalyticsRangeToolbar } from "@/app/admin/analytics-range-toolbar";
import { SalesOverview } from "@/app/admin/analytics-sales";
import AnalyticsAdmin from "@/app/admin/analytics-admin";

/**
 * Analytics V2 shell (Phase 3.3B) - the beginning of the premium dashboard.
 *
 * One period, one toolbar, two sections: sales aggregates (new) and the first-party traffic panel
 * (Phase 6A, preserved unchanged). Holding the range in ONE place is the point: the sales chart and
 * the traffic chart always describe the same window, so a change can never be read across two
 * mismatched periods.
 *
 * YAGNI: this ships the sales overview and the existing traffic panel only. Products, stock, service,
 * reviews, customers, finance and any funnel are deliberately NOT here - each needs data that either
 * does not exist yet or belongs to its own slice.
 */
export default function AnalyticsV2() {
  const [query, setQuery] = useState("range=7d");

  return (
    <div className="space-y-6">
      <AnalyticsRangeToolbar query={query} onQueryChange={setQuery} />

      <section aria-labelledby="sales-overview-heading">
        <h2 id="sales-overview-heading" className="mb-3 text-lg font-semibold">Satış Özeti</h2>
        <SalesOverview rangeQuery={query} />
      </section>

      <section aria-labelledby="traffic-heading">
        <h2 id="traffic-heading" className="mb-3 text-lg font-semibold">Ziyaretçi Analitiği</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Birinci taraf, gizlilik odaklı ziyaret verileri, aynı tarih aralığı üzerinden. Ham IP veya tarayıcı bilgisi saklanmaz; bot trafiği tüm sayılardan hariç tutulur.
        </p>
        <AnalyticsAdmin query={query} />
      </section>
    </div>
  );
}
