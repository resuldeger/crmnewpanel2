/* Two customers, one chair.
 *
 * The booking endpoint read availability_blocks and then inserted, with
 * nothing between the two steps. Two requests for the same slot both saw
 * it free, both booked it, and both were texted "your booking is
 * confirmed" — the studio found out when two people walked in.
 *
 * It also disagreed with the form about what "taken" means, in two ways
 * that were live on every studio: a block ending exactly at the slot start
 * counted as a clash, and slotCapacity (2 everywhere) was ignored, so a
 * slot the form offered was refused on submit.
 *
 * Creates its own studio and removes it again, so it depends on nothing
 * that happens to exist. It used to run against studio 46 (test-branch),
 * which was then deleted for sharing Atlanta's phone number — a test that
 * needs a particular row to already be there breaks the moment somebody
 * tidies the data.
 *
 * SMS automation is left off on that studio: SMS_TRANSPORT is twilio here
 * and a booking would send a real, billed message.
 *
 *   npx tsx scripts/dev/test-booking-race.ts
 */
import "../env";
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, like, sql } from "drizzle-orm";
import { db } from "../../src/db/client";
import { appointments, availabilityBlocks, bookingSessions, customers, leads, locations, scheduledMessages } from "../../src/db/schema";
import { redis } from "../../src/server/redis";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SLUG = `booking-race-test-${randomUUID().slice(0, 8)}`;
/** Filled in by setup(); every query below is scoped to it. */
let STUDIO_ID = 0;

/** Open 10:00–20:00 every day, in one timezone, so the slots are known. */
const HOURS = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { enabled: true, open: "10:00", close: "20:00" }]),
);

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** The endpoint allows 8 attempts per IP per 5 minutes; the test needs more. */
async function clearRateLimit() {
  const keys = await redis.keys("rate:appointment:create:*");
  if (keys.length) await redis.del(...keys);
}

/** A booking session row, so each attempt carries its own id. */
async function newSession(): Promise<string> {
  const uuid = randomUUID();
  await db.insert(bookingSessions).values({ sessionUuid: uuid, locationId: STUDIO_ID });
  return uuid;
}

interface Attempt { status: number; body: Record<string, unknown> }

