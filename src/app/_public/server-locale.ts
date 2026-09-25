import { cookies, headers } from "next/headers";
import { negotiateLocale } from "@/server/i18n/negotiate";
import { LOCALE_COOKIE } from "./locale-cookie";

/**
 * Language for the first paint, decided on the server so SSR and hydration
 * render the same text and the visitor never sees English flash past.
 */
export async function serverLocale(
  searchParams?: Record<string, string | string[] | undefined>,
): Promise<{ locale: string; available: string[] }> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  const param = typeof searchParams?.lang === "string" ? searchParams.lang : null;
  const { locale, available } = await negotiateLocale({
    param,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerList.get("accept-language"),
  });
  return { locale, available };
}
