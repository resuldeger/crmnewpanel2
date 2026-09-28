import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  artistLocations,
  artists,
  availabilityBlocks,
  timelyLocations,
  timelyStaff,
  timelyStaffLocations,
} from "@/db/schema";
import type { Job, JobResult } from "./types";
import { parseIcs } from "@/server/booking/ics";

/* ── Timely availability from iCalendar feeds ──────────────────────────
 * Reads each staff member's / artist's private .ics calendar feed and
 * mirrors busy blocks into `availability_blocks`.
 *
 * Each event becomes a busy block against that studio and artist (if mapped),
 * preventing double bookings on the public booking engine.
 * ────────────────────────────────────────────────────────────────── */

const FEED_TIMEOUT_MS = 20_000;
const PACE_MS = Number(process.env.TIMELY_FEED_PACE_MS ?? 1_500);
const MAX_429_RETRIES = 3;
const PAST_GRACE_MS = 24 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

interface SyncTarget {
  key: string;
  name: string;
  url: string;
  artistId: number | null;
  timelyStaffId: number | null;
  locationIds: number[];
}

export const timelySync: Job = {
  name: "timely-sync",
  integration: "timely",
  everyMs: 30 * 60_000,
  requires: configured,

  async run(): Promise<JobResult> {
    const targets = new Map<string, SyncTarget>();

    // 1. Gather feeds from artists table
    const artistRoster = await db
      .select({
        artistId: artists.id,
        artistName: artists.name,
        feedUrl: artists.calendarFeedUrl,
        locationId: artistLocations.locationId,
      })
      .from(artists)
      .leftJoin(artistLocations, eq(artistLocations.artistId, artists.id))
      .where(and(isNotNull(artists.calendarFeedUrl), eq(artists.active, true)));

    for (const row of artistRoster) {
      if (!row.feedUrl) continue;
      const key = `artist:${row.artistId}`;
      const existing = targets.get(key);
      if (existing) {
        if (row.locationId && !existing.locationIds.includes(row.locationId)) existing.locationIds.push(row.locationId);
      } else {
        targets.set(key, {
          key,
          name: row.artistName,
          url: row.feedUrl,
          artistId: row.artistId,
          timelyStaffId: null,
          locationIds: row.locationId ? [row.locationId] : [],
        });
      }
    }

    // 2. Gather feeds from timely_staff table (including those mapped to studios via timely_locations)
    const timelyStaffRows = await db
      .select({
        staffId: timelyStaff.id,
        staffName: timelyStaff.name,
        webhookUrl: timelyStaff.webhookUrl,
        artistId: timelyStaff.artistId,
        localLocationId: timelyLocations.locationId,
      })
      .from(timelyStaff)
      .innerJoin(timelyStaffLocations, eq(timelyStaffLocations.staffId, timelyStaff.id))
      .innerJoin(timelyLocations, eq(timelyLocations.id, timelyStaffLocations.locationId))
      .where(and(isNotNull(timelyStaff.webhookUrl), isNotNull(timelyLocations.locationId)));

    /* ── Only diaries we can attribute to a chair ──────────────────
     * A block with no artist_id is counted by the booking engine as one
     * seat used, and unattributed blocks do not dedupe — so two overlapping
     * entries from ONE person's calendar would use both chairs at a studio
     * whose capacity is two, and close it. With 126 Timely staff and none
     * of them mapped, a sweep would have shut most of the chain.
     *
     * So an unmapped person's calendar is not written. It is not that their
     * time is not really busy; it is that we cannot say whose chair it
     * occupies, and guessing costs real bookings. Map them to an artist and
     * the diary starts counting.
     */
    let unmapped = 0;

    for (const row of timelyStaffRows) {
      if (!row.webhookUrl || !row.localLocationId) continue;
      if (!row.artistId) {
        unmapped += 1;
        continue;
      }
      // If mapped to an artist that already has target, merge studio location
      const artistKey = row.artistId ? `artist:${row.artistId}` : null;
      if (artistKey && targets.has(artistKey)) {
        const t = targets.get(artistKey)!;
        if (!t.locationIds.includes(row.localLocationId)) t.locationIds.push(row.localLocationId);
        t.timelyStaffId = row.staffId;
        continue;
      }

      const key = `timely_staff:${row.staffId}`;
      const existing = targets.get(key);
      if (existing) {
        if (!existing.locationIds.includes(row.localLocationId)) existing.locationIds.push(row.localLocationId);
      } else {
        targets.set(key, {
          key,
          name: row.staffName,
          url: row.webhookUrl,
          artistId: row.artistId,
          timelyStaffId: row.staffId,
          locationIds: [row.localLocationId],
        });
      }
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

    const gate = createPacer(PACE_MS);

    await pool([...targets.values()], CONCURRENCY, async (target) => {
      feeds += 1;
      await gate();
      const result = await fetchFeed(target.url);

      if ("error" in result) {
        failures += 1;
        if (target.artistId) {
          await db
            .update(artists)
            .set({ feedCheckedAt: new Date(), feedError: result.error })
            .where(eq(artists.id, target.artistId));
        }
        if (target.timelyStaffId) {
          await db
            .update(timelyStaff)
            .set({ webhookCheckedAt: new Date(), webhookError: result.error })
            .where(eq(timelyStaff.id, target.timelyStaffId));
        }
        return;
      }

      for (const locationId of target.locationIds) {
        const tz = studioTimezones.get(locationId) ?? "America/New_York";
        const events = parseIcs(result.body, tz);
        const seen: string[] = [];

        for (const event of events) {
          if (event.cancelled) continue;
          if (event.end < floor || event.start > horizon) continue;

          const actorTag = target.artistId ? `art:${target.artistId}` : `ts:${target.timelyStaffId}`;
          const externalId = `timely:${actorTag}:${locationId}:${event.uid}`;
          seen.push(externalId);

          const written = await db
            .insert(availabilityBlocks)
            .values({
              locationId,
              artistId: target.artistId ?? null,
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

        // Clean up events removed from this feed
        const actorTag = target.artistId ? `art:${target.artistId}` : `ts:${target.timelyStaffId}`;
        const gone = await db
          .delete(availabilityBlocks)
          .where(
            and(
              eq(availabilityBlocks.locationId, locationId),
              target.artistId ? eq(availabilityBlocks.artistId, target.artistId) : sql`true`,
              eq(availabilityBlocks.source, "timely"),
              sql`${availabilityBlocks.externalId} LIKE ${'timely:' + actorTag + ':%'}`,
              gte(availabilityBlocks.startsAt, floor),
              seen.length > 0
                ? sql`${availabilityBlocks.externalId} <> all(${sql.param(seen)}::text[])`
                : sql`true`,
            ),
          )
          .returning({ id: availabilityBlocks.id });
        removed += gone.length;
      }

      if (target.artistId) {
        await db
          .update(artists)
          .set({ feedCheckedAt: new Date(), feedError: null })
          .where(eq(artists.id, target.artistId));
      }
      if (target.timelyStaffId) {
        await db
          .update(timelyStaff)
          .set({ webhookCheckedAt: new Date(), webhookError: null })
          .where(eq(timelyStaff.id, target.timelyStaffId));
      }
    });

    /* Said out loud. "0 feeds" with 126 people on file reads as a broken
       job; "126 skipped, nobody mapped" reads as the work it is waiting on. */
    return {
      summary: unmapped > 0
        ? `${feeds} calendar feed(s) · ${unmapped} skipped — not mapped to an artist`
        : `${feeds} calendar feed(s)`,
      counts: { feeds, imported, removed, failures, unmappedStaff: unmapped },
    };
  },
};

