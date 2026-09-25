"use client";

/* The old switcher hardcoded en / tr / es. The backend serves German too,
 * so a German visitor had no way to reach their own language. The list now
 * comes from the API (`supported_locales`) and falls back to whatever the
 * config reported. */
import { useEffect, useRef, useState } from "react";

const FLAG: Record<string, string> = {
  en: "🇬🇧", tr: "🇹🇷", es: "🇪🇸", de: "🇩🇪",
  fr: "🇫🇷", it: "🇮🇹", nl: "🇳🇱", pt: "🇵🇹", ru: "🇷🇺", ar: "🇸🇦", pl: "🇵🇱",
};

const NAME: Record<string, string> = {
  en: "English", tr: "Türkçe", es: "Español", de: "Deutsch",
};

export function LocaleSwitcher({
  current, available, onChange, hidden = false,
}: {
  current: string;
  available: string[];
  onChange: (locale: string) => void;
  hidden?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Nothing to switch between — don't show a control that does nothing.
  if (hidden || available.length < 2) return null;

  return (
    /* The trigger matches the menu button beside it — same 48×48 circle,
       12px apart, both 24px from the top. The open list is flag-only
       circles centred under the trigger. */
    <div ref={ref} className="fixed top-6 right-[84px] z-[99999]">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Language: ${NAME[current] ?? current}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-zinc-800 bg-zinc-900/40 shadow-2xl backdrop-blur-xl transition-all hover:border-[#FFBE4E]"
      >
        <span className="text-xl leading-none">{FLAG[current] ?? "🌐"}</span>
      </button>

      <div
        role="listbox"
        className={`absolute top-full right-0 mt-2 flex w-12 flex-col items-center gap-2 transition-all duration-300 ${
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0"
        }`}
      >
        {available.filter((l) => l !== current).map((locale) => (
          <button
            key={locale}
            role="option"
            aria-selected={false}
            onClick={() => { onChange(locale); setOpen(false); }}
            /* Flag alone is the visual, so the readable name goes to the
               accessible name instead of being dropped. */
            aria-label={NAME[locale] ?? locale.toUpperCase()}
            title={NAME[locale] ?? locale.toUpperCase()}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/90 backdrop-blur-md transition-all hover:border-[#FFBE4E] hover:bg-[#FFBE4E]"
            lang={locale}
          >
            <span className="text-lg leading-none">{FLAG[locale] ?? "🌐"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