async function book(date: string, time: string, sessionUuid: string, name = "Race Test"): Promise<Attempt> {
  const res = await fetch(`${BASE}/api/booking/appointments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location_slug: SLUG,
      preferred_date: date,
      preferred_time: time,
      full_name: name,
      phone: "+12125550188",
      sms_consent: true,
      session_uuid: sessionUuid,
      language: "en",
    }),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** A weekday a few days out, inside the horizon and the studio's hours. */
function targetDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  // test-branch opens 10:00–20:00 Mon–Sat and 12:00–18:00 Sun; avoid Sunday.
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const rowsFor = (date: string, time: string) =>
  db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.locationId, STUDIO_ID),
        eq(appointments.preferredDate, date),
        eq(appointments.preferredTime, time),
      ),
    );

async function main() {
  const [studio] = await db
    .insert(locations)
    .values({
      name: "Booking Race Test",
      slug: SLUG,
      city: "Testville",
      timezone: "America/New_York",
      bookingIntervalMin: 15,
      bookingActive: true,
      slotCapacity: 1,
      maxBookingDaysAhead: 30,
      sameDayLeadHours: 2,
      hours: HOURS,
      // Off on purpose: a booking here would otherwise send a real text.
      twilio: { smsAutomation: false },
    })
    .returning({ id: locations.id, intervalMin: locations.bookingIntervalMin });
  STUDIO_ID = studio.id;

  const original = { intervalMin: studio.intervalMin };
  const startedAt = new Date();
  console.log(`\nstudio ${SLUG} (#${STUDIO_ID}) olusturuldu · aralik ${original.intervalMin}dk · kapasite 1\n`);

  /* The next slot along, which is the one the off-by-one refused. Reading
     the interval matters: on a 15-minute studio, 14:30 is not adjacent to
     14:00 — it is a slot away, and testing it proves nothing. */
  const nextSlot = (hhmm: string): string => {
    const [h, m] = hhmm.split(":").map(Number);
    const t = h * 60 + m + original.intervalMin;
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  };

  try {
    // ── 1. The race ───────────────────────────────────────────────────
    console.log("1. ayni slota 5 esanzamanli rezervasyon");
    await clearRateLimit();
    const date = targetDate(3);
    const sessions = await Promise.all(Array.from({ length: 5 }, () => newSession()));
    const results = await Promise.all(sessions.map((s) => book(date, "14:00", s)));

    const created = results.filter((r) => r.status === 201);
    const refused = results.filter((r) => r.status === 409);
    check("tam 1 tanesi basarili", created.length === 1, `${created.length} × 201`);
    check("digerleri 409", refused.length === 4, `${refused.length} × 409`);
    check("hicbiri 500 degil", results.every((r) => r.status < 500), results.map((r) => r.status).join(","));
    check(
      "reddedilenlerin mesaji dogru",
      refused.every((r) => String(r.body.message ?? "").includes("just taken")),
      String(refused[0]?.body.message ?? "—"),
    );

    const rows = await rowsFor(date, "14:00");
    check("veritabaninda tek randevu", rows.length === 1, `${rows.length} satir`);

    const blocks = await db
      .select({ id: availabilityBlocks.id })
      .from(availabilityBlocks)
      .where(and(eq(availabilityBlocks.locationId, STUDIO_ID), eq(availabilityBlocks.appointmentId, rows[0]!.id)));
    check("tek availability block", blocks.length === 1, `${blocks.length} blok`);

    /* ── 2. The slot that starts exactly where the last one ended ─────
       The old predicate was `block.ends_at >= slot.starts_at`, so a block
       finishing at 14:15 collided with the slot beginning at 14:15 and the
       customer was told it was taken. */
    const adjacentTime = nextSlot("14:00");
    console.log(`\n2. bitisik slot (${adjacentTime}) — off-by-one`);
    await clearRateLimit();
    const adjacent = await book(date, adjacentTime, await newSession());
    check("bitisik slot kabul edildi", adjacent.status === 201,
      `${adjacent.status} ${String(adjacent.body.message ?? "")}`);
    check("gercekten bitisik", adjacentTime !== "14:00", `14:00 → ${adjacentTime}`);

    // ── 3. Capacity ───────────────────────────────────────────────────
    console.log("\n3. slotCapacity=2 — form neyi sunuyorsa o kabul edilmeli");
    await db.update(locations).set({ slotCapacity: 2 }).where(eq(locations.id, STUDIO_ID));
    await clearRateLimit();
    const capDate = targetDate(4);
    const first = await book(capDate, "15:00", await newSession());
    const second = await book(capDate, "15:00", await newSession());
    const third = await book(capDate, "15:00", await newSession());
    check("1. koltuk", first.status === 201, String(first.status));
    check("2. koltuk (eskiden burada 409 donuyordu)", second.status === 201,
      `${second.status} ${String(second.body.message ?? "")}`);
    check("3. istek dolu", third.status === 409, String(third.status));
    await db.update(locations).set({ slotCapacity: 1 }).where(eq(locations.id, STUDIO_ID));

    // ── 4. Outside the studio's own rules ─────────────────────────────
    console.log("\n4. calisma saatleri disinda (07:00)");
    await clearRateLimit();
    const closed = await book(targetDate(5), "07:00", await newSession());
    check("reddedildi", closed.status === 422, String(closed.status));
    check("sebebi soyleniyor", String(closed.body.message ?? "").length > 0, String(closed.body.message ?? "—"));

    // ── 5. Idempotency still holds ────────────────────────────────────
    console.log("\n5. ayni oturum iki kez (yeniden gonderim)");
    await clearRateLimit();
    const repeatSession = await newSession();
    const send1 = await book(targetDate(6), "16:00", repeatSession);
    const send2 = await book(targetDate(6), "16:00", repeatSession);
    check("ilki olusturdu", send1.status === 201, String(send1.status));
    check("ikincisi ayni rezervasyonu dondu", send2.body.deduplicated === true, JSON.stringify(send2.body));
    check("ayni uuid", send1.body.booking_uuid === send2.body.booking_uuid);
  } finally {
    /* Keyed on the test's own phone number rather than only on this run's
       studio, so a run that died halfway leaves nothing for the next one
       to trip over — which is what happened: a failed teardown left
       appointments behind, and the next run's customer delete hit their
       foreign key instead.
     *
     * Order matters. An appointment points at both the lead and the
     * customer the insert trigger made for it, so those two cannot go
     * first. An earlier version deleted only the appointments and left 37
     * leads behind, which surfaced days later as a duplicate group in the
     * merge queue. */
    const PHONE = "+12125550188";

    const mine = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.phoneE164, PHONE));
    if (mine.length) {
      await db.delete(scheduledMessages).where(inArray(scheduledMessages.appointmentId, mine.map((m) => m.id)));
      await db.delete(appointments).where(eq(appointments.phoneE164, PHONE));
    }
    await db.delete(leads).where(eq(leads.phoneE164, PHONE));
    await db.delete(customers).where(eq(customers.phoneE164, PHONE));
    // Any studio this test has ever created, not just this run's.
    await db.delete(locations).where(like(locations.slug, "booking-race-test-%"));
    await clearRateLimit();
    console.log(`\ntemizlendi: ${mine.length} randevu, test studyolari silindi`);
    void startedAt; void gte; void availabilityBlocks; void STUDIO_ID;
  }

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
