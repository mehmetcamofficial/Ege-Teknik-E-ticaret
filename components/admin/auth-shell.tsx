import type { ReactNode } from "react";

/**
 * Shared frame for /admin/login, /admin/forgot-password and /admin/reset-password. Visual only:
 * each page keeps its own <form> (action, field names, validation attributes) exactly as the auth
 * routes expect, so nothing about authentication behaviour lives here.
 */
export default function AuthShell({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="admin-theme min-h-screen lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-[#07261d] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full border-[40px] border-emerald-400/10" />
        <div>
          <p className="text-xs font-bold tracking-[.18em] text-emerald-300">EGE TEKNİK</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">Yönetim Merkezi</p>
        </div>
        <div className="relative max-w-sm">
          <p className="text-lg leading-relaxed text-emerald-50/90">Siparişler, servis talepleri, katalog ve içerik tek yerden.</p>
          <p className="mt-4 text-sm text-emerald-100/60">Yalnızca yetkili Ege Teknik personeli içindir.</p>
        </div>
      </aside>
      <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <p className="text-xs font-bold tracking-[.18em] text-primary">EGE TEKNİK</p>
            <p className="text-lg font-semibold">Yönetim Merkezi</p>
          </div>
          <div className="rounded-2xl border bg-card p-6 shadow-[0_1px_3px_rgba(16,37,31,0.08)] sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

export const authLabel = "mt-5 block text-sm font-medium";
export const authInput = "mt-1.5 w-full rounded-lg border border-input bg-white px-3 text-base shadow-xs outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 sm:text-sm";
export const authButton = "mt-6 w-full rounded-lg bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export const authLink = "rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
