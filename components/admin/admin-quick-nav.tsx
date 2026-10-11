"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { NavSection } from "@/lib/admin-ui";

type Item = NavSection["items"][number];

export function AdminQuickNav({ sections }: { sections: NavSection[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const items: Item[] = sections.flatMap((section) => section.items);
  const filtered = items.filter((item) =>
    item.label.toLocaleLowerCase("tr-TR").includes(query.trim().toLocaleLowerCase("tr-TR"))
  ).slice(0, 8);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-controls="admin-quick-nav"
        aria-label="Yönetim sayfalarında ara"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden md:inline">Sayfa ara</span>
        <kbd className="hidden rounded border px-1.5 py-0.5 text-xs lg:inline">⌘K</kbd>
      </button>
      {open && (
        <>
          <button type="button" tabIndex={-1} aria-label="Aramayı kapat"
            className="fixed inset-0 z-40 cursor-default bg-black/10" onClick={() => setOpen(false)} />
          <div id="admin-quick-nav" className="fixed inset-x-3 top-20 z-50 mx-auto max-w-md rounded-xl border bg-background p-3 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[22rem]"
            role="search" aria-label="Yönetim sayfaları">
            <div className="flex items-center gap-2">
              <Search className="size-4 text-muted-foreground" aria-hidden="true" />
              <input ref={inputRef} type="search" value={query} placeholder="Modül veya sayfa adı..."
                aria-label="Modül veya sayfa ara"
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
              <button type="button" aria-label="Kapat" className="grid size-11 place-items-center rounded-md hover:bg-muted" onClick={() => setOpen(false)}>
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto border-t pt-2">
              {filtered.length ? filtered.map((item) => (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {item.label}
                </Link>
              )) : <p className="px-3 py-4 text-sm text-muted-foreground">Sonuç bulunamadı.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
