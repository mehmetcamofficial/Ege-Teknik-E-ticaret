"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import { recordActionLabel, type RecordActionKey } from "@/lib/admin-ui";

/**
 * The one place admin record actions are rendered. Screens describe WHICH actions a record has (see
 * recordActionsFor in lib/admin-ui.ts) and this component owns the shared Turkish labels, the destructive
 * styling, the record-specific confirmation and the wrapping mobile layout - so no screen reinvents them.
 * It performs no I/O: callers pass already-bound handlers.
 */
export type RecordAction = {
  key: RecordActionKey;
  /** Navigates instead of mutating; rendered as a link, never confirmed. */
  href?: string;
  onClick?: () => void;
  /** Record-specific confirmation shown before onClick runs. */
  confirm?: { title: string; description: ReactNode; confirmLabel: string; cancelLabel?: string };
  /** Renders the action disabled and explains why, rather than hiding it silently. */
  unavailableReason?: string;
};

const isDestructive = (key: RecordActionKey) => key === "archive" || key === "delete";

export function RecordActions({ actions, align = "end", label }: { actions: RecordAction[]; align?: "start" | "end"; label: string }) {
  const [pending, setPending] = useState<RecordAction | null>(null);
  const [busy, setBusy] = useState(false);
  if (!actions.length) return null;

  // The caller owns the async work (and its error handling); the dialog only gates the first click.
  function run(action: RecordAction) {
    if (action.confirm) return setPending(action);
    action.onClick?.();
  }
  function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      pending.onClick?.();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${align === "end" ? "justify-end" : "justify-start"}`} role="group" aria-label={label}>
      {actions.map((action) => {
        const text = recordActionLabel[action.key];
        const destructive = isDestructive(action.key) ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : undefined;
        if (action.unavailableReason) {
          // Still rendered (never silently missing) so the reason is discoverable, but not operable.
          return (
            <Button key={action.key} type="button" variant="outline" size="sm" disabled
              title={action.unavailableReason} className={destructive}>
              {text}
              <span className="sr-only"> — {action.unavailableReason}</span>
            </Button>
          );
        }
        if (action.href) {
          return (
            <Button key={action.key} asChild variant="outline" size="sm" className={destructive}>
              <Link href={action.href}>{text}</Link>
            </Button>
          );
        }
        return (
          <Button key={action.key} type="button" variant="outline" size="sm" className={destructive} onClick={() => run(action)}>
            {text}
          </Button>
        );
      })}

      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.confirm?.title ?? ""}
        description={pending?.confirm?.description ?? ""}
        confirmLabel={pending?.confirm?.confirmLabel ?? "Onayla"}
        cancelLabel={pending?.confirm?.cancelLabel ?? "Vazgeç"}
        variant={pending && isDestructive(pending.key) ? "destructive" : "default"}
        loading={busy}
        onConfirm={confirm}
      />
    </div>
  );
}