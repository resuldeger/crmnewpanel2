import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { artistLocations, artists, availabilityBlocks } from "@/db/schema";
import type { Job, JobResult } from "./types";
import { parseIcs } from "@/server/booking/ics";

/* ── Timely availability, from each artist's iCalendar feed ────────────
 * Timely publishes every staff member's diary as a private .ics URL. That
 * feed is the only part of the Laravel integration worth keeping: the rest
 * of it logged into app.gettimely.com with admin credentials and scraped
 * HTML with regexes, which broke whenever Cloudflare or a template changed
 * — its own code carries retry loops and "default 08:30–22:00 if scraping
 * fails" fallbacks for exactly that.
 *
 * The feed needs no login (the token is in the URL), so this job is just an
 * HTTP GET per artist. Staff, studios and opening hours already came from
 * the database import and do not need scraping to stay current.
 *
 * Each event becomes a block against THAT artist, not the studio: a studio
 * with three artists can run three chairs, and slot computation counts how
 * many are busy rather than closing the day on the first one.
 * ────────────────────────────────────────────────────────────────── */

const FEED_TIMEOUT_MS = 20_000;
/** Timely rate-limits these feeds; the old integration paced at 1.5s.
 *  This is now the GLOBAL gap between requests, not a per-feed pause —
 *  see the pacer below. The rate Timely sees is unchanged. */
const PACE_MS = Number(process.env.TIMELY_FEED_PACE_MS ?? 1_500);
const MAX_429_RETRIES = 3;
/** Nothing before today can affect a bookable slot. */
const PAST_GRACE_MS = 24 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── Reading 127 calendars without blocking on any one of them ─────────
 * The feeds were read one after another with a 1.5-second pause between
 * them: 127 × 1.5s is over three minutes before a single slow feed is
 * counted. And they are slow — a feed that has gone away takes the full
 * 20-second timeout, and roughly a quarter of them are dead, so the job
 * regularly ran for tens of minutes. The worker runs one job at a time,
 * so the SMS queue and the SLA monitor sat behind a stack of HTTP
 * timeouts.
 *
 * The pause is not arbitrary, though: Timely rate-limits these feeds, and
 * they are shared with the studios' own calendar apps, so being banned
 * blinds every studio at once. Overlapping the reads must not turn into
 * hammering.
 *
 * So the two things are separated. Several feeds are in flight at once,
 * which is what stops one dead feed holding up the other 126 — and the
 * REQUESTS are spaced globally, by a shared gate, so Timely still sees the
 * same steady one-every-PACE_MS it saw before. Concurrency buys latency
 * overlap, not extra load.
 * ────────────────────────────────────────────────────────────────── */
const CONCURRENCY = Math.max(1, Number(process.env.TIMELY_FEED_CONCURRENCY ?? 4));

/** Serialises the moment each request leaves, across all workers. */
export function createPacer(gapMs: number) {
  let nextAt = 0;
  return async function wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, nextAt);
    nextAt = at + gapMs;
    if (at > now) await sleep(at - now);
  };
}

/** Runs `worker` over `items`, `limit` at a time, in order of arrival. */
export async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

async function fetchFeed(url: string): Promise<{ body: string } | { error: string }> {
  for (let attempt = 1; attempt <= MAX_429_RETRIES; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "text/calendar, text/plain, */*" },
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      });
    } catch (err) {
      return { error: `network: ${(err as Error).message}` };
    }

    if (res.status === 429) {
      // Backing off rather than hammering: these feeds are shared with the
      // studios' own calendar apps and a ban would blind us entirely.
      await sleep(attempt * 3_000);
      continue;
    }
    if (!res.ok) return { error: `HTTP ${res.status}` };

    const body = await res.text();
    if (!body.includes("BEGIN:VCALENDAR")) return { error: "not an iCalendar document" };
    return { body };
  }
  return { error: "rate limited" };
}

const configured = () => process.env.TIMELY_SYNC_ENABLED === "1";

