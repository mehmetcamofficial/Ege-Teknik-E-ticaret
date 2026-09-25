"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BarChart3, Boxes, ExternalLink, LayoutDashboard, LogOut, Menu, MessageSquare, Newspaper, Package, PanelLeftClose, PanelLeftOpen, Recycle, Scale, Settings, ShoppingCart, Tags, Wrench, X, type LucideIcon } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { activeNavHref, roleLabel, type NavIcon, type NavSection } from "@/lib/admin-ui";
import { cn } from "@/lib/utils";

const icons: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard, orders: ShoppingCart, service: Wrench, products: Package, secondHand: Recycle, taxonomy: Tags,
  inventory: Boxes, blog: Newspaper, reviews: MessageSquare, legal: Scale, analytics: BarChart3, settings: Settings,
};
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300";

function Brand({ collapsed, action }: { collapsed?: boolean; action?: ReactNode }) {
  return (
    <div className={cn("flex min-h-16 items-center justify-between gap-2 pr-2 pl-4", collapsed && "flex-col justify-center gap-1 px-2 py-2")}>
      {collapsed
        ? <span aria-hidden="true" className="grid size-9 place-items-center rounded-lg bg-emerald-400/15 text-sm font-bold text-emerald-200">ET</span>
        : <div className="min-w-0"><p className="text-xs font-bold tracking-[.18em] text-emerald-300">EGE TEKNİK</p><p className="text-base font-semibold text-white">Yönetim Merkezi</p></div>}
      {action}
    </div>
  );
}

/** The nav is built server-side from the existing RBAC (lib/admin-ui visibleNav) and only rendered here. */
function NavList({ sections, active, collapsed, onNavigate }: { sections: NavSection[]; active: string | null; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Yönetim menüsü" className="flex-1 overflow-y-auto px-2 py-2">
      {sections.map((section, i) => (
        <div key={section.title ?? `s${i}`} className={cn(i > 0 && "mt-3")}>
          {section.title ? (collapsed ? <div aria-hidden="true" className="mx-3 mb-2 border-t border-white/10" /> : <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-100/60">{section.title}</p>) : null}
          <ul className="grid gap-0.5">
            {section.items.map((item) => {
              const Icon = icons[item.icon];
              const current = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-emerald-50/85 transition-colors hover:bg-white/10 hover:text-white",
                      current && "bg-white/12 font-medium text-white shadow-[inset_3px_0_0_var(--color-emerald-300)]",
                      collapsed && "justify-center px-0", focusRing,
                    )}
                  >
                    <Icon aria-hidden="true" className="size-[18px] shrink-0" />
                    <span className={cn(collapsed && "sr-only")}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Identity({ email, role, signOutPath, collapsed }: { email: string; role: string; signOutPath: string; collapsed?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 border-t border-white/10 py-2 pr-2 pl-4", collapsed && "justify-center px-2")}>
      {!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-sm text-white" title={email}>{email}</p><p className="text-xs text-emerald-100/60">{roleLabel[role] ?? role}</p></div>}
      <form method="post" action={signOutPath}>
        <button type="submit" title={collapsed ? "Çıkış" : undefined} className={cn("flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-emerald-50/85 hover:bg-white/10 hover:text-white", collapsed && "min-w-11 justify-center px-0", focusRing)}>
          <LogOut aria-hidden="true" className="size-[18px] shrink-0" /><span className={cn(collapsed && "sr-only")}>Çıkış</span>
        </button>
      </form>
    </div>
  );
}

export default function AdminShell({ email, role, sections, signOutPath, children }: { email: string; role: string; sections: NavSection[]; signOutPath: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = activeNavHref(pathname, sections);
  const activeLabel = sections.flatMap((s) => s.items).find((i) => i.href === active)?.label ?? "Yönetim Merkezi";
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="admin-theme min-h-screen lg:grid lg:grid-cols-[auto_minmax(0,1fr)]">
      <a href="#admin-main" className="sr-only z-50 rounded-md bg-white px-4 py-2 font-medium text-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">İçeriğe geç</a>

      {/* Desktop sidebar */}
      <aside className={cn("sticky top-0 hidden h-screen flex-col bg-[#07261d] lg:flex", collapsed ? "w-[4.5rem]" : "w-64")}>
        <Brand collapsed={collapsed} action={
          <button type="button" onClick={() => setCollapsed((v) => !v)} aria-pressed={collapsed} aria-label={collapsed ? "Menüyü genişlet" : "Menüyü daralt"} title={collapsed ? "Menüyü genişlet" : "Menüyü daralt"} className={cn("grid size-11 shrink-0 place-items-center rounded-lg text-emerald-100/70 hover:bg-white/10 hover:text-white", focusRing)}>
            {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-[18px]" /> : <PanelLeftClose aria-hidden="true" className="size-[18px]" />}
          </button>
        } />
        <NavList sections={sections} active={active} collapsed={collapsed} />
        <Identity email={email} role={role} signOutPath={signOutPath} collapsed={collapsed} />
      </aside>

      {/* Mobile/tablet drawer (Radix Dialog: focus trap, Esc, focus returned to the SheetTrigger) */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" showCloseButton={false} className="w-[18rem] max-w-[85vw] gap-0 border-r-0 bg-[#07261d] p-0 text-white motion-reduce:!animate-none sm:max-w-[18rem]">
            <SheetTitle className="sr-only">Yönetim menüsü</SheetTitle>
            <SheetDescription className="sr-only">Yönetim modülleri arasında gezinin.</SheetDescription>
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <SheetClose className={cn("grid size-11 place-items-center rounded-lg text-emerald-50 hover:bg-white/10", focusRing)}><X aria-hidden="true" className="size-5" /><span className="sr-only">Menüyü kapat</span></SheetClose>
            </div>
            <NavList sections={sections} active={active} onNavigate={() => setDrawerOpen(false)} />
            <Identity email={email} role={role} signOutPath={signOutPath} />
          </SheetContent>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b bg-white/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-white/85 sm:px-5">
            <SheetTrigger aria-label="Menüyü aç" className="grid size-11 place-items-center rounded-lg text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden">
              <Menu aria-hidden="true" className="size-5" />
            </SheetTrigger>
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground"><span className="lg:hidden">Ege Teknik · </span>{activeLabel}</p>
            <a href="/" target="_blank" rel="noopener" className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <ExternalLink aria-hidden="true" className="size-4" /><span className="hidden sm:inline">Siteyi aç</span><span className="sr-only sm:hidden">Siteyi aç</span><span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
            <div className="hidden min-w-0 border-l pl-3 text-right sm:block">
              <p className="truncate text-sm font-medium" title={email}>{email}</p>
              <p className="text-xs text-muted-foreground">{roleLabel[role] ?? role}</p>
            </div>
          </header>
          <main id="admin-main" tabIndex={-1} className="mx-auto grid w-full max-w-7xl min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6 px-4 py-6 outline-none sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </Sheet>
    </div>
  );
}
