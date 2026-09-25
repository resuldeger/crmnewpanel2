"use client";

import { useMemo, useState } from "react";
import { LOCALE_COOKIE } from "./locale-cookie";

export interface PublicStudio {
  id: number;
  slug: string;
  name: string;
  address: string | null;
  city: string;
  state: string | null;
  timezone: string;
}

type Dict = Record<string, Record<string, string>>;

const FLAG: Record<string, string> = { en: "🇬🇧", tr: "🇹🇷", es: "🇪🇸", de: "🇩🇪" };
const LANG_NAME: Record<string, string> = { en: "English", tr: "Türkçe", es: "Español", de: "Deutsch" };

/** Copy that has no dictionary entry yet, per language. */
const LOCAL: Record<string, Record<string, string>> = {
  en: { select: "Select A Studio", search: "Search by city or studio…", none: "No studio matches", book: "Book Appointment", pending: "Address pending" },
  tr: { select: "Stüdyo Seçin", search: "Şehir veya stüdyo ara…", none: "Eşleşen stüdyo yok", book: "Randevu Al", pending: "Adres bekleniyor" },
  es: { select: "Elige un Estudio", search: "Busca por ciudad o estudio…", none: "Ningún estudio coincide", book: "Reservar Cita", pending: "Dirección pendiente" },
  de: { select: "Studio Auswählen", search: "Nach Stadt oder Studio suchen…", none: "Kein Studio gefunden", book: "Termin Buchen", pending: "Adresse folgt" },
};

export function StudioPicker({
  studios, locale, availableLocales, messages,
}: {
  studios: PublicStudio[];
  locale: string;
  availableLocales: string[];
  messages: Dict;
}) {
  const [query, setQuery] = useState("");

  const t = (namespace: string, key: string, fallbackKey?: string) =>
    messages[namespace]?.[key] ??
    (fallbackKey ? (LOCAL[locale] ?? LOCAL.en)[fallbackKey] ?? LOCAL.en[fallbackKey] : "");

  const local = (key: string) => (LOCAL[locale] ?? LOCAL.en)[key] ?? LOCAL.en[key];

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return studios;
    return studios.filter((s) =>
      [s.name, s.city, s.state, s.address].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [studios, query]);

  function switchLocale(next: string) {
    // A year is fine: the visitor can always change it again, and the
    // choice should survive between visits.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.location.assign(url.toString());
  }

  return (
    <div className="cleo-public">
      <div className="glow" aria-hidden="true" />

      {availableLocales.length > 1 && (
        <div className="fixed right-5 top-5 z-50 flex gap-2">
          {availableLocales.map((code) => (
            <button
              key={code}
              onClick={() => switchLocale(code)}
              aria-label={LANG_NAME[code] ?? code}
              aria-current={code === locale}
              lang={code}
              className={`flex h-11 w-11 items-center justify-center rounded-full border-2 text-lg backdrop-blur-xl transition-colors ${
                code === locale
                  ? "border-[#ffbe4e] bg-[#ffbe4e]/10"
                  : "border-zinc-800 bg-zinc-900/50 hover:border-[#ffbe4e]/60"
              }`}
            >
              {FLAG[code] ?? "🌐"}
            </button>
          ))}
        </div>
      )}

      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-20 pt-20 md:pt-24">
        <header className="mb-10 text-center">
          <h1 className="serif text-4xl font-bold tracking-tight md:text-6xl">
            {local("select")}
          </h1>
          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.35em] text-[#ffbe4e]">
            {t("welcome", "subtitle") || "The World’s Largest Tattoo Company"}
          </p>
        </header>

        <div className="mx-auto mb-10 max-w-md">
          <label htmlFor="studio-search" className="sr-only">{local("search")}</label>
          <input
            id="studio-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={local("search")}
            className="h-14 w-full rounded-full border-2 border-zinc-800 bg-zinc-900/40 px-6 text-sm text-white outline-none backdrop-blur-xl transition-colors placeholder:text-zinc-600 focus:border-[#ffbe4e]"
          />
        </div>

        {results.length === 0 ? (
          <p className="py-16 text-center text-sm text-zinc-500">
            {local("none")} — “{query}”
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((studio) => (
              <li key={studio.id}>
                <a
                  href={`/${studio.slug}/book?lang=${locale}`}
                  className="group flex h-full flex-col justify-between rounded-2xl border border-zinc-900 bg-zinc-900/30 p-6 backdrop-blur-md transition-all hover:border-[#ffbe4e]/60 hover:bg-zinc-900/60"
                >
                  <div>
                    <h2 className="serif text-2xl font-bold transition-colors group-hover:text-[#ffbe4e]">
                      {studio.name.replace(/^Cleopatra Ink\s+/i, "")}
                    </h2>
                    <p className="mt-2 min-h-[2.5rem] text-xs leading-relaxed text-zinc-500">
                      {studio.address ?? local("pending")}
                    </p>
                  </div>
                  <span className="mt-5 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#ffbe4e]">
                    {local("book")}
                    <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
