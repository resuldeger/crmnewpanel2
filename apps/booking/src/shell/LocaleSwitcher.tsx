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
    <div ref={ref} className="fixed top-5 right-[76px] z-[99999]">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Language: ${NAME[current] ?? current}`}
        aria-expanded={open}
        className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-zinc-800 bg-zinc-900/40 shadow-2xl backdrop-blur-xl transition-all hover:border-[#FFBE4E]"
      >
        <span className="text-xl">{FLAG[current] ?? "🌐"}</span>
      </button>

      <div
        className={`absolute right-0 top-full mt-3 flex flex-col items-end gap-2 transition-all duration-300 ${
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0"
        }`}
      >
        {available.filter((l) => l !== current).map((locale) => (
          <button
            key={locale}
            onClick={() => { onChange(locale); setOpen(false); }}
            className="group flex h-11 items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/90 px-3 backdrop-blur-md transition-all hover:border-[#FFBE4E] hover:bg-[#FFBE4E]"
            lang={locale}
          >
            <span className="whitespace-nowrap text-[10px] font-black uppercase tracking-widest text-zinc-400 group-hover:text-black">
              {NAME[locale] ?? locale.toUpperCase()}
            </span>
            <span className="text-lg">{FLAG[locale] ?? "🌐"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
