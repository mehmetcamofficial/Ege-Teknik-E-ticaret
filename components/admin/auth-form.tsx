"use client";

import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";

/**
 * Interactive pieces of the Admin V2 auth screens (login/forgot/reset). Purely presentational:
 * every field keeps the exact name/id/autoComplete/required/minLength/maxLength the existing auth
 * routes expect, and AuthForm is a REAL <form method="post" action="..."> doing a normal browser
 * submission - the pending state is cosmetic (shown via onSubmit, which fires before the browser's
 * own navigation, so it never delays or blocks the actual submit) and never intercepts or replaces
 * the request with an XHR/fetch call.
 */

const inputBase = "h-12 w-full rounded-xl border border-input bg-white/80 pl-11 text-base shadow-xs outline-none transition-[box-shadow,border-color,background-color] placeholder:text-muted-foreground/60 hover:border-primary/40 focus-visible:border-primary focus-visible:bg-white focus-visible:ring-4 focus-visible:ring-emerald-500/20 sm:text-sm";
const iconBase = "pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground";
const toggleBase = "absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function AuthField({ id, name, label, type = "text", autoComplete, required, maxLength, hint }: { id: string; name: string; label: string; type?: string; autoComplete?: string; required?: boolean; maxLength?: number; hint?: string }) {
  return (
    <div className="mt-6">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <div className="relative mt-1.5">
        <Mail aria-hidden="true" className={iconBase} />
        <input id={id} name={name} type={type} autoComplete={autoComplete} required={required} maxLength={maxLength} placeholder={hint} className={inputBase} />
      </div>
    </div>
  );
}

export function AuthPasswordField({ id, name, label, autoComplete, minLength, maxLength, describedBy }: { id: string; name: string; label: string; autoComplete: string; minLength: number; maxLength: number; describedBy?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="mt-6">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <div className="relative mt-1.5">
        <Lock aria-hidden="true" className={iconBase} />
        <input id={id} name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} required minLength={minLength} maxLength={maxLength} aria-describedby={describedBy} className={`${inputBase} pr-11`} />
        <button type="button" onClick={() => setVisible((v) => !v)} aria-pressed={visible} aria-label={visible ? "Parolayı gizle" : "Parolayı göster"} className={toggleBase}>
          {visible ? <EyeOff aria-hidden="true" className="size-[18px]" /> : <Eye aria-hidden="true" className="size-[18px]" />}
        </button>
      </div>
    </div>
  );
}

export function AuthForm({ action, submitLabel, pendingLabel, children }: { action: string; submitLabel: string; pendingLabel: string; children: ReactNode }) {
  const [pending, setPending] = useState(false);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (e.currentTarget.checkValidity()) setPending(true); // a blocked-by-the-browser invalid submit must not show a permanent spinner
  };
  return (
    <form method="post" action={action} onSubmit={onSubmit}>
      {children}
      <button type="submit" disabled={pending} aria-busy={pending} className="mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary bg-gradient-to-br from-[#0f7a5c] to-[#0b5a45] text-[0.95rem] font-semibold text-primary-foreground shadow-lg shadow-emerald-900/25 transition-all duration-200 hover:scale-[1.02] hover:shadow-xl hover:shadow-emerald-900/30 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-80">
        {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:hidden" />}
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}

export function AuthNotice({ tone, children }: { tone: "success" | "error"; children: ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  const cls = tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800";
  return (
    <p role={tone === "success" ? "status" : "alert"} className={`mt-5 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${cls}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-[18px] shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function AuthFooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="mt-7 text-center text-sm">
      <Link href={href} className="inline-flex min-h-11 items-center rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {children}
      </Link>
    </p>
  );
}
