import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { leads, appointments, availabilityBlocks, locations, activityLog } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { zonedToUtc } from "@/server/booking/timezone";
import { scheduleAppointmentReminders } from "@/server/sms/schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function bkRef(): string {
  return `BK-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}

/**
 * Turns a lead into a booking.
 *
 * The console used to do this entirely in memory: it minted a BK- code in
 * the browser, pushed an appointment into local state and moved on. Nothing
 * reached the database, so the booking vanished on refresh and the studio's
 * calendar never knew about it.
 */
export const POST = withAuth("leads.convert", async (user, req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { preferred_date?: string; preferred_time?: string };

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) return NextResponse.json({ message: "Lead not found" }, { status: 404 });
  requireScope(user, lead.locationId);

  if (lead.convertedAt) {
    return NextResponse.json({ message: "This lead is already booked" }, { status: 409 });
  }

  const date = String(body.preferred_date ?? "");
  const time = String(body.preferred_time ?? "").slice(0, 5);
  if (!DATE.test(date) || !TIME.test(time)) {
    return NextResponse.json({ message: "A valid date and time are required" }, { status: 422 });
  }

  const [studio] = await db.select().from(locations).where(eq(locations.id, lead.locationId)).limit(1);
  if (!studio) return NextResponse.json({ message: "Studio not found" }, { status: 404 });

  const startsAt = zonedToUtc(date, time, studio.timezone);
  const endsAt = new Date(startsAt.getTime() + studio.bookingIntervalMin * 60_000);

  // Same collision check the public booking endpoint runs, so an agent
  // cannot double-book a slot the calendar already shows as taken.
  const clash = await db
    .select({ id: availabilityBlocks.id })
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.locationId, studio.id),
        lte(availabilityBlocks.startsAt, endsAt),
        gte(availabilityBlocks.endsAt, startsAt),
      ),
    )
    .limit(1);
  if (clash.length > 0) {
    return NextResponse.json({ message: "That slot is already taken" }, { status: 409 });
  }

  const meta = (lead.meta ?? {}) as Record<string, unknown>;
  const asString = (v: unknown) => (typeof v === "string" ? v : null);

  // The insert trigger converts the lead, closes its session and cancels
  // any pending recovery SMS.
  const created = await db.transaction(async (tx) => {
    const [appt] = await tx
      .insert(appointments)
      .values({
        bkUuid: bkRef(),
        leadId: lead.id,
        customerId: lead.customerId,
        sessionId: lead.sessionId,
        locationId: lead.locationId,
        name: lead.name,
        email: lead.email,
        phoneE164: lead.phoneE164,
        purpose: asString(meta.purpose),
        style: asString(meta.style),
        size: asString(meta.size),
        storyType: asString(meta.story_type ?? meta.storyType),
        story: asString(meta.story),
        bodyAreas: Array.isArray(meta.body_areas) ? (meta.body_areas as string[]) : [],
        startsAt,
        endsAt,
        preferredDate: date,
        preferredTime: time,
        displayTimezone: studio.timezone,
        locale: lead.locale,
        platform: lead.platform,
        consent: true,
        status: "pending",
      })
      .returning();

    await tx.insert(activityLog).values({
      actorKind: "user",
      actorStaffId: user.id,
      actorName: user.name,
      actorRoleId: user.roleId,
      locationId: lead.locationId,
      targetType: "lead",
      targetId: lead.id,
      targetLabel: lead.name,
      action: "converted",
      toValue: appt.bkUuid,
      summary: `Booked for ${date} ${time}`,
    });

    return appt;
  });

  await scheduleAppointmentReminders(created.id);

  return NextResponse.json({ appointment: created, bkUuid: created.bkUuid }, { status: 201 });
});
