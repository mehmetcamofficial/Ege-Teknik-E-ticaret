"use client";

import { useEffect, useState } from "react";
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
export default function AnalyticsV2({ initialQuery = "range=7d" }: { initialQuery?: string }) {
  // The page sanitises the URL on the server (`sanitizeAnalyticsQuery`), so this only ever starts from a
  // supported preset or a valid custom range. Later changes are mirrored back into the address bar with
  // replaceState: the selection survives a reload and can be shared, without pushing history entries or
  // adding a state-management layer.
  const [query, setQuery] = useState(initialQuery);
  // A URL the server had to correct (?range=bogus, an over-long custom range ...) is rewritten to the
  // canonical state the page actually shows. replaceState, and only when they differ, so it cannot
  // loop or add history entries.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).toString() !== initialQuery) {
      window.history.replaceState(null, "", `${window.location.pathname}?${initialQuery}`);
    }
  }, [initialQuery]);
  const changeQuery = (next: string) => {
    setQuery(next);
    window.history.replaceState(null, "", `${window.location.pathname}?${next}`);
  };

  return (
    <div className="space-y-6">
      <AnalyticsRangeToolbar query={query} onQueryChange={changeQuery} />

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
