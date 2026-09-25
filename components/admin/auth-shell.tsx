import { Package, ShoppingCart, Wrench } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared frame for /admin/login, /admin/forgot-password and /admin/reset-password. Visual only:
 * each page keeps its own <form> (action, field names, validation attributes) exactly as the auth
 * routes expect, so nothing about authentication behaviour lives here.
 */
const features = [
  { icon: ShoppingCart, text: "Siparişler ve ödeme durumu tek ekranda" },
  { icon: Package, text: "Katalog, stok ve fiyatlar canlı veritabanında" },
  { icon: Wrench, text: "Servis ve keşif talepleri baştan sona takipte" },
];

function Mark({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <span
      aria-hidden="true"
      className={
        tone === "light"
          ? "grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-base font-bold tracking-tight text-emerald-200 ring-1 ring-white/15"
          : "grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-base font-bold tracking-tight text-primary-foreground"
      }
    >
      ET
    </span>
  );
}

export default function AuthShell({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="admin-theme min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-[#07261d] px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.08)_1px,transparent_0)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <div className="relative flex items-center gap-3">
          <Mark />
          <div>
            <p className="text-xs font-bold tracking-[.2em] text-emerald-300">EGE TEKNİK</p>
            <p className="text-xl font-semibold tracking-tight">Yönetim Merkezi</p>
          </div>
        </div>
        <div className="relative max-w-sm">
          <p className="text-2xl leading-snug font-medium text-balance">Klima ve ısıtma operasyonunuzu tek panelden yönetin.</p>
          <ul className="mt-8 grid gap-4">
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-emerald-50/85">
                <span aria-hidden="true" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/10"><Icon className="size-3.5" /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-emerald-100/50">Yalnızca yetkili Ege Teknik personeli içindir.</p>
      </aside>

      <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 lg:px-16">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Mark tone="dark" />
            <div>
              <p className="text-xs font-bold tracking-[.2em] text-primary">EGE TEKNİK</p>
              <p className="text-lg font-semibold">Yönetim Merkezi</p>
            </div>
          </div>
          <div className="rounded-2xl border bg-card p-7 shadow-[0_1px_2px_rgba(16,37,31,0.04),0_12px_32px_-16px_rgba(16,37,31,0.18)] sm:p-9">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
