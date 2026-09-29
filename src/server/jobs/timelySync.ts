import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
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

/* ── One target per artist, however many calendars they have ───────────
 * Timely carries some people twice, under two ids with two diaries — the
 * chain has at least one. Both map to one artist, and both used to become
 * their own target.
 *
 * That quietly lost a diary. Blocks are tagged `timely:art:<id>:<loc>:<uid>`
 * and the cleanup removes every block under that tag which the feed it just
 * read did not mention. Two targets share one tag, so whichever finished
 * second deleted the first one's work — and with one of the two calendars
 * empty, the answer was simply "no blocks", every sweep, depending on which
 * of the two happened to land last.
 *
 * Measured before this changed: artist 229 held 1 block, and running the
 * empty feed's cleanup removed it.
 *
 * So the feeds are collected here and read together, and the cleanup runs
 * once, after all of them, against everything they mentioned between them.
 */
interface SyncTarget {
  key: string;
  name: string;
  urls: string[];
  /* Never null. A diary we cannot attribute to a chair is not swept at all
     — see the guard below — so by the time a target exists it has an artist. */
  artistId: number;
  timelyStaffIds: number[];
  locationIds: number[];
}

export interface ArtistFeedRow {
  artistId: number;
  artistName: string;
  feedUrl: string | null;
  locationId: number | null;
}

export interface StaffFeedRow {
  staffId: number;
  staffName: string;
  webhookUrl: string | null;
  artistId: number | null;
  localLocationId: number | null;
}

/**
 * Who to read, and which calendars belong to them.
 *
 * Pure, and exported, so the rule that cost a diary can be tested without a
 * database: everything below is about not writing a block we cannot attribute
 * and not letting one person's two calendars delete each other.
 */
export function buildTargets(
  artistRows: ArtistFeedRow[],
  staffRows: StaffFeedRow[],
): { targets: SyncTarget[]; unmapped: number } {
  const targets = new Map<string, SyncTarget>();

  const add = (artistId: number, name: string, url: string, locationId: number | null, staffId: number | null) => {
    const key = `artist:${artistId}`;
    let t = targets.get(key);
    if (!t) {
      t = { key, name, urls: [], artistId, timelyStaffIds: [], locationIds: [] };
      targets.set(key, t);
    }
    if (!t.urls.includes(url)) t.urls.push(url);
    if (locationId !== null && !t.locationIds.includes(locationId)) t.locationIds.push(locationId);
    if (staffId !== null && !t.timelyStaffIds.includes(staffId)) t.timelyStaffIds.push(staffId);
  };

  for (const row of artistRows) {
    if (!row.feedUrl) continue;
    add(row.artistId, row.artistName, row.feedUrl, row.locationId, null);
  }

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
  const unmappedStaff = new Set<number>();
  for (const row of staffRows) {
    if (!row.webhookUrl || row.localLocationId === null) continue;
    if (!row.artistId) {
      unmappedStaff.add(row.staffId);
      continue;
    }
    add(row.artistId, row.staffName, row.webhookUrl, row.localLocationId, row.staffId);
  }

  return { targets: [...targets.values()], unmapped: unmappedStaff.size };
}

export const timelySync: Job = {
  name: "timely-sync",
  integration: "timely",
  everyMs: 30 * 60_000,
  requires: configured,

  async run(): Promise<JobResult> {
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

    const { targets, unmapped } = buildTargets(artistRoster, timelyStaffRows);

    /* Counted, not guessed at. A staff member with "Enable calendar sync"
       unticked in Timely has no feed to read at all, so they never become a
       target — and "78 feeds" would quietly stand in for a chain where 30
       diaries are unread. Somebody has to tick those boxes; saying the number
       is how they find out. */
    const [{ count: syncOff = 0 } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(timelyStaff)
      .where(eq(timelyStaff.calendarSyncEnabled, false));

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

    await pool(targets, CONCURRENCY, async (target) => {
      /* Every calendar this person has, read before anything is deleted.
         The cleanup below removes what no feed mentioned, and doing it per
         feed is what let a second diary erase the first. */
      const bodies: string[] = [];
      let feedError: string | null = null;

      for (const url of target.urls) {
        feeds += 1;
        await gate();
        const result = await fetchFeed(url);
        if ("error" in result) {
          failures += 1;
          feedError = result.error;
        } else {
          bodies.push(result.body);
        }
      }

      /* One unreadable feed out of two is not a reason to treat the other as
         empty: that would delete real appointments on the strength of a
         timeout. The error is recorded, what did arrive is written, and
         nothing is removed until every feed has answered. */
      if (bodies.length === 0) {
        await db
          .update(artists)
          .set({ feedCheckedAt: new Date(), feedError })
          .where(eq(artists.id, target.artistId));
        if (target.timelyStaffIds.length > 0) {
          await db
            .update(timelyStaff)
            .set({ webhookCheckedAt: new Date(), webhookError: feedError })
            .where(inArray(timelyStaff.id, target.timelyStaffIds));
        }
        return;
      }

      const partial = feedError !== null;

      for (const locationId of target.locationIds) {
        const tz = studioTimezones.get(locationId) ?? "America/New_York";
        const seen: string[] = [];

        for (const body of bodies) {
          for (const event of parseIcs(body, tz)) {
            if (event.cancelled) continue;
            if (event.end < floor || event.start > horizon) continue;

            const externalId = `timely:art:${target.artistId}:${locationId}:${event.uid}`;
            seen.push(externalId);

            const written = await db
              .insert(availabilityBlocks)
              .values({
                locationId,
                artistId: target.artistId,
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
        }

        /* Skipped when a feed failed. Deleting on a partial read would cancel
           the missing diary's appointments and open a chair that is taken. */
        if (partial) continue;

        const gone = await db
          .delete(availabilityBlocks)
          .where(
            and(
              eq(availabilityBlocks.locationId, locationId),
              eq(availabilityBlocks.artistId, target.artistId),
              eq(availabilityBlocks.source, "timely"),
              sql`${availabilityBlocks.externalId} LIKE ${`timely:art:${target.artistId}:%`}`,
              gte(availabilityBlocks.startsAt, floor),
              seen.length > 0
                ? sql`${availabilityBlocks.externalId} <> all(${sql.param(seen)}::text[])`
                : sql`true`,
            ),
          )
          .returning({ id: availabilityBlocks.id });
        removed += gone.length;
      }

      /* The error from a feed that failed is kept even though the others
         read fine — clearing it would hide a diary that is not being read
         behind the ones that are. */
      await db
        .update(artists)
        .set({ feedCheckedAt: new Date(), feedError })
        .where(eq(artists.id, target.artistId));
      if (target.timelyStaffIds.length > 0) {
        await db
          .update(timelyStaff)
          .set({ webhookCheckedAt: new Date(), webhookError: feedError })
          .where(inArray(timelyStaff.id, target.timelyStaffIds));
      }
    });

    /* Said out loud. "0 feeds" with 126 people on file reads as a broken
       job; "126 skipped, nobody mapped" reads as the work it is waiting on. */
    const notes: string[] = [];
    if (unmapped > 0) notes.push(`${unmapped} skipped — not mapped to an artist`);
    if (syncOff > 0) notes.push(`${syncOff} with calendar sync off in Timely`);

    return {
      summary: [`${feeds} calendar feed(s)`, ...notes].join(" · "),
      counts: { feeds, imported, removed, failures, unmappedStaff: unmapped, syncOff },
    };
  },
};

