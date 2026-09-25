/**
 * Resolves the visitor's language.
 *   ?lang → localStorage → navigator.language → 'en'
 *
 * The old version hardcoded ['en','tr','es'], which silently hid German
 * even though the backend serves it. Validation now happens against the
 * list the API reports (see LocaleProvider); this module only resolves a
 * preference and remembers it.
 */
import { isBrowser, searchParams, readStorage, writeStorage } from "../lib/browser";

const STORAGE_KEY = "cleopatra_locale";
const SHAPE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

export function resolveLocale(): string {
  if (!isBrowser) return "en";

  const fromUrl = searchParams().get("lang");
  if (fromUrl && SHAPE.test(fromUrl)) {
    const short = fromUrl.slice(0, 2).toLowerCase();
    persistLocale(short);
    return short;
  }

  const stored = readStorage(STORAGE_KEY);
  if (stored && SHAPE.test(stored)) return stored.slice(0, 2).toLowerCase();

  const browser = navigator.language?.slice(0, 2).toLowerCase();
  return browser && SHAPE.test(browser) ? browser : "en";
}

export function persistLocale(locale: string): void {
  writeStorage(STORAGE_KEY, locale);
  // localStorage is invisible to the server. Pages are rendered there, so
  // the choice has to travel in a cookie or every navigation reverts to
  // the browser's default language.
  if (isBrowser) {
    document.cookie = `${STORAGE_KEY}=${locale}; path=/; max-age=31536000; samesite=lax`;
  }
}
