"use client";

/* The burger menu lived in the Laravel layout as raw HTML + a jQuery-less
 * DOM script, so it simply did not exist when the SPA ran on its own.
 * Now it is a component: same visual language, keyboard-closable, and it
 * traps nothing it should not. */
import { useEffect, useRef } from "react";
import { ENV } from "../lib/env";

/* The marketing site does not share a slug across languages — Turkish
 * "Academies" is /tr/akademiler, not /tr/academies — so a locale prefix on
 * the English path 404'd for every language but English. These are the
 * actual nav entries of www.cleopatraink.com, per language; `en` doubles as
 * the fallback for a locale the site does not publish. */
interface NavItem { key: string; label: string; path: string }

const NAV_BY_LOCALE: Record<string, NavItem[]> = {
  en: [
    { key: "studios", label: "Studios", path: "/studios" },
    { key: "countries", label: "Country Pages", path: "/countries" },
    { key: "academies", label: "Academies", path: "/academies" },
    { key: "services", label: "Products & Services", path: "/tattoo-and-piercing-services" },
    { key: "gallery", label: "Gallery", path: "/tattoo-and-piercing-gallery" },
    { key: "deals", label: "Deals", path: "/deals" },
    { key: "reservation", label: "Reservation", path: "/reservation" },
    { key: "franchise", label: "Franchise", path: "/franchise" },
    { key: "about", label: "About Us", path: "/about-us" },
  ],
  tr: [
    { key: "studios", label: "Stüdyolar", path: "/studyolar" },
    { key: "countries", label: "Ülke Sayfaları", path: "/ulkeler" },
    { key: "academies", label: "Akademiler", path: "/akademiler" },
    { key: "services", label: "Ürünler ve Servisler", path: "/dovme-ve-piercing-servisleri" },
    { key: "gallery", label: "Galeri", path: "/dovme-ve-piercing-galerisi" },
    { key: "deals", label: "Kampanyalar", path: "/kampanyalar" },
    { key: "reservation", label: "Rezervasyon", path: "/rezervasyon" },
    { key: "franchise", label: "Franchise", path: "/franchise" },
    { key: "about", label: "Hakkımızda", path: "/hakkimizda" },
  ],
  es: [
    { key: "studios", label: "Estudios", path: "/estudios" },
    { key: "countries", label: "Páginas de países", path: "/paises" },
    { key: "academies", label: "Academias", path: "/academies" },
    { key: "services", label: "Productos y Servicios", path: "/servicios-de-tatuajes-y-piercings" },
    { key: "gallery", label: "Galería", path: "/galeria_de_tatuajes_y_piercings" },
    { key: "deals", label: "Campañas", path: "/campanas" },
    { key: "reservation", label: "Reserva", path: "/reserva" },
    { key: "franchise", label: "Franquicia", path: "/franquicia-negocio" },
    { key: "about", label: "Sobre Nosotros", path: "/sobre-nosotros" },
  ],
  de: [
    { key: "studios", label: "Studios", path: "/studios" },
    { key: "countries", label: "Länderseiten", path: "/lander" },
    { key: "academies", label: "Akademien", path: "/academies" },
    { key: "services", label: "Produkte & Dienstleistungen", path: "/tattoo-und-piercing-services" },
    { key: "gallery", label: "Galerie", path: "/tattoo-und-piercing-galerie" },
    { key: "deals", label: "Kampagnen", path: "/kampagnen" },
    { key: "reservation", label: "Reservierung", path: "/reservierung" },
    { key: "franchise", label: "Franchise", path: "/franchise" },
    { key: "about", label: "Über Uns", path: "/uber-uns" },
  ],
};

export function SiteMenu({ open, onClose, locale }: { open: boolean; onClose: () => void; locale: string }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  // An unpublished language falls back to the English tree rather than
  // building a URL that does not exist.
  const nav = NAV_BY_LOCALE[locale] ?? NAV_BY_LOCALE.en;
  const lang = NAV_BY_LOCALE[locale] ? locale : "en";
  const href = (path: string) => `${ENV.marketingBase}/${lang}${path}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Site menu"
      aria-hidden={!open}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`fixed inset-0 z-[99998] flex transition-all duration-300 ${
        open ? "visible opacity-100" : "invisible opacity-0"
      }`}
      style={{ background: "rgba(5,5,5,0.92)", backdropFilter: "blur(18px)" }}
    >
      <button
        onClick={onClose}
        aria-label="Close menu"
        className="fixed top-6 right-6 z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/40 bg-white/10 text-white transition hover:border-[#FFBE4E] hover:text-[#FFBE4E]"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex h-full w-full flex-col outline-none md:flex-row"
      >
        {/* brand rail — hidden on phones, there is no room for it */}
        <div className="hidden w-[38%] items-end p-12 md:flex">
          <img
            src={`${ENV.marketingBase}/img/cleopatra-logo.svg`}
            alt="Cleopatra Ink"
            className="w-48 opacity-90"
            loading="lazy"
          />
        </div>
        <div className="hidden w-px bg-white/10 md:block" />

        <nav className="flex flex-1 flex-col justify-center gap-1 overflow-y-auto px-8 py-24 md:px-16">
          {nav.map((item, i) => (
            <a
              key={item.key}
              href={href(item.path)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ animationDelay: open ? `${i * 35}ms` : "0ms" }}
              className="animate-fade-in py-2 font-serif text-2xl font-bold tracking-tight text-zinc-300 transition-colors hover:text-[#FFBE4E] md:py-3 md:text-4xl"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function MenuButton({ onClick, hidden }: { onClick: () => void; hidden: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open menu"
      className={`fixed top-6 right-6 z-[99999] flex h-12 w-12 flex-col items-center justify-center gap-[5px] rounded-full border-2 border-white/30 backdrop-blur-md transition-all hover:border-white/60 hover:bg-white/5 ${
        hidden ? "pointer-events-none invisible opacity-0" : ""
      }`}
    >
      <span className="block h-0.5 w-[22px] rounded bg-white" />
      <span className="block h-0.5 w-[22px] rounded bg-white" />
    </button>
  );
}