export const timelySync: Job = {
  name: "timely-sync",
  integration: "timely",
  everyMs: 30 * 60_000,
  requires: configured,

  async run(): Promise<JobResult> {
    /* One row per artist-studio pair: an artist who works at two studios is
       busy at both, and each needs its own block. */
    const roster = await db
      .select({
        artistId: artists.id,
        artistName: artists.name,
        feedUrl: artists.calendarFeedUrl,
        locationId: artistLocations.locationId,
      })
      .from(artists)
      .innerJoin(artistLocations, eq(artistLocations.artistId, artists.id))
      .where(and(isNotNull(artists.calendarFeedUrl), eq(artists.active, true)));

    // Group so each feed is fetched once even when shared across studios.
    const byArtist = new Map<number, { name: string; url: string; locationIds: number[] }>();
    for (const row of roster) {
      if (!row.feedUrl) continue;
      const entry = byArtist.get(row.artistId);
      if (entry) entry.locationIds.push(row.locationId);
      else byArtist.set(row.artistId, { name: row.artistName, url: row.feedUrl, locationIds: [row.locationId] });
    }

    const studioTimezones = new Map<number, string>();
    for (const row of await db.execute<{ id: number; timezone: string }>(
      sql`select id, timezone from locations`,
    ).then((r) => r.rows)) {
      studioTimezones.set(Number(row.id), row.timezone);
    }

    const horizon = new Date(Date.now() + 90 * 86_400_000);
    const floor = new Date(Date.now() - PAST_GRACE_MS);

    let imported = 0;
    let removed = 0;
    let failures = 0;
    let feeds = 0;

    /* The gate keeps the aggregate request rate at what it was when this
       ran one feed at a time, so the only thing that changed for Timely is
       that the gaps are no longer padded by our own waiting. */
    const gate = createPacer(PACE_MS);

    await pool([...byArtist.entries()], CONCURRENCY, async ([artistId, artist]) => {
      feeds += 1;
      await gate();
      const result = await fetchFeed(artist.url);

      if ("error" in result) {
        failures += 1;
        await db
          .update(artists)
          .set({ feedCheckedAt: new Date(), feedError: result.error })
          .where(eq(artists.id, artistId));
        return;
      }

      for (const locationId of artist.locationIds) {
        const tz = studioTimezones.get(locationId) ?? "America/New_York";
        const events = parseIcs(result.body, tz);
        const seen: string[] = [];

        for (const event of events) {
          if (event.cancelled) continue;
          if (event.end < floor || event.start > horizon) continue;

          const externalId = `timely:${artistId}:${locationId}:${event.uid}`;
          seen.push(externalId);

          const written = await db
            .insert(availabilityBlocks)
            .values({
              locationId,
              artistId,
              startsAt: event.start,
              endsAt: event.end,
              source: "timely",
              externalId,
              note: event.summary,
            })
            .onConflictDoUpdate({
              target: [availabilityBlocks.source, availabilityBlocks.externalId],
              set: { startsAt: event.start, endsAt: event.end, note: event.summary },
            })
            .returning({ id: availabilityBlocks.id });
          imported += written.length;
        }

        /* Anything this artist's feed no longer lists has been cancelled or
           moved in Timely, so the chair goes back on sale. Scoped to this
           artist and studio: deleting by studio alone would wipe the blocks
           of every other artist whose feed had not been read yet. */
        const gone = await db
          .delete(availabilityBlocks)
          .where(
            and(
              eq(availabilityBlocks.locationId, locationId),
              eq(availabilityBlocks.artistId, artistId),
              eq(availabilityBlocks.source, "timely"),
              gte(availabilityBlocks.startsAt, floor),
              seen.length > 0
                // sql.param keeps this one bound array; interpolating the
                // list expands it to all(($1,$2,…)), which Postgres rejects.
                ? sql`${availabilityBlocks.externalId} <> all(${sql.param(seen)}::text[])`
                : sql`true`,
            ),
          )
          .returning({ id: availabilityBlocks.id });
        removed += gone.length;
      }

      await db
        .update(artists)
        .set({ feedCheckedAt: new Date(), feedError: null })
        .where(eq(artists.id, artistId));
    });

    return {
      summary: `${feeds} calendar feed(s)`,
      counts: { feeds, imported, removed, failures },
    };
  },
};
