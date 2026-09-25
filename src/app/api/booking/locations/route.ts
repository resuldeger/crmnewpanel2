import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { locations } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Studio picker. This page used to be server-rendered by Laravel. */
export async function GET() {
  const rows = await db
    .select({
      id: locations.id,
      slug: locations.slug,
      name: locations.name,
      address: locations.address,
      city: locations.city,
      state: locations.state,
      country: locations.country,
      imageUrl: locations.imageUrl,
      timezone: locations.timezone,
      bookingActive: locations.bookingActive,
    })
    .from(locations)
    .where(eq(locations.bookingActive, true))
    .orderBy(asc(locations.displayOrder), asc(locations.name));

  return NextResponse.json(
    { locations: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
}
