/* ── Language negotiation for server-rendered public pages ─────────────
 * Order: ?lang → cookie → Accept-Language → the default locale.
 * Only locales the database actually serves are accepted, so a visitor
 * cannot land on a half-translated page.
 * ────────────────────────────────────────────────────────────────── */
import { activeLocales } from "@/server/booking/dictionary";

export { LOCALE_COOKIE } from "@/app/_public/locale-cookie";

/** Parses "tr-TR,tr;q=0.9,en;q=0.8" into ["tr","en"], best first. */
function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim().slice(0, 2).toLowerCase(), q: q ? Number(q.split("=")[1]) : 1 };
    })
    .filter((x) => /^[a-z]{2}$/.test(x.tag))
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}

export async function negotiateLocale(opts: {
  param?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Promise<{ locale: string; available: string[]; fallbackUsed: boolean }> {
  const active = await activeLocales();
  const codes = active.map((l) => l.code);
  const fallback = active.find((l) => l.isDefault)?.code ?? codes[0] ?? "en";

  const wanted = [
    opts.param?.slice(0, 2).toLowerCase(),
    opts.cookie?.slice(0, 2).toLowerCase(),
    ...parseAcceptLanguage(opts.acceptLanguage ?? null),
  ].filter(Boolean) as string[];

  const match = wanted.find((w) => codes.includes(w));
  return { locale: match ?? fallback, available: codes, fallbackUsed: !match && wanted.length > 0 };
}
