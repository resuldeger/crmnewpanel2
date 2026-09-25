import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, appointments, availabilityBlocks, locations, realtimeEvents } from "@/db/schema";
import { zonedToUtc } from "@/server/booking/timezone";
import { clientIp } from "@/server/booking/attribution";
import { allow } from "@/server/redis";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
/* Statuses a customer may still act on from the /b/{uuid} link.
 *
 * 'rescheduled' belongs here: PATCH below sets it, so leaving it out locked
 * the booker out of their own appointment after a single move — the second
 * reschedule 409'd and both buttons vanished from the page. */
const OPEN = ["pending", "confirmed", "deposit_paid", "rescheduled"] as const;
const isOpen = (status: string) => (OPEN as readonly string[]).includes(status);

async function load(uuid: string) {
  const [row] = await db
    .select({
      a: appointments,
      slug: locations.slug,
      studioName: locations.name,
      address: locations.address,
      mapsUrl: locations.mapsUrl,
      branchPhone: locations.branchPhone,
      interval: locations.bookingIntervalMin,
      timezone: locations.timezone,
    })
    .from(appointments)
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .where(eq(appointments.bkUuid, uuid))
    .limit(1);
  return row ?? null;
}

/** Read-only view behind the /b/{uuid} link on the confirmation screen. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params;
  const row = await load(uuid);
  if (!row) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const open = isOpen(row.a.status);
  const inFuture = row.a.startsAt.getTime() > Date.now();

  return NextResponse.json({
    uuid: row.a.bkUuid,
    status: row.a.status,
    // The link is emailed, so it must not expose more than the booker needs.
    name: row.a.name,
    locationSlug: row.slug,
    locationName: row.studioName,
    locationShortName: row.studioName.replace(/^Cleopatra Ink\s+/i, ""),
    address: row.address,
    // Not every studio has a curated Maps link; the address alone is enough
    // for a search URL, and a wrong pin is worse than none.
    mapsUrl:
      row.mapsUrl ??
      (row.address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.address)}`
        : null),
    branchPhone: row.branchPhone,
    preferredDate: row.a.preferredDate,
    preferredTime: String(row.a.preferredTime).slice(0, 5),
    displayTimezone: row.a.displayTimezone,
    /* The booker may open this link from another country. preferredDate /
       preferredTime are studio wall-clock; this is the same moment as an
       instant, so the page can render it in whatever zone is selected. */
    startsAt: row.a.startsAt.toISOString(),
    endsAt: row.a.endsAt.toISOString(),
    studioTimezone: row.timezone,
    purpose: row.a.purpose,
    style: row.a.style,
    canReschedule: open && inFuture,
    canCancel: open && inFuture,
  });
}


/* ── Audit + live notice for self-service changes ──────────────────────
 * These come from the booker's own link, so the actor is neither staff nor
 * the job runner. Without this the console showed a booking that had moved
 * overnight with nothing saying who moved it or when, and nobody knew to
 * call back.
 * ────────────────────────────────────────────────────────────────── */
async function recordCustomerAction(
  row: NonNullable<Awaited<ReturnType<typeof load>>>,
  e: { action: "status_change"; fromValue: string; toValue: string; summary: string; topic: string },
) {
  await db.insert(activityLog).values({
    actorKind: "customer",
    actorName: row.a.name,
    locationId: row.a.locationId,
    targetType: "appointment",
    targetId: String(row.a.id),
    targetLabel: row.a.bkUuid,
    action: e.action,
    fromValue: e.fromValue,
    toValue: e.toValue,
    summary: e.summary,
  });

  await db.insert(realtimeEvents).values({
    channel: "appointments:live",
    topic: e.topic,
    locationId: row.a.locationId,
    requiredPermission: "appts.view",
    payload: {
      bkUuid: row.a.bkUuid,
      name: row.a.name,
      studio: row.studioName,
      from: e.fromValue,
      to: e.toValue,
    },
  });
}

/** Reschedule. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params;
  const ip = clientIp(req.headers) ?? "unknown";
  if (!(await allow("appointment:update", ip, 10, 300))) {
    return NextResponse.json({ message: "Too many attempts" }, { status: 429 });
  }

  const row = await load(uuid);
  if (!row) return NextResponse.json({ message: "Not found" }, { status: 404 });
  if (!isOpen(row.a.status)) {
    return NextResponse.json({ message: "This appointment can no longer be changed" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { preferred_date?: string; preferred_time?: string };
  const date = String(body.preferred_date ?? "");
  const time = String(body.preferred_time ?? "").slice(0, 5);
  if (!DATE.test(date) || !TIME.test(time)) {
    return NextResponse.json({ message: "Invalid date or time" }, { status: 422 });
  }

  const startsAt = zonedToUtc(date, time, row.timezone);
  const endsAt = new Date(startsAt.getTime() + row.interval * 60_000);
  if (startsAt.getTime() < Date.now()) {
    return NextResponse.json({ message: "That time is in the past" }, { status: 409 });
  }

  // Ignore this appointment's own block when checking for a clash, or it
  // would always collide with itself.
  const clash = await db
    .select({ id: availabilityBlocks.id })
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.locationId, row.a.locationId),
        lte(availabilityBlocks.startsAt, endsAt),
        gte(availabilityBlocks.endsAt, startsAt),
        ne(availabilityBlocks.appointmentId, row.a.id),
      ),
    )
    .limit(1);
  if (clash.length > 0) {
    return NextResponse.json({ message: "That slot was just taken" }, { status: 409 });
  }

  const wasAt = `${row.a.preferredDate} ${String(row.a.preferredTime).slice(0, 5)}`;

  await db
    .update(appointments)
    .set({
      startsAt, endsAt,
      preferredDate: date,
      preferredTime: time,
      status: "rescheduled",
      /* Whoever confirmed the OLD time did not confirm this one. Leaving
         the stamp behind made a moved booking look already agreed, and the
         desk never rang back. */
      confirmedAt: null,
      confirmedByStaffId: null,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, row.a.id));

  await recordCustomerAction(row, {
    action: "status_change",
    fromValue: wasAt,
    toValue: `${date} ${time}`,
    summary: `Customer moved their appointment from ${wasAt} to ${date} ${time}`,
    topic: "appointment.rescheduled",
  });

  return NextResponse.json({ status: "success" });
}

/** Cancel. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params;
  const ip = clientIp(req.headers) ?? "unknown";
  if (!(await allow("appointment:cancel", ip, 10, 300))) {
    return NextResponse.json({ message: "Too many attempts" }, { status: 429 });
  }

  const row = await load(uuid);
  if (!row) return NextResponse.json({ message: "Not found" }, { status: 404 });
  // Without this the API cancelled appointments the page had already marked
  // un-cancellable, and a repeat call rewrote cancelled_at.
  if (!isOpen(row.a.status)) {
    return NextResponse.json({ message: "This appointment can no longer be cancelled" }, { status: 409 });
  }

  await db
    .update(appointments)
    .set({
      status: "cancelled",
      cancelReason: "cancelled_by_customer",
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, row.a.id));

  await recordCustomerAction(row, {
    action: "status_change",
    fromValue: row.a.status,
    toValue: "cancelled",
    summary: "Customer cancelled their own appointment",
    topic: "appointment.cancelled",
  });

  return NextResponse.json({ status: "success" });
}
