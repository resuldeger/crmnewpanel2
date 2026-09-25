import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { locations } from "@/db/schema";
import { resolveDictionary } from "@/server/booking/dictionary";
import { negotiateLocale, LOCALE_COOKIE } from "@/server/i18n/negotiate";
import { StudioPicker } from "./_public/StudioPicker";
import "./_public/public.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book an Appointment — Cleopatra Ink",
  description: "Book your tattoo or piercing appointment at any Cleopatra Ink studio.",
};

/**
 * The public front door. The admin console used to live here; it now sits
 * behind /admin, where an ordinary visitor will not stumble into it.
 *
 * Rendered on the server so the first paint is already in the visitor's
 * language rather than flashing English and swapping.
 */
export default async function PublicHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const headerList = await headers();

  const langParam = typeof params.lang === "string" ? params.lang : null;
  const { locale, available } = await negotiateLocale({
    param: langParam,
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerList.get("accept-language"),
  });

  const [studios, dictionary] = await Promise.all([
    db
      .select({
        id: locations.id,
        slug: locations.slug,
        name: locations.name,
        address: locations.address,
        city: locations.city,
        state: locations.state,
        timezone: locations.timezone,
      })
      .from(locations)
      .where(eq(locations.bookingActive, true))
      .orderBy(asc(locations.displayOrder), asc(locations.name)),
    resolveDictionary("booking", locale, null),
  ]);

  return (
    <StudioPicker
      studios={studios}
      locale={dictionary.locale}
      availableLocales={available}
      messages={dictionary.messages}
    />
  );
}
