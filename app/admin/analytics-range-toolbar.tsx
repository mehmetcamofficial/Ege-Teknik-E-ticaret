"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The one date-range control for the whole Analytics V2 page (Phase 3.3B).
 *
 * It is deliberately SHARED and CONTROLLED rather than duplicated per panel: the sales and traffic
 * views read different tables over different windows, and two independent toolbars would let an
 * admin compare a "last 7 days" sales chart against a "this month" traffic chart without noticing.
 * One toolbar means the whole page always describes exactly one period.
 *
 * A custom range loads only on the explicit "Uygula" click, never on every keystroke, so a partially
 * typed pair never fires a request. The parent turns `query` into a query string both panels use.
 */

export type AnalyticsRangePreset = "today" | "7d" | "30d" | "90d" | "month" | "year" | "custom";

export const rangeLabel: Record<AnalyticsRangePreset, string> = {
  today: "Bugün", "7d": "Son 7 gün", "30d": "Son 30 gün", "90d": "Son 90 gün",
  month: "Bu ay", year: "Bu yıl", custom: "Özel aralık",
};

const PICKABLE: AnalyticsRangePreset[] = ["today", "7d", "30d", "90d", "month", "year"];

export function AnalyticsRangeToolbar({ query, onQueryChange, loading }: { query: string; onQueryChange: (query: string) => void; loading?: boolean }) {
  const params = new URLSearchParams(query);
  const active = (params.get("range") ?? "7d") as AnalyticsRangePreset;
  const [customFrom, setCustomFrom] = useState(params.get("from") ?? "");
  const [customTo, setCustomTo] = useState(params.get("to") ?? "");

  const applyCustomRange = useCallback(() => {
    if (!customFrom || !customTo) return;
    onQueryChange(`range=custom&from=${customFrom}&to=${customTo}`);
  }, [customFrom, customTo, onQueryChange]);

  // The date inputs are re-synced whenever the APPLIED custom range changes (a preset click, or the
  // dashboard resetting the view). This is React's documented "adjusting state during render"
  // pattern rather than an effect: React re-renders immediately without committing a wasted render
  // pass first, and there is no window in which the fields could briefly show dates that are not
  // being queried. `syncedFrom` tracks the last applied value so a plain re-render is a no-op.
  const [syncedFrom, setSyncedFrom] = useState(params.get("from") ?? "");
  if (syncedFrom !== (params.get("from") ?? "")) {
    setSyncedFrom(params.get("from") ?? "");
    setCustomFrom(params.get("from") ?? "");
    setCustomTo(params.get("to") ?? "");
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium" id="analytics-range-label">Tarih aralığı</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tarih aralığı">
          {PICKABLE.map((r) => (
            <Button key={r} type="button" className="min-h-11" variant={r === active ? "default" : "outline"} aria-pressed={r === active} onClick={() => onQueryChange(`range=${r}`)}>
              {rangeLabel[r]}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="analytics-from">Başlangıç</Label>
          <Input id="analytics-from" type="date" className="min-h-11" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="analytics-to">Bitiş</Label>
          <Input id="analytics-to" type="date" className="min-h-11" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </div>
        <Button
          type="button"
          className="min-h-11"
          variant={active === "custom" ? "default" : "outline"}
          disabled={!customFrom || !customTo}
          onClick={applyCustomRange}
        >
          Uygula
        </Button>
      </div>

      <p role="status" aria-live="polite" className={cn("text-sm text-muted-foreground", loading && "opacity-70")}>
        {loading ? "Güncelleniyor…" : ""}
      </p>
    </div>
  );
}
