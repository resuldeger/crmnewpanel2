import { and, eq, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  artists,
  locations,
  timelyAccounts,
  timelyLocations,
  timelyStaff,
  timelyStaffLocations,
  type BusinessHours,
} from "@/db/schema";
import { TimelySession, sleep, PAGE_PAUSE_MS, type TimelyAccountRow } from "./client";
import {
  scrapeLocations,
  scrapeLocationHours,
  scrapeStaff,
  scrapeStaffDetails,
} from "./scrape";

export interface SyncRosterResult {
  accountId: number;
  label: string;
  ok: boolean;
  locationsCount: number;
  staffCount: number;
  error?: string;
}

/**
 * Scrapes studios, opening hours, staff members, their assigned studios
 * and their secret .ics calendar URLs from one or all active Timely accounts.
 *
 * Ground rules:
 * 1. Timely staff members are NEVER automatically created in the `artists` table.
 *    They live in `timely_staff` and can be auto-matched to existing artists or
 *    manually mapped in the CRM.
 * 2. Unmapped studios are candidate-matched once by slug/name against our `locations`.
 * 3. Deep staff scraping (visiting each staff's edit page for the .ics URL) is paced
 *    with pauses to respect rate limits.
 */
export async function syncTimelyRoster(targetAccountId?: number): Promise<SyncRosterResult[]> {
  const accounts = targetAccountId
    ? await db
        .select()
        .from(timelyAccounts)
        .where(and(eq(timelyAccounts.active, true), eq(timelyAccounts.id, targetAccountId)))
    : await db.select().from(timelyAccounts).where(eq(timelyAccounts.active, true));

  const results: SyncRosterResult[] = [];

  // Load existing studios and artists for candidate matching
  const allStudios = await db.select({ id: locations.id, slug: locations.slug, name: locations.name }).from(locations);
  const allArtists = await db.select({ id: artists.id, name: artists.name, email: artists.email }).from(artists);

  for (const acct of accounts) {
    const session = new TimelySession(acct as TimelyAccountRow);
    const loginRes = await session.ensureLoggedIn();
    if (!loginRes.ok) {
      await db.update(timelyAccounts).set({ lastError: loginRes.detail, updatedAt: new Date() }).where(eq(timelyAccounts.id, acct.id));
      results.push({
        accountId: acct.id,
        label: acct.label,
        ok: false,
        locationsCount: 0,
        staffCount: 0,
        error: loginRes.detail,
      });
      continue;
    }

    try {
      // ── 1. Scrape Studios ──────────────────────────────────────────
      const locRes = await scrapeLocations(session);
      if (!locRes.ok) {
        throw new Error(`Failed to scrape locations: ${locRes.detail}`);
      }

      const timelyLocMap = new Map<string, number>(); // timelyId -> local timelyLocations.id

      /* Timely's slot length is not scraped any more. The page the Laravel
         integration read it from — /Setup/CalendarSettings — answers 404, as
         do the obvious alternatives, and it is not on the location page
         either. It was only ever a default, and the booking engine uses our
         own locations.booking_interval_min, so the column stays null rather
         than carrying an invented 30. */
      const slotMinutes: number | null = null;

      for (const loc of locRes.locations) {
        await sleep(PAGE_PAUSE_MS);
        const hoursRes = await scrapeLocationHours(session, loc.timelyId);

        const hours = hoursRes.ok ? hoursRes.hours : {};

        // Find existing record
        const [existing] = await db
          .select()
          .from(timelyLocations)
          .where(and(eq(timelyLocations.accountId, acct.id), eq(timelyLocations.timelyId, loc.timelyId)))
          .limit(1);

        let locationId = existing?.locationId ?? null;
        let linkedAt = existing?.linkedAt ?? null;
        let linkedByName = existing?.linkedByName ?? null;

        /* Suggested only for a studio nobody has ruled on yet. `existing`
           with no locationId is somebody's deliberate "not this one", and
           re-matching it on a name would undo that quietly on every sweep —
           which is the opposite of mapping once. */
        if (!locationId && !existing) {
          const matched = allStudios.find(
            (s) => s.slug.toLowerCase() === loc.slug.toLowerCase() || s.name.toLowerCase() === loc.name.toLowerCase(),
          );
          if (matched) {
            locationId = matched.id;
            linkedAt = new Date();
            linkedByName = "auto-match";
          }
        }

        const [savedLoc] = await db
          .insert(timelyLocations)
          .values({
            accountId: acct.id,
            timelyId: loc.timelyId,
            name: loc.name,
            address: loc.address,
            slug: loc.slug,
            businessHours: hours as Partial<BusinessHours>,
            slotMinutes,
            locationId,
            linkedAt,
            linkedByName,
            seenAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [timelyLocations.accountId, timelyLocations.timelyId],
            set: {
              name: loc.name,
              address: loc.address,
              slug: loc.slug,
              businessHours: Object.keys(hours).length > 0 ? (hours as Partial<BusinessHours>) : sql`${timelyLocations.businessHours}`,
              slotMinutes: slotMinutes ?? sql`${timelyLocations.slotMinutes}`,
              locationId: locationId ?? sql`${timelyLocations.locationId}`,
              linkedAt: linkedAt ?? sql`${timelyLocations.linkedAt}`,
              linkedByName: linkedByName ?? sql`${timelyLocations.linkedByName}`,
              seenAt: new Date(),
            },
          })
          .returning({ id: timelyLocations.id, timelyId: timelyLocations.timelyId });

        if (savedLoc) {
          timelyLocMap.set(savedLoc.timelyId, savedLoc.id);
        }
      }

      // ── 2. Scrape Staff List ───────────────────────────────────────
      await sleep(PAGE_PAUSE_MS);
      const staffRes = await scrapeStaff(session);
      if (!staffRes.ok) {
        throw new Error(`Failed to scrape staff: ${staffRes.detail}`);
      }

      for (const s of staffRes.staff) {
        const [existing] = await db
          .select()
          .from(timelyStaff)
          .where(and(eq(timelyStaff.accountId, acct.id), eq(timelyStaff.timelyId, s.timelyId)))
          .limit(1);

        let artistId = existing?.artistId ?? null;
        let linkedAt = existing?.linkedAt ?? null;

        // Auto-match with existing artist if unmapped (never create new artists)
        if (!artistId) {
          const cleanName = s.name.trim().toLowerCase();
          const matched = allArtists.find(
            (a) =>
              a.name.trim().toLowerCase() === cleanName ||
              (s.email && a.email && a.email.trim().toLowerCase() === s.email.trim().toLowerCase()),
          );
          if (matched) {
            artistId = matched.id;
            linkedAt = new Date();
          }
        }

        const [savedStaff] = await db
          .insert(timelyStaff)
          .values({
            accountId: acct.id,
            timelyId: s.timelyId,
            name: s.name,
            email: s.email,
            status: s.status,
            artistId,
            linkedAt,
            seenAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [timelyStaff.accountId, timelyStaff.timelyId],
            set: {
              name: s.name,
              email: s.email,
              status: s.status,
              artistId: artistId ?? sql`${timelyStaff.artistId}`,
              linkedAt: linkedAt ?? sql`${timelyStaff.linkedAt}`,
              seenAt: new Date(),
            },
          })
          .returning({ id: timelyStaff.id, timelyId: timelyStaff.timelyId, artistId: timelyStaff.artistId });

        // ── 3. Deep Scrape Staff Details (ICS URL & Assigned Studios) ──
        await sleep(PAGE_PAUSE_MS);
        const detailsRes = await scrapeStaffDetails(session, s.timelyId);
        if (detailsRes.ok) {
          const { webhookUrl, syncEnabled, locationIds } = detailsRes.details;

          /* Said plainly, because it is the one thing a human has to go and
             fix: with sync off there is no feed to read, and the reason is a
             checkbox on this person's Timely page, not a broken URL. */
          await db
            .update(timelyStaff)
            .set({
              webhookUrl,
              calendarSyncEnabled: syncEnabled,
              /* With sync on, the feed's own sweep owns these two columns and
                 the roster must not overwrite what it last recorded. With sync
                 off there is no sweep to do it, so the roster answers here. */
              ...(syncEnabled === false
                ? { webhookError: "calendar sync is off in Timely", webhookCheckedAt: new Date() }
                : {}),
              seenAt: new Date(),
            })
            .where(eq(timelyStaff.id, savedStaff.id));

          /* The scraped URL is not copied onto the artist. It used to be, and
             a second copy is a second thing that goes stale: when somebody
             unticks calendar sync at Timely we clear it here, and the artist's
             copy would live on and be fetched — the same dead address coming
             back through the other door. timely_staff.webhook_url is the one
             the sweep reads for a scraped feed. artists.calendar_feed_url
             stays for a URL a human pasted in by hand, which is theirs to
             manage and not ours to overwrite. */

          // Update assigned studios pivot
          const localLocIds = locationIds
            .map((tid) => timelyLocMap.get(tid))
            .filter((id): id is number => typeof id === "number");

          /* One transaction: the delete and the inserts are a replacement,
             and a failure between them leaves the person working nowhere —
             which reads as "available everywhere" to the booking engine. */
          if (localLocIds.length > 0) {
            await db.transaction(async (tx) => {
              await tx.delete(timelyStaffLocations).where(eq(timelyStaffLocations.staffId, savedStaff.id));
              await tx
                .insert(timelyStaffLocations)
                .values(localLocIds.map((locId) => ({ staffId: savedStaff.id, locationId: locId })))
                .onConflictDoNothing();
            });
          }
        }
      }

      await session.persist({ lastSyncAt: new Date(), lastError: null });

      results.push({
        accountId: acct.id,
        label: acct.label,
        ok: true,
        locationsCount: locRes.locations.length,
        staffCount: staffRes.staff.length,
      });
    } catch (err) {
      const msg = (err as Error).message;
      await session.persist({ lastError: msg });
      results.push({
        accountId: acct.id,
        label: acct.label,
        ok: false,
        locationsCount: 0,
        staffCount: 0,
        error: msg,
      });
    }
  }

  return results;
}
