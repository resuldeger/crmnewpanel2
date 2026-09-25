/**
 * Pulls the current production booking configuration (studios, translations,
 * step options) straight from booknow.cleopatraink.com and writes it to
 * seed/live-booking.json. Re-run it whenever the live content changes.
 *
 *   npx tsx scripts/fetch-live-seed.ts
 */
import "./env";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.LIVE_BASE ?? "https://booknow.cleopatraink.com";
const LOCALES = (process.env.LIVE_LOCALES ?? "en,tr,es,de").split(",");

interface LiveLocation { id: number; slug: string; name: string; address: string | null; timezone: string }
interface LiveOption { key: string; label: string; description: string | null; image_url: string | null; sort_order: number }
interface LiveConfig {
  location: LiveLocation;
  locale: string;
  translations: Record<string, Record<string, string>>;
  steps: Record<string, LiveOption[]>;
}

async function listSlugs(): Promise<string[]> {
  const html = await (await fetch(BASE)).text();
  const found = html.matchAll(/href="[^"]*?\/([a-z0-9-]+)\/book"/g);
  return [...new Set([...found].map((m) => m[1]))];
}

async function getConfig(slug: string, lang: string): Promise<LiveConfig> {
  const res = await fetch(`${BASE}/api/booking/config/${slug}?lang=${lang}`);
  if (!res.ok) throw new Error(`config ${slug}/${lang} → HTTP ${res.status}`);
  return res.json() as Promise<LiveConfig>;
}

/** Run promises with a small concurrency cap so we stay polite to production. */
async function pooled<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

async function main() {
  const slugs = await listSlugs();
  console.log(`→ ${slugs.length} studios found`);

  const locations = await pooled(slugs, 6, async (slug) => {
    const cfg = await getConfig(slug, "en");
    return { ...cfg.location, slug };
  });

  // Translations and step options are global, so one studio is enough.
  const reference = slugs.includes("tacoma") ? "tacoma" : slugs[0];
  const translations: { namespace: string; key: string; locale: string; value: string }[] = [];
  const optionMap = new Map<string, {
    stepKey: string; optionKey: string; imageUrl: string | null;
    sortOrder: number; labels: Record<string, string>;
  }>();
  const servedLocales: Record<string, string> = {};

  for (const locale of LOCALES) {
    const cfg = await getConfig(reference, locale);
    servedLocales[locale] = cfg.locale;
    if (cfg.locale !== locale) {
      console.warn(`  ! ${locale} is not translated upstream — served as "${cfg.locale}", skipping`);
      continue;
    }
    for (const [namespace, kv] of Object.entries(cfg.translations)) {
      for (const [key, value] of Object.entries(kv)) translations.push({ namespace, key, locale, value });
    }
    for (const [stepKey, options] of Object.entries(cfg.steps)) {
      for (const o of options) {
        const id = `${stepKey}|${o.key}`;
        const entry = optionMap.get(id) ?? {
          stepKey, optionKey: o.key, imageUrl: o.image_url, sortOrder: o.sort_order, labels: {},
        };
        entry.labels[locale] = o.label;
        optionMap.set(id, entry);
      }
    }
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    source: BASE,
    servedLocales,
    locations,
    translations,
    stepOptions: [...optionMap.values()],
  };

  mkdirSync(resolve("seed"), { recursive: true });
  const file = resolve("seed/live-booking.json");
  writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(
    `✓ ${file}\n  ${locations.length} studios · ${translations.length} translation rows · ${payload.stepOptions.length} step options`,
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
