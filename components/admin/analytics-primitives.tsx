import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A labelled value next to a plain proportional bar, shared by the traffic and sales views so the
 * two dashboards cannot drift apart. The bar is decorative (aria-hidden) - the number beside it is
 * the real, accessible value, so nothing here is ever conveyed by graphics alone.
 */
export function BarRow({ label, value, max, href }: { label: string; value: number; max: number; href?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  // A link needs a 44px hit area; the row is only ~28px tall without it.
  const labelNode = href ? <a className="inline-flex min-h-11 max-w-full items-center underline" href={href} target="_blank" rel="noreferrer"><span className="truncate">{label}</span></a> : <span>{label}</span>;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1.5">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm">{labelNode}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{new Intl.NumberFormat("tr-TR").format(value)}</span>
        </div>
        <div aria-hidden="true" className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
      </div>
    </li>
  );
}


/**
 * One KPI card for BOTH Analytics sections, so Sales and Traffic cannot drift into two visual languages.
 *
 * The value is sized from the CARD's own width (`cqw` container units, clamped), so it shrinks smoothly
 * in a narrow grid cell instead of being cut off, and `overflow-wrap:anywhere` lets an extreme figure
 * wrap rather than clip. Nothing here uses `overflow-hidden` to hide a too-wide number; the accent bar
 * is rounded itself for that reason.
 */
export function KpiCard({ label, value, hint, footer, primary = false, className }: { label: string; value: ReactNode; hint?: ReactNode; footer?: ReactNode; primary?: boolean; className?: string }) {
  return (
    <div className={cn("@container relative min-w-0 rounded-xl border bg-card p-3.5 pl-4 shadow-[0_1px_2px_rgba(16,37,31,0.05)] before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded-l-xl", primary ? "before:bg-primary" : "before:bg-slate-300", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-semibold leading-tight tabular-nums tracking-tight [overflow-wrap:anywhere]", primary ? "text-[clamp(1.375rem,12cqw,1.875rem)]" : "text-[clamp(1.25rem,11cqw,1.5rem)]")}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{hint}</p> : null}
      {footer}
    </div>
  );
}
