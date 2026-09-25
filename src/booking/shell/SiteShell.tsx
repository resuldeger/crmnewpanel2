"use client";

/* Page chrome shared by every screen: ambient backdrop, burger menu,
 * language switcher. Screens render their own content inside. */
import { useState, type ReactNode } from "react";
import { SiteMenu, MenuButton } from "./SiteMenu";
import { LocaleSwitcher } from "./LocaleSwitcher";

export function SiteShell({
  children,
  locale,
  availableLocales,
  onLocaleChange,
  vignette = false,
  chrome = true,
}: {
  children: ReactNode;
  locale: string;
  availableLocales: string[];
  onLocaleChange: (locale: string) => void;
  /** darker edges — used on the welcome and success screens */
  vignette?: boolean;
  /** hide the menu + language controls (e.g. on the success screen) */
  chrome?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="cleo-public relative flex min-h-screen flex-col overflow-x-hidden selection:bg-[#FFBE4E]/30">
      <div className="glow" aria-hidden="true">
        {vignette && (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_0%,_black_70%)] opacity-60" />
        )}
      </div>

      {chrome && (
        <>
          <LocaleSwitcher
            current={locale}
            available={availableLocales}
            onChange={onLocaleChange}
            hidden={menuOpen}
          />
          <MenuButton onClick={() => setMenuOpen(true)} hidden={menuOpen} />
          <SiteMenu open={menuOpen} onClose={() => setMenuOpen(false)} locale={locale} />
        </>
      )}

      {children}
    </div>
  );
}
