/* The burger menu lived in the Laravel layout as raw HTML + a jQuery-less
 * DOM script, so it simply did not exist when the SPA ran on its own.
 * Now it is a component: same visual language, keyboard-closable, and it
 * traps nothing it should not. */
import { useEffect, useRef } from "react";
import { ENV } from "../lib/env";

const NAV = [
  { key: "home", label: "Home", path: "" },
  { key: "studios", label: "Studios", path: "/studios" },
  { key: "countries", label: "Country Pages", path: "/countries" },
  { key: "academies", label: "Academies", path: "/academies" },
  { key: "services", label: "Products & Services", path: "/tattoo-and-piercing-services" },
  { key: "gallery", label: "Gallery", path: "/tattoo-and-piercing-gallery" },
  { key: "deals", label: "Campaigns", path: "/deals" },
  { key: "reservation", label: "Reservation", path: "/reservation" },
  { key: "franchise", label: "Franchise", path: "/franchise" },
  { key: "about", label: "About Us", path: "/about-us" },
];

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

  const href = (path: string) => `${ENV.marketingBase}/${locale}${path}`;

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
        className="fixed top-5 right-5 z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/40 bg-white/10 text-white transition hover:border-[#FFBE4E] hover:text-[#FFBE4E]"
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
          {NAV.map((item, i) => (
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
      className={`fixed top-5 right-5 z-[99999] flex h-12 w-12 flex-col items-center justify-center gap-[5px] rounded-full border-2 border-white/30 backdrop-blur-md transition-all hover:border-white/60 hover:bg-white/5 ${
        hidden ? "pointer-events-none invisible opacity-0" : ""
      }`}
    >
      <span className="block h-0.5 w-[22px] rounded bg-white" />
      <span className="block h-0.5 w-[22px] rounded bg-white" />
    </button>
  );
}
