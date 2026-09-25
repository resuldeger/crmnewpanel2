/* ── Slot computation ──────────────────────────────────────────────────
 * Hybrid source of truth: the studio's weekly hours define what could be
 * offered, availability_blocks (Timely sync + our own appointments +
 * manual closures) subtract what is taken.
 * ────────────────────────────────────────────────────────────────── */
import { and, eq, gt, gte, lt, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import { availabilityBlocks, locationClosures, locations } from "@/db/schema";
import { zonedToUtc, zonedDate, dayKey, daysInMonth } from "./timezone";

export interface Slot {
  /** Wall-clock time at the STUDIO — what the studio's own diary shows. */
  time: string;
  /**
   * The same moment as a UTC instant. The visitor may be in another
   * timezone, so the client renders THIS in their zone; sending only the
   * studio-local string made an Istanbul customer read "10:00" as their
   * own 10:00 when it was 20:00 for them.
   */
  startsAt: string;
  booked: boolean;
}
export interface DayAvailability { available: boolean; slots: Slot[] }

interface Studio {
  id: number;
  timezone: string;
  bookingIntervalMin: number;
  maxBookingDaysAhead: number;
  sameDayLeadHours: number;
  /** Concurrent appointments per slot: one ours, one from GetTimely. */
  slotCapacity: number;
  hours: Partial<Record<string, { enabled: boolean; open: string; close: string }>>;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function computeAvailability(
  studio: Studio,
  month: string,
  now = new Date(),
): Promise<Record<string, DayAvailability>> {
  const days = daysInMonth(month);
  if (days.length === 0) return {};

  // Widen the window by a day on each side: a studio's local day overlaps
  // two UTC days, and a visitor in another timezone can straddle both.
  const windowStart = zonedToUtc(days[0], "00:00", studio.timezone);
  const windowEnd = zonedToUtc(days[days.length - 1], "23:59", studio.timezone);
  const pad = 24 * 60 * 60 * 1000;

  const [blocks, closures] = await Promise.all([
    db
      .select({
        startsAt: availabilityBlocks.startsAt,
        endsAt: availabilityBlocks.endsAt,
        artistId: availabilityBlocks.artistId,
        source: availabilityBlocks.source,
      })
      .from(availabilityBlocks)
      .where(
        and(
          eq(availabilityBlocks.locationId, studio.id),
          gte(availabilityBlocks.endsAt, new Date(windowStart.getTime() - pad)),
          lte(availabilityBlocks.startsAt, new Date(windowEnd.getTime() + pad)),
        ),
      ),
    db
      .select()
      .from(locationClosures)
      .where(
        and(
          eq(locationClosures.locationId, studio.id),
          gte(locationClosures.day, days[0]),
          lte(locationClosures.day, days[days.length - 1]),
        ),
      ),
  ]);

  /* Two appointments may share a slot: one booked through this form, one
     already in GetTimely. Deriving it from the artist roster instead gave a
     five-artist studio five concurrent bookings, which is not how the shops
     are run. Per studio, so a bigger branch can be set higher. */
  const capacity = Math.max(1, studio.slotCapacity);

  interface Taken { from: number; to: number; artistId: number | null }
  const takenRanges: Taken[] = blocks.map((b) => ({
    from: b.startsAt.getTime(),
    to: b.endsAt.getTime(),
    artistId: b.artistId,
  }));
  const fullDayClosed = new Set(closures.filter((c) => c.allDay).map((c) => c.day));
  const partialClosures = closures.filter((c) => !c.allDay);

  const today = zonedDate(now, studio.timezone);
  const horizon = new Date(now.getTime() + studio.maxBookingDaysAhead * 24 * 60 * 60 * 1000);
  const lastBookable = zonedDate(horizon, studio.timezone);
  const earliestToday = new Date(now.getTime() + studio.sameDayLeadHours * 60 * 60 * 1000);

  const interval = Math.max(5, studio.bookingIntervalMin) * 60 * 1000;
  const out: Record<string, DayAvailability> = {};

  for (const day of days) {
    // Past days and anything past the booking horizon are simply closed.
    if (day < today || day > lastBookable || fullDayClosed.has(day)) {
      out[day] = { available: false, slots: [] };
      continue;
    }

    const hours = studio.hours[dayKey(day, studio.timezone)];
    if (!hours?.enabled || !HHMM.test(hours.open) || !HHMM.test(hours.close)) {
      out[day] = { available: false, slots: [] };
      continue;
    }

    const opensAt = zonedToUtc(day, hours.open, studio.timezone).getTime();
    const closesAt = zonedToUtc(day, hours.close, studio.timezone).getTime();
    if (closesAt <= opensAt) {
      out[day] = { available: false, slots: [] };
      continue;
    }

    const dayPartials = partialClosures
      .filter((c) => c.day === day && c.fromTime && c.toTime)
      .map((c) => [
        zonedToUtc(day, c.fromTime!.slice(0, 5), studio.timezone).getTime(),
        zonedToUtc(day, c.toTime!.slice(0, 5), studio.timezone).getTime(),
      ] as const);

    const slots: Slot[] = [];
    for (let start = opensAt; start + interval <= closesAt; start += interval) {
      const end = start + interval;
      const overlaps = (from: number, to: number) => start < to && end > from;

      /* Count the bookings in this slot, not whether there are any. One
         artist double-booked in Timely is still one appointment as far as
         the shop floor is concerned, so their overlapping events count
         once; everything else counts on its own. */
      const busyArtists = new Set<number>();
      let unattributed = 0;
      for (const r of takenRanges) {
        if (!overlaps(r.from, r.to)) continue;
        if (r.artistId === null) unattributed += 1;
        else busyArtists.add(r.artistId);
      }
      const seatsUsed = busyArtists.size + unattributed;

      const booked =
        seatsUsed >= capacity ||
        // A partial closure shuts the studio, not one chair.
        dayPartials.some(([from, to]) => overlaps(from, to)) ||
        // same-day lead time — the studio needs notice
        (day === today && start < earliestToday.getTime());

      slots.push({
        time: new Intl.DateTimeFormat("en-GB", {
          timeZone: studio.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(new Date(start)),
        startsAt: new Date(start).toISOString(),
        booked,
      });
    }

    out[day] = { available: slots.some((s) => !s.booked), slots };
  }

  return out;
}

export async function loadStudio(slug: string): Promise<Studio | null> {
  const [row] = await db
    .select({
      id: locations.id,
      timezone: locations.timezone,
      bookingIntervalMin: locations.bookingIntervalMin,
      maxBookingDaysAhead: locations.maxBookingDaysAhead,
      sameDayLeadHours: locations.sameDayLeadHours,
      slotCapacity: locations.slotCapacity,
      hours: locations.hours,
    })
    .from(locations)
    .where(or(eq(locations.slug, slug)))
    .limit(1);
  return row ?? null;
}

/* ── One slot, one rule ────────────────────────────────────────────────
 * computeAvailability decides what the form offers. The booking endpoint
 * decided what it accepts, separately, and the two disagreed:
 *
 *   · it treated a block ending exactly when the slot starts as a clash,
 *     so the 14:00 slot was refused because something ran until 14:00;
 *   · it refused a slot with ANY overlapping block, ignoring slotCapacity
 *     — a studio set to two concurrent bookings offered the slot and then
 *     turned the customer away from it;
 *   · it never looked at opening hours, closures, the booking horizon or
 *     the same-day lead time at all, so a slot the form would never show
 *     could still be booked by posting to the endpoint.
 *
 * A customer who is told "that slot was just taken" about a slot that was
 * never taken books elsewhere. So the offer and the acceptance are the
 * same function now, and it is the one below.
 * ────────────────────────────────────────────────────────────────── */

/** Half-open overlap: a block ending exactly when a slot starts is clear. */
export const rangesOverlap = (aFrom: number, aTo: number, bFrom: number, bTo: number): boolean =>
  aFrom < bTo && aTo > bFrom;

export type SlotVerdict =
  | { ok: true; seatsUsed: number; capacity: number }
  | { ok: false; reason: "past" | "lead_time" | "horizon" | "closed" | "full"; message: string };

/** Anything that can run a select — the pool, or a transaction inside it. */
type Queryable = Pick<typeof db, "select">;

/**
 * Is this exact slot bookable right now?
 *
 * Call it inside the transaction that will do the insert, after taking the
 * slot's advisory lock — on its own it is still only a read, and a read
 * that is not held by a lock can be overtaken between answering and acting.
 */
export async function checkSlot(
  studio: Studio,
  startsAt: Date,
  endsAt: Date,
  now: Date = new Date(),
  tx: Queryable = db,
): Promise<SlotVerdict> {
  const start = startsAt.getTime();
  const end = endsAt.getTime();

  if (start < now.getTime()) {
    return { ok: false, reason: "past", message: "That time is in the past" };
  }

  const today = zonedDate(now, studio.timezone);
  const day = zonedDate(startsAt, studio.timezone);

  const horizon = zonedDate(
    new Date(now.getTime() + studio.maxBookingDaysAhead * 86_400_000),
    studio.timezone,
  );
  if (day > horizon) {
    return { ok: false, reason: "horizon", message: "That date is too far ahead" };
  }

  if (day === today && start < now.getTime() + studio.sameDayLeadHours * 3_600_000) {
    return { ok: false, reason: "lead_time", message: "That time is too soon for a same-day booking" };
  }

  const hours = studio.hours[dayKey(day, studio.timezone)];
  if (!hours?.enabled || !HHMM.test(hours.open) || !HHMM.test(hours.close)) {
    return { ok: false, reason: "closed", message: "The studio is closed that day" };
  }
  const opensAt = zonedToUtc(day, hours.open, studio.timezone).getTime();
  const closesAt = zonedToUtc(day, hours.close, studio.timezone).getTime();
  if (start < opensAt || end > closesAt) {
    return { ok: false, reason: "closed", message: "That time is outside the studio's hours" };
  }

  const closures = await tx
    .select({ allDay: locationClosures.allDay, fromTime: locationClosures.fromTime, toTime: locationClosures.toTime })
    .from(locationClosures)
    .where(and(eq(locationClosures.locationId, studio.id), eq(locationClosures.day, day)));

  for (const c of closures) {
    // A partial closure shuts the studio, not one chair.
    if (c.allDay) return { ok: false, reason: "closed", message: "The studio is closed that day" };
    if (!c.fromTime || !c.toTime) continue;
    const from = zonedToUtc(day, c.fromTime.slice(0, 5), studio.timezone).getTime();
    const to = zonedToUtc(day, c.toTime.slice(0, 5), studio.timezone).getTime();
    if (rangesOverlap(start, end, from, to)) {
      return { ok: false, reason: "closed", message: "The studio is closed at that time" };
    }
  }

  /* Only blocks that genuinely overlap are fetched, using the same
     half-open rule: ends_at > slot start AND starts_at < slot end. */
  const blocks = await tx
    .select({ artistId: availabilityBlocks.artistId })
    .from(availabilityBlocks)
    .where(
      and(
        eq(availabilityBlocks.locationId, studio.id),
        gt(availabilityBlocks.endsAt, startsAt),
        lt(availabilityBlocks.startsAt, endsAt),
      ),
    );

  /* Counted the way the offer counts it: one artist double-booked in
     Timely is still one appointment on the shop floor, so their
     overlapping events take one seat between them. */
  const busyArtists = new Set<number>();
  let unattributed = 0;
  for (const b of blocks) {
    if (b.artistId === null) unattributed += 1;
    else busyArtists.add(b.artistId);
  }
  const seatsUsed = busyArtists.size + unattributed;
  const capacity = Math.max(1, studio.slotCapacity);

  if (seatsUsed >= capacity) {
    return { ok: false, reason: "full", message: "That slot was just taken" };
  }
  return { ok: true, seatsUsed, capacity };
}
