import { NextResponse, type NextRequest } from "next/server";
import { computeAvailability, loadStudio } from "@/server/booking/availability";
import { isValidTimeZone } from "@/server/booking/timezone";

export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const month = req.nextUrl.searchParams.get("month") ?? "";
  const viewerTz = req.nextUrl.searchParams.get("timezone") ?? "";

  if (!MONTH.test(month)) {
    return NextResponse.json({ message: "month must be YYYY-MM" }, { status: 400 });
  }

  const studio = await loadStudio(slug);
  if (!studio) return NextResponse.json({ message: "Studio not found" }, { status: 404 });

  const availability = await computeAvailability(studio, month);

  return NextResponse.json(
    {
      location_id: studio.id,
      month,
      /* Slots are always quoted in the STUDIO's timezone — that is the only
       * reading that matches the door being open. The viewer's timezone is
       * echoed back so the client can label it. */
      timezone: studio.timezone,
      viewer_timezone: isValidTimeZone(viewerTz) ? viewerTz : null,
      availability,
    },
    /* Never cached in the browser: a stale slot list makes the visitor
     * pick a time that is already gone and eat a 409 on submit. */
    { headers: { "Cache-Control": "no-store" } },
  );
}
