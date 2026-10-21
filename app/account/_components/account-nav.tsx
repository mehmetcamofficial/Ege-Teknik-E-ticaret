"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/account", label: "Genel Bakış" },
  { href: "/account/profile", label: "Profilim" },
  { href: "/account/addresses", label: "Adreslerim" },
  { href: "/account/orders", label: "Siparişlerim" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/account" ? pathname === "/account" : pathname.startsWith(href);
}

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Hesap menüsü" className="flex gap-1 overflow-x-auto border-b border-border pb-px scrollbar-none">
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-t-md border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
