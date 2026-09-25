import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, availabilityBlocks, bookingSessions, locations } from "@/db/schema";
import { zonedToUtc } from "@/server/booking/timezone";
import { clientIp } from "@/server/booking/attribution";
import { checkPhone } from "@/server/booking/phone";
import { allow } from "@/server/redis";
import { scheduleAppointmentReminders } from "@/server/sms/schedule";
import { sendSms } from "@/server/sms/send";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function bkRef(): string {
  return `BK-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers) ?? "unknown";
  if (!(await allow("appointment:create", ip, 8, 300))) {
    return NextResponse.json({ message: "Too many booking attempts" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, string | boolean | string[] | number | undefined>;

  const slug = String(body.location_slug ?? "");
  const date = String(body.preferred_date ?? "");
  const time = String(body.preferred_time ?? "").slice(0, 5);
  const name = String(body.full_name ?? "").trim();
  const phone = String(body.phone ?? "").trim();

  if (!DATE.test(date) || !TIME.test(time)) {
    return NextResponse.json({ message: "Invalid date or time" }, { status: 422 });
  }
  if (name.length < 2) {
    return NextResponse.json({ message: "Name is required" }, { status: 422 });
  }
  if (body.sms_consent !== true) {
    return NextResponse.json({ message: "SMS consent is required" }, { status: 422 });
  }

  const [studio] = await db.select().from(locations).where(eq(locations.slug, slug)).limit(1);
  if (!studio) return NextResponse.json({ message: "Studio not found" }, { status: 404 });
  if (!studio.bookingActive) {
    return NextResponse.json({ message: "This studio is not taking bookings" }, { status: 409 });
  }

  /* Checked against the country's real numbering plan, not just length.
     A number that cannot ring still gets a confirmation SMS billed to it
     and a desk ringing nobody. The studio's country resolves a national
     number typed without a country code. */
  const phoneCheck = checkPhone(phone, studio.countryCode);
  if (!phoneCheck.ok) {
    return NextResponse.json({ message: phoneCheck.reason }, { status: 422 });
  }
  const phoneE164 = phoneCheck.e164!;

  // The slot is resolved in the STUDIO's timezone — the only reading that
  // matches the door being open — and stored as a UTC instant.
  const startsAt = zonedToUtc(date, time, studio.timezone);
  const endsAt = new Date(startsAt.getTime() + studio.bookingIntervalMin * 60_000);

  if (startsAt.getTime() < Date.now()) {
    return NextResponse.json({ message: "That time is in the past" }, { status: 409 });
  }

  let sessionId: number | null = null;
  if (typeof body.session_uuid === "string") {
    const [s] = await db
      .select({ id: bookingSessions.id })
      .from(bookingSessions)
      .where(eq(bookingSessions.sessionUuid, body.session_uuid))
      .limit(1);
    sessionId = s?.id ?? null;
  }

  /* ── Idempotency ──────────────────────────────────────────────────
   * One booking session produces one appointment. Without this, an answer
   * lost on the way back — a dropped connection, a proxy timing out, the
   * customer tapping the button twice — booked a second slot and sent a
   * second confirmation.
   *
   * The session id is the key because the browser already holds it and
   * keeps it across a reload, so a resend carries the same one.
   */
  if (sessionId !== null) {
    const [already] = await db
      .select({ id: appointments.id, bkUuid: appointments.bkUuid, status: appointments.status })
      .from(appointments)
      .where(eq(appointments.sessionId, sessionId))
      .limit(1);

    // A cancelled one must not stop them booking again.
    if (already && already.status !== "cancelled") {
      return NextResponse.json({
        status: "success",
        booking_uuid: already.bkUuid,
        id: already.id,
        deduplicated: true,
      });
    }
  }

  /* Collision check against the same table the availability endpoint reads,
     so what was offered and what is accepted can never disagree.

     It runs AFTER the dedupe above on purpose: this booking's own block is
     in this table, so a resend would collide with itself and tell the
     customer the slot they had just taken was "just taken", sending them
     off to book a second time. */
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
    return NextResponse.json({ message: "That slot was just taken" }, { status: 409 });
  }

  // The trigger on this insert links the customer, converts the lead out of
  // the pipeline, closes the session and cancels its recovery SMS.
  const [created] = await db
    .insert(appointments)
    .values({
      bkUuid: bkRef(),
      sessionId,
      locationId: studio.id,
      name,
      email: body.email ? String(body.email) : null,
      phoneE164: phoneE164,
      purpose: body.purpose ? String(body.purpose) : null,
      style: body.style ? String(body.style) : null,
      size: body.size ? String(body.size) : null,
      storyType: body.story_type ? String(body.story_type) : null,
      story: body.story_description ? String(body.story_description) : null,
      bodyAreas: Array.isArray(body.body_areas) ? (body.body_areas as string[]) : [],
      referenceImageUrl: body.reference_image ? String(body.reference_image) : null,
      startsAt,
      endsAt,
      preferredDate: date,
      preferredTime: time,
      displayTimezone: studio.timezone,
      userTimezone: body.timezone ? String(body.timezone) : null,
      locale: body.language ? String(body.language) : "en",
      consent: true,
      isFreePick: body.is_free_pick === true,
      addressStreet: body.address_street ? String(body.address_street) : null,
      addressCity: body.address_city ? String(body.address_city) : null,
      addressState: body.address_state ? String(body.address_state) : null,
      addressZip: body.address_zip ? String(body.address_zip) : null,
      isTrusted: body._it !== false,
      ip,
    })
    .returning({ id: appointments.id, bkUuid: appointments.bkUuid });

  // The insert trigger has already converted the lead and cancelled its
  // recovery chase. What is left is the forward-looking automation.
  await scheduleAppointmentReminders(created.id);

  if (studio.twilio?.smsAutomation) {
    const outcome = await sendSms({
      to: phoneE164,
      locationId: studio.id,
      templateKey: "booking_confirmation",
      locale: body.language ? String(body.language) : "en",
      kind: "booking_confirmation",
      vars: {
        name: name.split(" ")[0],
        studio: studio.name.replace(/^Cleopatra Ink\s+/i, ""),
        date,
        time,
        link: `${process.env.PUBLIC_BOOKING_URL ?? ""}/b/${created.bkUuid}`,
      },
    });
    // A failed confirmation must not fail the booking — the appointment is
    // already made and the studio can still reach the customer.
    if (!outcome.ok) console.warn(`booking ${created.bkUuid}: confirmation SMS not sent — ${outcome.message}`);
  }

  return NextResponse.json({ status: "success", booking_uuid: created.bkUuid, id: created.id }, { status: 201 });
}

/** Availability cache is keyed per studio/month; bust it after a booking. */
export const revalidate = 0;
void sql;
