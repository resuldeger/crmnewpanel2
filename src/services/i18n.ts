/**
 * ─── Cleopatra CRM · Localization Service ────────────────────────────────────
 * Translations are NOT managed as static JSON files in the repo. The dictionary
 * is pulled from the translation service (JSON over HTTP), cached locally and
 * hot-swapped at runtime. The embedded snapshot below the network layer is only
 * an offline fallback so the console never renders untranslated keys.
 *
 *   GET {SERVICE_URL}/{lang}.json?app=crm-console&v={VERSION}
 *   → { "messages": { "Save All Changes": "Tüm Değişiklikleri Kaydet", … } }
 *
 * English is the source language: t("Any English string") is identity in EN and
 * a dictionary lookup in every other locale. Interpolation via tf("{n} leads", {n: 4}).
 */
import { useSyncExternalStore } from "react";
import { TR_SNAPSHOT } from "./i18nDict";

export type Lang = "en" | "tr";
export type I18nSource = "remote" | "cache" | "snapshot";
export interface I18nMeta {
  loading: boolean;
  source: I18nSource;
  lastSyncAt: number | null;
  entries: number;
}

const SERVICE_URL = "https://i18n.cleopatra.ink/api/v1/locales";
const APP_ID = "crm-console";
const VERSION = "4.3.0";
const LS_LANG = "cleo.lang.v1";
const LS_CACHE = "cleo.i18n.cache.v1";
const FETCH_TIMEOUT = 2200;

interface State { lang: Lang; dict: Record<string, string>; meta: I18nMeta; }

const readLang = (): Lang => {
  try {
    const v = localStorage.getItem(LS_LANG);
    return v === "tr" || v === "en" ? v : "en";
  } catch { return "en"; }
};

let state: State = {
  lang: readLang(),
  dict: TR_SNAPSHOT,
  meta: { loading: false, source: "snapshot", lastSyncAt: null, entries: Object.keys(TR_SNAPSHOT).length },
};

const listeners = new Set<() => void>();
const emit = () => {
  try { document.documentElement.lang = state.lang; } catch { /* ssr-safe */ }
  listeners.forEach(fn => fn());
};
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const getState = () => state;

/** Translate. Keys are the English source strings; unknown keys pass through. */
export function t(key: string): string {
  if (state.lang === "en") return key;
  return state.dict[key] ?? key;
}

/** Translate with {placeholder} interpolation. */
export function tf(key: string, vars: Record<string, string | number>): string {
  let out = t(key);
  for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}

export async function loadLang(lang: Lang): Promise<void> {
  state = { ...state, lang, meta: { ...state.meta, loading: true } };
  emit();
  try { localStorage.setItem(LS_LANG, lang); } catch { /* private mode */ }

  if (lang === "en") {
    // English is the source language — identity dictionary, nothing to fetch.
    state = { ...state, meta: { ...state.meta, loading: false } };
    emit();
    return;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    const res = await fetch(`${SERVICE_URL}/${lang}.json?app=${APP_ID}&v=${VERSION}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { messages?: Record<string, string> } & Record<string, unknown>;
    const messages = (json.messages ?? json) as Record<string, string>;
    state = {
      ...state, dict: messages,
      meta: { loading: false, source: "remote", lastSyncAt: Date.now(), entries: Object.keys(messages).length },
    };
    try { localStorage.setItem(LS_CACHE, JSON.stringify({ lang, messages, at: Date.now() })); } catch { /* quota */ }
  } catch {
    // Offline / service unreachable → cached dictionary first, embedded snapshot last.
    let dict = TR_SNAPSHOT;
    let source: I18nSource = "snapshot";
    let lastSyncAt: number | null = null;
    try {
      const raw = localStorage.getItem(LS_CACHE);
      if (raw) {
        const cached = JSON.parse(raw) as { lang: Lang; messages: Record<string, string>; at: number };
        if (cached.lang === lang && cached.messages && Object.keys(cached.messages).length) {
          dict = cached.messages; source = "cache"; lastSyncAt = cached.at;
        }
      }
    } catch { /* corrupt cache */ }
    state = { ...state, dict, meta: { loading: false, source, lastSyncAt, entries: Object.keys(dict).length } };
  }
  emit();
}

export function setLang(lang: Lang) { void loadLang(lang); }

/** React binding — components read { lang, setLang, meta, t, tf }. */
export function useI18n() {
  const s = useSyncExternalStore(subscribe, getState);
  return { lang: s.lang, setLang, meta: s.meta, t, tf };
}

// Boot: apply persisted language and pull the latest dictionary once.
try { document.documentElement.lang = state.lang; } catch { /* noop */ }
if (state.lang !== "en") void loadLang(state.lang);
