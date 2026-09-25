/* ── iCalendar parsing ─────────────────────────────────────────────────
 * Kept apart from the job so it can be exercised without a database or a
 * network: the timezone handling below is the part most likely to be wrong
 * in a way nobody notices until a customer turns up at the wrong hour.
 * ────────────────────────────────────────────────────────────────── */

/* Timely writes TZID with Windows names — "Eastern Standard Time", not
 * "America/New_York". Intl rejects those, so every event with one silently
 * failed to parse and the studio looked completely free.
 *
 * Note the Windows names are not what they sound like: "Eastern Standard
 * Time" means the Eastern zone including its daylight saving, so it maps to
 * America/New_York and NOT to a fixed -05:00. */
const WINDOWS_TIMEZONES: Record<string, string> = {
  "eastern standard time": "America/New_York",
  "us eastern standard time": "America/New_York",
  "central standard time": "America/Chicago",
  "central america standard time": "America/Chicago",
  "mountain standard time": "America/Denver",
  "us mountain standard time": "America/Phoenix",
  "pacific standard time": "America/Los_Angeles",
  "pacific standard time (mexico)": "America/Tijuana",
  "alaskan standard time": "America/Anchorage",
  "hawaiian standard time": "Pacific/Honolulu",
  "atlantic standard time": "America/Halifax",
  "newfoundland standard time": "America/St_Johns",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "Atlantic/Reykjavik",
  "w. europe standard time": "Europe/Berlin",
  "central europe standard time": "Europe/Budapest",
  "central european standard time": "Europe/Warsaw",
  "romance standard time": "Europe/Paris",
  "e. europe standard time": "Europe/Chisinau",
  "gtb standard time": "Europe/Bucharest",
  "turkey standard time": "Europe/Istanbul",
  "arabic standard time": "Asia/Baghdad",
  "arab standard time": "Asia/Riyadh",
  "arabian standard time": "Asia/Dubai",
  "russian standard time": "Europe/Moscow",
  "w. australia standard time": "Australia/Perth",
  "aus eastern standard time": "Australia/Sydney",
  "new zealand standard time": "Pacific/Auckland",
  "tokyo standard time": "Asia/Tokyo",
  "china standard time": "Asia/Shanghai",
  "singapore standard time": "Asia/Singapore",
  "india standard time": "Asia/Kolkata",
  "utc": "UTC",
};

/** A TZID we can hand to Intl, or null when it means nothing to us. */
export function resolveTzid(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const raw = tzid.trim().replace(/^"|"$/g, "");
  const mapped = WINDOWS_TIMEZONES[raw.toLowerCase()];
  if (mapped) return mapped;
  try {
    new Intl.DateTimeFormat("en", { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  cancelled: boolean;
}

/** Unfolds RFC 5545 line continuations: a leading space joins the previous line. */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * DTSTART/DTEND in the three shapes Timely emits.
 *
 * A "floating" time — no Z, no TZID — is the trap: read as UTC it moves a
 * New York booking by five hours, which is how a slot that was taken shows
 * as free. It is resolved in the studio's own zone instead.
 */
function parseIcsDate(value: string, params: string, studioTimezone: string): Date | null {
  const clean = value.trim().replace(/[^0-9TZ]/g, "");
  if (clean.length < 8) return null;

  const y = Number(clean.slice(0, 4));
  const mo = Number(clean.slice(4, 6));
  const d = Number(clean.slice(6, 8));
  if (!y || !mo || !d) return null;

  // All-day: DTSTART;VALUE=DATE:20260924
  if (!clean.includes("T")) return new Date(Date.UTC(y, mo - 1, d));

  const h = Number(clean.slice(9, 11) || "0");
  const mi = Number(clean.slice(11, 13) || "0");
  const se = Number(clean.slice(13, 15) || "0");

  if (clean.endsWith("Z")) return new Date(Date.UTC(y, mo - 1, d, h, mi, se));

  /* An unrecognised TZID falls back to the studio's own zone rather than
     dropping the event: a booking at the wrong hour is a bug, but a booking
     that vanishes sells the slot twice. */
  const tzid = resolveTzid(/TZID=([^:;]+)/i.exec(params)?.[1]);
  return zonedToInstant(y, mo, d, h, mi, se, tzid ?? studioTimezone);
}

/** Wall-clock in a named zone → the UTC instant it refers to. */
function zonedToInstant(
  y: number, mo: number, d: number, h: number, mi: number, se: number, timeZone: string,
): Date | null {
  try {
    const guess = Date.UTC(y, mo - 1, d, h, mi, se);
    // Two passes: the offset itself depends on the date, and a single pass
    // lands an hour out on the days either side of a DST change.
    let instant = guess;
    for (let i = 0; i < 2; i += 1) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).formatToParts(new Date(instant));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
      const asUtc = Date.UTC(
        get("year"), get("month") - 1, get("day"),
        get("hour") % 24, get("minute"), get("second"),
      );
      instant += guess - asUtc;
    }
    return new Date(instant);
  } catch {
    return null;
  }
}

export function parseIcs(body: string, studioTimezone: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: Record<string, { value: string; params: string }> | null = null;

  for (const line of unfold(body)) {
    if (line.startsWith("BEGIN:VEVENT")) { current = {}; continue; }
    if (line.startsWith("END:VEVENT")) {
      if (current) {
        const startField = current.DTSTART;
        const endField = current.DTEND;
        const uid = current.UID?.value?.trim();
        if (startField && uid) {
          const start = parseIcsDate(startField.value, startField.params, studioTimezone);
          // No DTEND means a zero-length event; Timely sends one for some
          // blocks. Treated as half an hour so it still occupies a chair.
          const end = endField
            ? parseIcsDate(endField.value, endField.params, studioTimezone)
            : start && new Date(start.getTime() + 30 * 60_000);
          if (start && end && end.getTime() > start.getTime()) {
            events.push({
              uid,
              start,
              end,
              summary: current.SUMMARY?.value?.trim().slice(0, 200) ?? "Busy",
              cancelled: (current.STATUS?.value ?? "").toUpperCase() === "CANCELLED",
            });
          }
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const rawName = line.slice(0, colon);
    const semi = rawName.indexOf(";");
    const name = (semi === -1 ? rawName : rawName.slice(0, semi)).toUpperCase();
    current[name] = {
      value: line.slice(colon + 1),
      params: semi === -1 ? "" : rawName.slice(semi),
    };
  }

  return events;
}
