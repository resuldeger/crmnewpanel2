import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { bookingSessions, locations } from "@/db/schema";
import { resolvePlatform, pickClickIds, classifyUserAgent, clientIp } from "@/server/booking/attribution";
import { allow } from "@/server/redis";

export const dynamic = "force-dynamic";

/** Opens a tracking session the moment a visitor lands on the wizard. */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers) ?? "unknown";

  // Public endpoint — one visitor should not be able to spam session rows.
  if (!(await allow("session:create", ip, 30, 60))) {
    return NextResponse.json({ message: "Too many requests" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = typeof body.location_slug === "string" ? body.location_slug : null;

  let locationId: number | null = null;
  if (slug) {
    const [studio] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, slug))
      .limit(1);
    locationId = studio?.id ?? null;
  }

  const extra = (body.extra_data && typeof body.extra_data === "string"
    ? (JSON.parse(body.extra_data) as Record<string, string>)
    : {}) as Record<string, string>;

  const utm = {
    source: (body.utm_source as string) ?? null,
    medium: (body.utm_medium as string) ?? null,
    campaign: (body.utm_campaign as string) ?? null,
    term: (body.utm_term as string) ?? null,
    content: (body.utm_content as string) ?? null,
    id: (body.utm_id as string) ?? null,
  };
  const clickIds = pickClickIds({ ...extra, ...(body as Record<string, string>) });
  const ua = req.headers.get("user-agent");
  const { deviceType, browser, os } = classifyUserAgent(ua);

  const landingUrl = (body.landing_url as string) ?? null;
  const contactFirst = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "page_form"]
    .some((p) => p in extra);

  const [row] = await db
    .insert(bookingSessions)
    .values({
      locationId,
      locationSlug: slug,
      locale: (body.locale as string) ?? "en",
      platform: resolvePlatform(utm, clickIds, req.headers.get("referer")),
      utm,
      clickIds,
      extraParams: extra,
      landingUrl,
      referrer: req.headers.get("referer"),
      ip,
      userAgent: ua,
      deviceType,
      browser,
      os,
      contactFirst,
    })
    .returning({ sessionUuid: bookingSessions.sessionUuid });

  return NextResponse.json({ status: "success", session_uuid: row.sessionUuid });
}
