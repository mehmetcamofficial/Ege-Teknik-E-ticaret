import * as React from "react"

/**
 * Radix only returns focus to the element that opened a dialog when a <Trigger> is mounted. The admin
 * dialogs are controlled and opened from row buttons, so on close focus fell back to <body>. This
 * remembers the focused element as the dialog opens and restores it on close; focus trapping and ARIA
 * stay Radix's. A caller's own handlers still run first and can veto with preventDefault().
 */
export function useRestoreFocus(onOpenAutoFocus?: (event: Event) => void, onCloseAutoFocus?: (event: Event) => void) {
  const opener = React.useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus: (event: Event) => {
      const active = document.activeElement
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event)
      const el = opener.current
      opener.current = null
      if (!event.defaultPrevented && el?.isConnected) {
        event.preventDefault()
        el.focus()
      }
    },
  }
}
