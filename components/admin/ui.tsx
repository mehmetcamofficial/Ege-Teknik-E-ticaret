import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/admin-ui";

/**
 * Admin Panel V2 primitives. Deliberately small and hook-free so server and client pages can both
 * use them; tables use the existing components/ui/table (which already scrolls horizontally inside
 * its own container) rather than a new DataTable abstraction.
 */

export function PageHeader({ title, description, breadcrumb, actions }: { title: string; description?: ReactNode; breadcrumb?: { href: string; label: string }[]; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb?.length ? (
          <nav aria-label="Konum" className="mb-1 text-sm text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-1.5">
              {breadcrumb.map((b) => <li key={b.href} className="flex items-center gap-1.5"><Link href={b.href} className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{b.label}</Link><span aria-hidden="true">/</span></li>)}
            </ol>
          </nav>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, description, actions, children, className, bodyClassName }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("min-w-0 rounded-xl border bg-card shadow-[0_1px_2px_rgba(16,37,31,0.05)]", className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

const toneClass: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  danger: "bg-red-50 text-red-800 ring-red-200",
};
/** Colour is never the only signal: the label text always carries the meaning. */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", toneClass[tone])}>{children}</span>;
}

export function StatCard({ label, value, hint, href, tone = "neutral" }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: Tone }) {
  const accent = { neutral: "before:bg-slate-300", info: "before:bg-sky-500", success: "before:bg-emerald-600", warning: "before:bg-amber-500", danger: "before:bg-red-600" }[tone];
  const body = (
    <>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  const cls = cn("relative block overflow-hidden rounded-xl border bg-card p-4 pl-5 shadow-[0_1px_2px_rgba(16,37,31,0.05)] before:absolute before:inset-y-0 before:left-0 before:w-1", accent);
  return href
    ? <Link href={href} className={cn(cls, "transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring")}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40 px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Success/progress uses role=status (polite); failures use role=alert (assertive). */
export function Notice({ tone, children }: { tone: "info" | "success" | "error"; children: ReactNode }) {
  const cls = { info: "border-sky-200 bg-sky-50 text-sky-900", success: "border-emerald-200 bg-emerald-50 text-emerald-900", error: "border-red-200 bg-red-50 text-red-900" }[tone];
  return <p role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm", cls)}>{children}</p>;
}

export function FormField({ label, htmlFor, hint, children, className }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Native <select> styled to match components/ui/input (44px via the .admin-theme control rule). */
export const selectClass = "h-11 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50";
