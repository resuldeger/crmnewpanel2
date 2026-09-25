"use client";

/* ── Confirmation sheet ────────────────────────────────────────────────
 * Cancelling used to go through window.confirm(). That dialog cannot be
 * styled, renders in the browser's own language rather than the visitor's,
 * and on a phone it is a cramped system alert dropped on top of the dark
 * page. This is the same decision as a bottom sheet on mobile and a centred
 * card on desktop.
 * ────────────────────────────────────────────────────────────────── */
import { useEffect, useRef } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Destructive actions get the red treatment. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, body, confirmLabel, cancelLabel,
  danger = false, busy = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
      if (e.key !== "Tab" || !panel.current) return;
      // Keep focus inside; otherwise the page behind is still tabbable and
      // a keyboard user can "press" a button they cannot see.
      const focusable = panel.current.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener("keydown", onKey);
    // The sheet scrolls, the page behind it must not.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Land on the safe choice, not the destructive one.
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? "confirm-body" : undefined}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border border-zinc-800 bg-[#0b0b0b] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:rounded-3xl sm:pb-6"
      >
        {/* Grab handle — reads as a sheet on a phone. */}
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-zinc-800 sm:hidden" />

        <h2 id="confirm-title" className="serif-font text-center text-2xl font-bold text-white">
          {title}
        </h2>
        {body && (
          <p id="confirm-body" className="mt-3 text-center text-sm leading-relaxed text-zinc-400">
            {body}
          </p>
        )}

        <div className="mt-7 space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`h-14 w-full rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
              danger
                ? "bg-red-500/90 text-white hover:bg-red-500"
                : "bg-[#FFBE4E] text-black enabled:hover:scale-[1.02]"
            }`}
          >
            {busy ? "…" : confirmLabel}
          </button>

          <button
            type="button"
            data-autofocus
            disabled={busy}
            onClick={onCancel}
            className="h-14 w-full rounded-full border-2 border-zinc-800 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:opacity-60"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
