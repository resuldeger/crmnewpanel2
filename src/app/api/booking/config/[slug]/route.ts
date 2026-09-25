import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { locations, integrations } from "@/db/schema";
import { resolveDictionary, resolveStepOptions, activeLocales } from "@/server/booking/dictionary";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const requested = (req.nextUrl.searchParams.get("lang") ?? "en").slice(0, 2).toLowerCase();

  const [studio] = await db.select().from(locations).where(eq(locations.slug, slug)).limit(1);
  if (!studio) {
    return NextResponse.json({ message: "Studio not found" }, { status: 404 });
  }

  const [dictionary, steps, all, turnstile] = await Promise.all([
    resolveDictionary("booking", requested, studio.id),
    resolveStepOptions(studio.id, requested),
    activeLocales(),
    db.select().from(integrations).where(eq(integrations.provider, "turnstile")).limit(1),
  ]);

  return NextResponse.json(
    {
      location: {
        id: studio.id,
        slug: studio.slug,
        name: studio.name,
        /* The dictionary writes "Welcome to Cleopatra Ink :location", so the
         * interpolated value must be the bare branch ("Tacoma") or the brand
         * renders twice. Both forms are published; the client picks. */
        shortName: studio.name.replace(/^Cleopatra Ink\s+/i, ""),
        address: studio.address,
        timezone: studio.timezone,
        countryCode: studio.countryCode,
        bookingActive: studio.bookingActive,
        mapLink: studio.mapsUrl,
        gtmCountry: studio.gtmCountry,
        gtmCity: studio.gtmCityState,
        maxBookingDaysAhead: studio.maxBookingDaysAhead,
        sameDayLeadHours: studio.sameDayLeadHours,
      },
      locale: dictionary.locale,
      /* The old API answered 200 with English for an untranslated language
       * and told the client nothing. Both facts are explicit now. */
      fallbackUsed: dictionary.fallbackUsed,
      supportedLocales: all.map((l) => l.code),
      translations: dictionary.messages,
      steps,
      /* Was injected by the Blade layout, so the SPA lost it when served
       * standalone. Ad traffic gets asked for contact details first. */
      contactStepOverride: {
        triggerParams: ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "page_form"],
        targetStepIndex: 1,
      },
      vipPickupEnabled: studio.vipPickupEnabled,
      turnstileSiteKey: turnstile[0]?.publicKey ?? null,
    },
    {
      headers: {
        "Content-Language": dictionary.locale,
        /* No browser cache: an admin editing a translation or a studio
         * toggling itself off must take effect on the next page view.
         * Load is absorbed by the Redis cache behind this handler. */
        "Cache-Control": "no-store",
        Vary: "Accept-Language",
      },
    },
  );
}
