import { Package, ShieldCheck, ShoppingCart, Wrench } from "lucide-react";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";

/**
 * Shared frame for /admin/login, /admin/forgot-password, /admin/reset-password and /admin/accept-invite.
 * Visual only: each page keeps its own <form> (action, field names, validation attributes) exactly as
 * the auth routes expect, so nothing about authentication behaviour lives here.
 */
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], display: "swap" });

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
          ? "grid size-11 shrink-0 place-items-center rounded-xl bg-white/10 text-base font-bold tracking-tight text-emerald-200 ring-1 ring-white/20 backdrop-blur"
          : "grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#0f7a5c] to-[#0b5a45] text-base font-bold tracking-tight text-white shadow-md shadow-emerald-900/20"
      }
    >
      ET
    </span>
  );
}

/** Decorative dashboard illustration: layered translucent rings plus floating glass panels. Pure SVG/CSS, no assets. */
function Illustration() {
  return (
    <div aria-hidden="true" className="pointer-events-none relative mx-auto h-64 w-full max-w-md select-none">
      <svg viewBox="0 0 400 288" className="absolute inset-0 size-full" fill="none">
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6ee7b7" stopOpacity=".55" />
            <stop offset="1" stopColor="#6ee7b7" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#34d399" stopOpacity=".45" />
            <stop offset="1" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>
        <circle cx="240" cy="150" r="130" stroke="url(#ring)" strokeWidth="1.5" />
        <circle cx="240" cy="150" r="98" stroke="url(#ring)" strokeWidth="1.5" opacity=".7" />
        <circle cx="240" cy="150" r="66" stroke="url(#ring)" strokeWidth="1.5" opacity=".45" />
        <circle cx="240" cy="150" r="130" fill="#34d399" fillOpacity=".04" />
      </svg>

      <div className="absolute top-4 left-2 w-56 rounded-2xl border border-white/15 bg-white/[0.08] p-4 shadow-2xl shadow-black/30 backdrop-blur-md">
        <div className="flex items-center justify-between text-[11px] text-emerald-100/70">
          <span>Haftalık sipariş</span>
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 font-semibold text-emerald-300">+18%</span>
        </div>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-white">248</p>
        <svg viewBox="0 0 200 60" className="mt-2 h-14 w-full" fill="none">
          <path d="M0 46 C25 44 30 22 55 26 S95 48 120 30 S165 6 200 12 V60 H0Z" fill="url(#area)" />
          <path d="M0 46 C25 44 30 22 55 26 S95 48 120 30 S165 6 200 12" stroke="#6ee7b7" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <div className="absolute right-0 bottom-10 w-52 rounded-2xl border border-white/15 bg-white/[0.08] p-4 shadow-2xl shadow-black/30 backdrop-blur-md">
        <p className="text-[11px] text-emerald-100/70">Servis talepleri</p>
        <div className="mt-3 grid gap-2.5">
          {[["Keşif planlandı", "w-3/4"], ["Montaj sürüyor", "w-1/2"], ["Tamamlandı", "w-11/12"]].map(([label, w]) => (
            <div key={label}>
              <div className="mb-1 text-[11px] text-white/80">{label}</div>
              <div className="h-1.5 rounded-full bg-white/10"><div className={`h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 ${w}`} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="absolute right-6 top-0 flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-medium text-emerald-100 backdrop-blur-md">
        <ShieldCheck className="size-3.5 text-emerald-300" /> Korumalı oturum
      </div>
    </div>
  );
}

export default function AuthShell({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className={`admin-theme min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]`} style={{ fontFamily: jakarta.style.fontFamily }}>
      <aside className="relative hidden overflow-hidden bg-[#06211a] px-14 py-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_15%_0%,rgba(16,185,129,0.28),transparent_70%),radial-gradient(50%_45%_at_100%_100%,rgba(20,184,166,0.22),transparent_70%),linear-gradient(160deg,#0a3a2c_0%,#06211a_55%,#041610_100%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.07)_1px,transparent_0)] [background-size:24px_24px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />

        <div className="relative flex items-center gap-4">
          <Mark />
          <div>
            <p className="text-[11px] font-semibold tracking-[.3em] text-emerald-300">EGE TEKNİK</p>
            <p className="mt-1 text-3xl font-bold tracking-tight">Yönetim Merkezi</p>
          </div>
        </div>

        <div className="relative my-8">
          <Illustration />
        </div>

        <div className="relative max-w-md">
          <p className="text-2xl leading-snug font-semibold tracking-tight text-balance">Klima ve ısıtma operasyonunuzu tek panelden yönetin.</p>
          <ul className="mt-8 grid gap-4">
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-emerald-50/80">
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/10"><Icon className="size-4 text-emerald-300" /></span>
                {text}
              </li>
            ))}
          </ul>
          <p className="mt-10 text-sm text-emerald-100/50">Yalnızca yetkili Ege Teknik personeli içindir.</p>
        </div>
      </aside>

      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#f7faf9_0%,#eaf2ef_100%)] px-5 py-12 sm:px-8 lg:px-16">
        <div aria-hidden="true" className="pointer-events-none absolute -top-32 -right-24 size-96 rounded-full bg-emerald-300/25 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full bg-teal-200/30 blur-3xl" />
        <div className="relative w-full max-w-md">
          <div className="mb-10 flex items-center gap-3.5 lg:hidden">
            <Mark tone="dark" />
            <div>
              <p className="text-[11px] font-semibold tracking-[.3em] text-primary">EGE TEKNİK</p>
              <p className="text-xl font-bold tracking-tight">Yönetim Merkezi</p>
            </div>
          </div>
          <div className="rounded-3xl border border-white/80 bg-white/75 p-8 shadow-[0_2px_4px_rgba(16,37,31,0.03),0_24px_60px_-20px_rgba(11,90,69,0.28)] ring-1 ring-black/[0.04] backdrop-blur-xl sm:p-11">
            <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight text-balance">{title}</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
