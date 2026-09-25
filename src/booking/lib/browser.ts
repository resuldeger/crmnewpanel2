/* ── SSR guards ────────────────────────────────────────────────────────
 * The booking engine grew up under Vite, where there was no server render
 * and `window` always existed. Next pre-renders these components on the
 * server, so anything read during render must tolerate its absence.
 * Effects are safe — they only run in the browser.
 * ────────────────────────────────────────────────────────────────── */
export const isBrowser = typeof window !== "undefined";

/** Query string of the current URL, empty on the server. */
export function searchParams(): URLSearchParams {
  return new URLSearchParams(isBrowser ? window.location.search : "");
}

export function currentHref(): string | null {
  return isBrowser ? window.location.href : null;
}

/** True unless the browser reports automation. Assumes trusted on the server. */
export function looksAutomated(): boolean {
  return isBrowser && navigator.webdriver === true;
}

export function readStorage(key: string): string | null {
  if (!isBrowser) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode / storage blocked
  }
}

export function writeStorage(key: string, value: string): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* nothing to do — the choice just will not persist */
  }
}

export function clearStorage(key: string): void {
  if (!isBrowser) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to do — the key was never written either */
  }
}
