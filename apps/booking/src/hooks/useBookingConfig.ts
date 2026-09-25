import { useEffect, useState } from "react";
import { api } from "../lib/env";

export interface StepOption {
  key: string;
  label: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  /** Steps this choice makes irrelevant (piercing → no story/placement/size). */
  skips_steps?: string[];
}

export interface BookingLocation {
  id: number;
  slug: string;
  name: string;
  /** branch only, without the brand prefix — for ":location" placeholders */
  shortName: string;
  address: string | null;
  timezone: string;
  countryCode: string;
  bookingActive: boolean;
  mapLink: string | null;
  gtmCountry: string | null;
  gtmCity: string | null;
  /** booking-window rules — were hardcoded in the client before */
  maxBookingDaysAhead: number;
  sameDayLeadHours: number;
}

export interface BookingConfig {
  location: BookingLocation;
  /** the locale actually served */
  locale: string;
  /** true when the requested locale was not available and `locale` is a fallback */
  fallbackUsed: boolean;
  /** every locale the backend can serve — drives the language switcher */
  supportedLocales: string[];
  translations: Record<string, Record<string, string>>;
  steps: Record<string, StepOption[]>;
  /** ad traffic → ask for name/email/phone first (was injected by Blade) */
  contactStepOverride: { triggerParams: string[]; targetStepIndex: number };
  vipPickupEnabled: boolean;
  turnstileSiteKey: string | null;
}

export function useBookingConfig(slug: string, locale: string) {
  const [config, setConfig] = useState<BookingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) { setLoading(false); return; }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(api(`/api/booking/config/${slug}?lang=${locale}`), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<BookingConfig>;
      })
      .then(setConfig)
      .catch((err: Error) => { if (err.name !== "AbortError") setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });

    return () => controller.abort();
  }, [slug, locale]);

  return { config, loading, error };
}

/** Dictionary lookup with a hardcoded English fallback for first paint. */
export function t(
  translations: Record<string, Record<string, string>> | undefined,
  namespace: string,
  key: string,
  fallback = "",
): string {
  return translations?.[namespace]?.[key] ?? fallback;
}
