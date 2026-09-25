/* ── Wall-clock ⇄ UTC, with the studio's real timezone ─────────────────
 * Slot maths is the one place a timezone bug costs money: a Tacoma
 * customer shown Eastern hours books a slot the studio is closed for.
 * Everything here converts explicitly; nothing relies on the server's
 * own timezone.
 * ────────────────────────────────────────────────────────────────── */

/** Offset of `instant` in `timeZone`, in minutes (positive east of UTC). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  // Intl renders midnight as hour "24" in some engines.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(hour), Number(parts.minute), Number(parts.second),
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * "2026-10-05" + "11:00" in America/Los_Angeles → the matching UTC instant.
 * Applied twice so the DST transition days resolve correctly.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);

  let guess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - offsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/** The calendar date (YYYY-MM-DD) that `instant` falls on in `timeZone`. */
export function zonedDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

/** The wall-clock time (HH:mm) of `instant` in `timeZone`. */
export function zonedTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(instant);
}

/** Weekday key for `date` (YYYY-MM-DD) as seen in `timeZone`. */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export function dayKey(date: string, timeZone: string): DayKey {
  const noon = zonedToUtc(date, "12:00", timeZone);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(noon);
  return name.slice(0, 3).toLowerCase() as DayKey;
}

/** Every date in a YYYY-MM month, as YYYY-MM-DD. */
export function daysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** True when the IANA zone is one Node actually knows. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
