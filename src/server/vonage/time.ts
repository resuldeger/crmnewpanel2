/* ── Vonage timestamps ─────────────────────────────────────────────────
 * Vonage hands us times in three different shapes depending on which API
 * answered, and two of them mislead `new Date()` rather than failing:
 *
 *   Reports    "2026-09-24 22:33:18"   UTC, but with no zone marker — so
 *                                      every JS engine reads it as LOCAL.
 *                                      In Istanbul that is three hours out
 *                                      and nothing looks broken.
 *   Telephony  "1790293069492798"      epoch MICROseconds, as a string.
 *                                      Passed through, it lands in the
 *                                      year 56,000.
 *   Webhooks   "2026-09-24T16:10:06.000+0000"   proper ISO 8601.
 *
 * A single parser covers all three, so a new caller cannot reintroduce
 * either mistake by picking the wrong one. Unreadable input returns null
 * rather than an Invalid Date, which the database driver rejects with an
 * error that names neither the field nor the row.
 * ────────────────────────────────────────────────────────────────── */

/** Digits only: 16 wide is microseconds, 13 is milliseconds, 10 is seconds. */
const EPOCH_LIKE = /^\d{10,19}$/;

/** "YYYY-MM-DD HH:MM:SS" with no zone — Vonage means UTC. */
const ZONELESS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Parses any timestamp Vonage produces.
 *
 * Returns null for "0", empty, or anything unreadable — all of which
 * Vonage uses to mean "not set".
 */
export function parseVonageTime(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (raw === "" || raw === "0") return null;

  if (EPOCH_LIKE.test(raw)) {
    /* Scale by width rather than magnitude: a seconds value and a
       microseconds value are both "a big number", and guessing from size
       alone breaks either side of the year 2001. */
    const digits = raw.length;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms =
      digits >= 16 ? n / 1000 :      // microseconds
      digits >= 13 ? n :             // milliseconds
      n * 1000;                      // seconds
    const d = new Date(Math.round(ms));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /* No zone means UTC here, so say so explicitly rather than letting the
     runtime assume the server's own timezone. */
  const candidate = ZONELESS.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The window format the Reports API expects: "YYYY-MM-DD HH:MM:SS" in UTC. */
export const toVonageWindow = (d: Date): string =>
  d.toISOString().replace("T", " ").slice(0, 19);
