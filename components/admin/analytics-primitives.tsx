/**
 * A labelled value next to a plain proportional bar, shared by the traffic and sales views so the
 * two dashboards cannot drift apart. The bar is decorative (aria-hidden) - the number beside it is
 * the real, accessible value, so nothing here is ever conveyed by graphics alone.
 */
export function BarRow({ label, value, max, href }: { label: string; value: number; max: number; href?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const labelNode = href ? <a className="underline" href={href} target="_blank" rel="noreferrer">{label}</a> : <span>{label}</span>;
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
