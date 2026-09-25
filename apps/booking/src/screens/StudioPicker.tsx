/* The studio list used to be a Laravel Blade page, so it had a different
 * header, different fonts and no language switcher — visitors crossed a
 * visual seam on their way into the wizard. It is a screen now. */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SiteShell } from "../shell/SiteShell";
import { useLocaleCtx } from "../lib/locale";
import { useStudios } from "../lib/useStudios";
import { ENV } from "../lib/env";

export default function StudioPicker() {
  const { locale, setLocale, available } = useLocaleCtx();
  const { studios, error, loading } = useStudios();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const list = (studios ?? []).filter((s) => s.bookingActive);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) =>
      [s.name, s.city, s.state, s.address].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [studios, query]);

  return (
    <SiteShell locale={locale} availableLocales={available} onLocaleChange={setLocale} vignette>
      <main className="relative z-10 mx-auto w-full max-w-6xl flex-grow px-4 pb-16 pt-24 md:pt-28">
        <header className="mb-10 text-center">
          <img
            src={`${ENV.marketingBase}/img/cleopatra-logo.svg`}
            alt="Cleopatra Ink"
            className="mx-auto mb-6 h-20 w-auto drop-shadow-[0_0_20px_rgba(255,190,78,0.25)] md:h-28"
          />
          <h1 className="serif-font text-4xl font-bold tracking-tight text-white md:text-6xl">
            Select A Studio
          </h1>
          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.35em] text-[#FFBE4E]">
            The World’s Largest Tattoo Company
          </p>
        </header>

        <div className="mx-auto mb-10 max-w-md">
          <label htmlFor="studio-search" className="sr-only">Search studios</label>
          <input
            id="studio-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by city or studio…"
            className="h-14 w-full rounded-full border-2 border-zinc-800 bg-zinc-900/40 px-6 text-sm text-white placeholder:text-zinc-600 backdrop-blur-xl transition-colors focus:border-[#FFBE4E] focus:outline-none"
          />
        </div>

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl border border-zinc-900 bg-zinc-900/30" />
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-300">
            Studios could not be loaded. Please refresh the page.
          </p>
        )}

        {!loading && !error && results.length === 0 && (
          <p className="py-16 text-center text-sm text-zinc-500">
            No studio matches “{query}”.
          </p>
        )}

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((studio) => (
            <li key={studio.id}>
              <Link
                to={`/${studio.slug}/book`}
                className="group flex h-full flex-col justify-between rounded-2xl border border-zinc-900 bg-zinc-900/30 p-6 backdrop-blur-md transition-all hover:border-[#FFBE4E]/60 hover:bg-zinc-900/60 focus-visible:border-[#FFBE4E]"
              >
                <div>
                  <h2 className="serif-font text-2xl font-bold text-white transition-colors group-hover:text-[#FFBE4E]">
                    {studio.name.replace(/^Cleopatra Ink\s+/, "")}
                  </h2>
                  <p className="mt-2 min-h-[2.5rem] text-xs leading-relaxed text-zinc-500">
                    {studio.address ?? "Address pending"}
                  </p>
                </div>
                <span className="mt-5 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFBE4E]">
                  Book Appointment
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </SiteShell>
  );
}
