/**
 * Resolves the visitor's language.
 *   ?lang → localStorage → navigator.language → 'en'
 *
 * The old version hardcoded ['en','tr','es'], which silently hid German
 * even though the backend serves it. Validation now happens against the
 * list the API reports (see LocaleProvider); this module only resolves a
 * preference and remembers it.
 */
const STORAGE_KEY = "cleopatra_locale";
const SHAPE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

export function resolveLocale(): string {
  if (typeof window === "undefined") return "en";

  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (fromUrl && SHAPE.test(fromUrl)) {
    const short = fromUrl.slice(0, 2).toLowerCase();
    persistLocale(short);
    return short;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SHAPE.test(stored)) return stored.slice(0, 2).toLowerCase();
  } catch {
    /* private mode — fall through to the browser language */
  }

  const browser = navigator.language?.slice(0, 2).toLowerCase();
  return browser && SHAPE.test(browser) ? browser : "en";
}

export function persistLocale(locale: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage unavailable — the ?lang param still works for this visit */
  }
}
