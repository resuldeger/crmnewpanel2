/* ── Slot labelling ────────────────────────────────────────────────────
 * A slot is a moment in time. The studio's diary shows it in the studio's
 * zone; the visitor should see it in theirs. Sending only the studio-local
 * string meant an Istanbul customer read a Tacoma "10:00" as their own
 * 10:00, when it was 20:00 for them — they booked the wrong hour.
 * ────────────────────────────────────────────────────────────────── */

/** "17:00" for the given instant, in the given IANA zone. */
export function labelInZone(isoInstant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(isoInstant));
  } catch {
    return isoInstant.slice(11, 16);
  }
}

/** Calendar date (YYYY-MM-DD) of the instant in the given zone. */
export function dateInZone(isoInstant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(isoInstant));
  } catch {
    return isoInstant.slice(0, 10);
  }
}

/**
 * True when the slot lands on a different calendar day for the visitor
 * than it does for the studio — worth saying out loud, because "Thursday
 * 23:30" in Tacoma is Friday morning in Istanbul.
 */
export function crossesDay(isoInstant: string, studioTz: string, visitorTz: string): boolean {
  return dateInZone(isoInstant, studioTz) !== dateInZone(isoInstant, visitorTz);
}

/** Short zone name for a label, e.g. "GMT+3". */
export function zoneAbbr(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}
