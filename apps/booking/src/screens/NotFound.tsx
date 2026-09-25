import { Link } from "react-router-dom";
import { SiteShell } from "../shell/SiteShell";
import { useLocaleCtx } from "../lib/locale";

export default function NotFound() {
  const { locale, setLocale, available } = useLocaleCtx();
  return (
    <SiteShell locale={locale} availableLocales={available} onLocaleChange={setLocale} vignette>
      <main className="relative z-10 flex flex-grow flex-col items-center justify-center px-6 text-center">
        <p className="serif-font text-7xl font-bold text-[#FFBE4E]">404</p>
        <h1 className="mt-4 text-lg font-light tracking-wide text-zinc-300">
          This page does not exist.
        </h1>
        <Link
          to="/"
          className="mt-10 rounded-full bg-[#FFBE4E] px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black transition-transform hover:scale-[1.03]"
        >
          Choose a studio
        </Link>
      </main>
    </SiteShell>
  );
}
