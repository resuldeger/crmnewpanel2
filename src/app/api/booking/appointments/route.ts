import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, bookingSessions, locations } from "@/db/schema";
import { zonedToUtc } from "@/server/booking/timezone";
import { checkSlot } from "@/server/booking/availability";
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

  let sessionId: number | null = null;
  if (typeof body.session_uuid === "string") {
    const [s] = await db
      .select({ id: bookingSessions.id })
      .from(bookingSessions)
      .where(eq(bookingSessions.sessionUuid, body.session_uuid))
      .limit(1);
    sessionId = s?.id ?? null;
  }

  /* ── Taking the slot ───────────────────────────────────────────────
   * Checking whether a slot is free and then filling it are two steps,
   * and between them is where two customers both get told yes. Both
   * requests read an empty slot, both insert, both are sent a "your
   * booking is confirmed" text, and the studio finds out when two people
   * arrive for the same chair. Nothing in the schema prevented it: there
   * is no exclusion constraint on availability_blocks, and there cannot
   * easily be one while GetTimely writes into the same table.
   *
   * So the two steps are made one. Everyone asking for this exact slot at
   * this studio queues on an advisory lock — narrow enough that two
   * different slots, or two different branches, never wait on each other.
   * The lock is held until the transaction ends, so the winner's block is
   * committed before the next contender is allowed to look.
   * ────────────────────────────────────────────────────────────── */
  const slotKey = Math.floor(startsAt.getTime() / 60_000);

  type Outcome =
    | { kind: "created"; id: number; bkUuid: string }
    | { kind: "duplicate"; id: number; bkUuid: string }
    | { kind: "refused"; message: string; status: number };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    await tx.execute(sql`select pg_advisory_xact_lock(${studio.id}, ${slotKey})`);

    /* ── Idempotency ────────────────────────────────────────────────
     * One booking session produces one appointment. Without this, an
     * answer lost on the way back — a dropped connection, a proxy timing
     * out, the customer tapping the button twice — booked a second slot
     * and sent a second confirmation.
     *
     * The session id is the key because the browser already holds it and
     * keeps it across a reload, so a resend carries the same one.
     */
    if (sessionId !== null) {
      const [already] = await tx
        .select({ id: appointments.id, bkUuid: appointments.bkUuid, status: appointments.status })
        .from(appointments)
        .where(eq(appointments.sessionId, sessionId))
        .limit(1);

      // A cancelled one must not stop them booking again.
      if (already && already.status !== "cancelled") {
        return { kind: "duplicate", id: already.id, bkUuid: already.bkUuid };
      }
    }

    /* The same function the form asks when it decides what to offer, so
       the offer and the acceptance cannot disagree. It runs AFTER the
       dedupe above on purpose: this booking's own block is in that table,
       so a resend would collide with itself and tell the customer the slot
       they had just taken was "just taken". */
    const verdict = await checkSlot(studio, startsAt, endsAt, new Date(), tx);
    if (!verdict.ok) {
      return {
        kind: "refused",
        message: verdict.message,
        // Taken or gone is a conflict; outside the studio's own rules is
        // a request this studio cannot process at all.
        status: verdict.reason === "full" || verdict.reason === "past" ? 409 : 422,
      };
    }

    // The trigger on this insert links the customer, converts the lead out
    // of the pipeline, closes the session and cancels its recovery SMS. It
    // also writes the availability block that holds this slot — which is
    // why the lock has to outlive the insert.
    const [row] = await tx
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

    return { kind: "created", id: row.id, bkUuid: row.bkUuid };
  });

  if (outcome.kind === "refused") {
    return NextResponse.json({ message: outcome.message }, { status: outcome.status });
  }

  /* A resend gets the booking the first attempt made. Sending the
     confirmation again, or queueing a second set of reminders, would text
     the customer twice for one appointment. */
  if (outcome.kind === "duplicate") {
    return NextResponse.json({
      status: "success",
      booking_uuid: outcome.bkUuid,
      id: outcome.id,
      deduplicated: true,
    });
  }

  /* Everything past this point is outside the transaction on purpose. The
     slot is taken and committed; holding the lock through an SMS round
     trip would queue every other customer behind Twilio. */

  // The insert trigger has already converted the lead and cancelled its
  // recovery chase. What is left is the forward-looking automation.
  await scheduleAppointmentReminders(outcome.id);

  if (studio.twilio?.smsAutomation) {
    const sent = await sendSms({
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
        link: `${process.env.PUBLIC_BOOKING_URL ?? ""}/b/${outcome.bkUuid}`,
      },
    });
    // A failed confirmation must not fail the booking — the appointment is
    // already made and the studio can still reach the customer.
    if (!sent.ok) console.warn(`booking ${outcome.bkUuid}: confirmation SMS not sent — ${sent.message}`);
  }

  return NextResponse.json({ status: "success", booking_uuid: outcome.bkUuid, id: outcome.id }, { status: 201 });
}

/** Availability cache is keyed per studio/month; bust it after a booking. */
export const revalidate = 0;
