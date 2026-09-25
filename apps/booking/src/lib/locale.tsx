import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveLocale, persistLocale } from "../hooks/useLocale";
import { api } from "./env";

interface LocaleCtx {
  locale: string;
  setLocale: (l: string) => void;
  /** Locales the backend actually serves. Reported by /api/booking/config. */
  available: string[];
  setAvailable: (l: string[]) => void;
}

const Ctx = createContext<LocaleCtx | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<string>(() => resolveLocale());
  const [available, setAvailable] = useState<string[]>(["en"]);

  // Every screen needs the language list, not just the wizard — the studio
  // picker used to render without a switcher at all.
  useEffect(() => {
    let alive = true;
    fetch(api("/api/booking/locales"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { locales: { code: string }[] } | null) => {
        if (!alive || !d?.locales?.length) return;
        const codes = d.locales.map((l) => l.code);
        setAvailable(codes);
        // A stored preference for a language we no longer serve would
        // otherwise leave the switcher showing a flag nothing matches.
        setLocaleState((current) => (codes.includes(current) ? current : codes[0]));
      })
      .catch(() => { /* offline — the English default still renders */ });
    return () => { alive = false; };
  }, []);

  const setLocale = useCallback((l: string) => {
    persistLocale(l);
    setLocaleState(l);
    document.documentElement.lang = l;
  }, []);

  const value = useMemo(
    () => ({ locale, setLocale, available, setAvailable }),
    [locale, setLocale, available],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocaleCtx(): LocaleCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLocaleCtx must be used inside <LocaleProvider>");
  return v;
}
