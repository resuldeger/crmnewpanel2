/* ── Asking for a year without asking for a year ───────────────────────
 * The reservation endpoint takes a start and an end date and will happily
 * be handed a decade. It should not be. A single huge window is one
 * request that times out, retries from the beginning, and tells you
 * nothing about how far it got — and when it does answer, it answers with
 * everything at once.
 *
 * So a range is cut into windows. Each one is small enough to succeed on
 * its own, and a window that fails is a window that can be retried without
 * discarding the ones that worked.
 * ────────────────────────────────────────────────────────────────── */

export interface DateWindow {
  /** Inclusive, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive, `YYYY-MM-DD`. */
  end: string;
}

const DAY_MS = 86_400_000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Cuts `[from, to]` into inclusive windows of at most `days` each.
 *
 * Both ends are inclusive because that is what the endpoint means by them:
 * asking for the 1st to the 1st returns the 1st, and a half-open window
 * here would drop a day at every seam.
 */
export function dateWindows(from: Date | string, to: Date | string, days = 7): DateWindow[] {
  const start = new Date(typeof from === "string" ? `${from}T00:00:00Z` : from);
  const end = new Date(typeof to === "string" ? `${to}T00:00:00Z` : to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("dateWindows needs two real dates");
  }
  if (end < start) return [];
  const span = Math.max(1, Math.floor(days));

  const out: DateWindow[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (cursor <= last) {
    /* span - 1, because both ends count: a 7-day window starting Monday
       ends on Sunday, not the following Monday. */
    const windowEnd = new Date(Math.min(cursor.getTime() + (span - 1) * DAY_MS, last.getTime()));
    out.push({ start: iso(cursor), end: iso(windowEnd) });
    cursor = new Date(windowEnd.getTime() + DAY_MS);
  }
  return out;
}
