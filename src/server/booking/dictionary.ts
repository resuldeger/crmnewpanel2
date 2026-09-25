/* ── Translations & step options, resolved per studio and locale ────────
 * Four layers, highest wins:
 *   1. global   + fallback locale (en)
 *   2. global   + requested locale
 *   3. studio   + fallback locale
 *   4. studio   + requested locale
 * ────────────────────────────────────────────────────────────────── */
import { and, eq, inArray, isNull, or, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { translations, bookingStepOptions, locales } from "@/db/schema";
import { cached, key, TTL, redis } from "@/server/redis";

export interface ResolvedDictionary {
  /** namespace → key → value */
  messages: Record<string, Record<string, string>>;
  /** the locale actually served */
  locale: string;
  fallbackUsed: boolean;
}

export async function activeLocales(): Promise<{ code: string; isDefault: boolean }[]> {
  return cached("i18n:locales", TTL.dictionary, async () =>
    db
      .select({ code: locales.code, isDefault: locales.isDefault })
      .from(locales)
      .where(eq(locales.isActive, true))
      .orderBy(asc(locales.sortOrder)),
  );
}

export async function resolveDictionary(
  app: "booking" | "console",
  requested: string,
  locationId: number | null,
): Promise<ResolvedDictionary> {
  const active = await activeLocales();
  const codes = active.map((l) => l.code);
  const fallback = active.find((l) => l.isDefault)?.code ?? "en";

  // Asking for a language nobody translated used to return HTTP 200 with
  // English inside and no way for the client to know. Say so instead.
  const locale = codes.includes(requested) ? requested : fallback;
  const fallbackUsed = locale !== requested;

  const messages = await cached(
    key.dictionary(app, locale, locationId),
    TTL.dictionary,
    async () => {
      const rows = await db
        .select({
          namespace: translations.namespace,
          key: translations.key,
          value: translations.value,
          locale: translations.locale,
          locationId: translations.locationId,
        })
        .from(translations)
        .where(
          and(
            eq(translations.app, app),
            inArray(translations.locale, locale === fallback ? [fallback] : [fallback, locale]),
            locationId === null
              ? isNull(translations.locationId)
              : or(isNull(translations.locationId), eq(translations.locationId, locationId)),
          ),
        );

      // Sort so that the winning layer is written last.
      const rank = (r: (typeof rows)[number]) =>
        (r.locationId !== null ? 2 : 0) + (r.locale === locale ? 1 : 0);
      rows.sort((a, b) => rank(a) - rank(b));

      const out: Record<string, Record<string, string>> = {};
      for (const r of rows) {
        (out[r.namespace] ??= {})[r.key] = r.value;
      }
      return out;
    },
  );

  return { messages, locale, fallbackUsed };
}

export interface ResolvedStepOption {
  key: string;
  label: string;
  description: string | null;
  image_url: string | null;
  sort_order: number;
  skips_steps: string[];
}

export async function resolveStepOptions(
  locationId: number,
  locale: string,
  fallback = "en",
): Promise<Record<string, ResolvedStepOption[]>> {
  return cached(`steps:${locationId}:${locale}`, TTL.config, async () => {
    const rows = await db
      .select()
      .from(bookingStepOptions)
      .where(
        or(isNull(bookingStepOptions.locationId), eq(bookingStepOptions.locationId, locationId)),
      )
      .orderBy(asc(bookingStepOptions.sortOrder));

    // A studio row overrides the global row with the same (step, option).
    const winner = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const id = `${row.stepKey}|${row.optionKey}`;
      const current = winner.get(id);
      if (!current || (row.locationId !== null && current.locationId === null)) winner.set(id, row);
    }

    const out: Record<string, ResolvedStepOption[]> = {};
    for (const row of winner.values()) {
      // is_active=false on a studio row hides a globally active option.
      if (!row.isActive) continue;
      (out[row.stepKey] ??= []).push({
        key: row.optionKey,
        label: row.labelTranslations[locale] ?? row.labelTranslations[fallback] ?? row.optionKey,
        description: row.descriptionTranslations[locale] ?? row.descriptionTranslations[fallback] ?? null,
        image_url: row.imageUrl,
        sort_order: row.sortOrder,
        skips_steps: row.skipsSteps,
      });
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.sort_order - b.sort_order);
    return out;
  });
}

/** Called after an admin edits a translation or a step option. */
export async function bustDictionary(): Promise<void> {
  const { bust } = await import("@/server/redis");
  await Promise.all([bust("i18n:"), bust("steps:"), bust("cfg:booking:")]);
  void redis;
}
