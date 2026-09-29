/**
 * Creates an artist for each Timely staff member, and links the two.
 *
 *   npx tsx --env-file=.env.local scripts/dev/link-timely-staff-to-artists.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/dev/link-timely-staff-to-artists.ts
 *
 * The roster sweep deliberately never does this on its own — a scraped
 * staff list turning into rows on our side, unasked, is how a directory
 * fills with people nobody chose. It is a decision, so it is a command.
 *
 * Three choices worth stating:
 *
 * The Timely name is kept verbatim. "Designer Ahmet Onat" reads oddly, but
 * stripping the prefix turns "Designer Augusta" into "Augusta", which is a
 * town rather than a person — those are per-studio accounts, not named
 * individuals. Keeping the name exact also means a later re-match is exact.
 * The prefix becomes a specialty instead, which is what it actually says.
 *
 * artists.calendar_feed_url is left empty. timely_staff.webhook_url already
 * holds the feed and the sync reads it from there; a second copy is a second
 * thing to drift, and it drifted before.
 *
 * Idempotent. A staff member already linked is left alone, so running it
 * again after the next sweep only picks up the new people.
 */
import "../env";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "../../src/db/client";
import { artists, artistLocations, timelyLocations, timelyStaff, timelyStaffLocations } from "../../src/db/schema";

const dryRun = process.argv.includes("--dry-run");

const specialtyFor = (name: string): string[] => {
  if (/^piercer\b/i.test(name)) return ["piercing"];
  if (/designer/i.test(name)) return ["tattoo"];
  return [];
};

const rows = await db
  .select({
    id: timelyStaff.id,
    name: timelyStaff.name,
    email: timelyStaff.email,
    status: timelyStaff.status,
    artistId: timelyStaff.artistId,
  })
  .from(timelyStaff)
  .where(isNull(timelyStaff.artistId));

console.log(`${rows.length} Timely staff with no artist yet`);
if (rows.length === 0) process.exit(0);

/* Timely's own status: 1 is working. Anything else exists in their list but
   is not taking appointments, and an artist switched on here would be
   offered to customers. */
const inactive = rows.filter((r) => r.status !== 1);
console.log(`  ${inactive.length} of them are not active in Timely → created switched off`);

let created = 0;
let linkedStudios = 0;

for (const row of rows) {
  /* A name already on file is reused rather than duplicated — the point is
     one artist per person, not one per sweep. */
  const [existing] = await db.select({ id: artists.id }).from(artists).where(eq(artists.name, row.name)).limit(1);

  let artistId = existing?.id;
  if (!artistId) {
    if (dryRun) { created += 1; continue; }
    const [made] = await db
      .insert(artists)
      .values({
        name: row.name,
        email: row.email,
        specialties: specialtyFor(row.name),
        active: row.status === 1,
      })
      .returning({ id: artists.id });
    artistId = made.id;
    created += 1;
  }

  if (dryRun) continue;

  await db.update(timelyStaff).set({ artistId, linkedAt: new Date() }).where(eq(timelyStaff.id, row.id));

  /* The studios come from the pivot the sweep built, and only those whose
     Timely location has been matched to one of ours. */
  const studios = await db
    .select({ locationId: timelyLocations.locationId })
    .from(timelyStaffLocations)
    .innerJoin(timelyLocations, eq(timelyLocations.id, timelyStaffLocations.locationId))
    .where(and(eq(timelyStaffLocations.staffId, row.id), isNotNull(timelyLocations.locationId)));

  for (const s of studios) {
    if (s.locationId === null) continue;
    await db
      .insert(artistLocations)
      .values({ artistId, locationId: s.locationId })
      .onConflictDoNothing();
    linkedStudios += 1;
  }
}

console.log(dryRun
  ? `\n--dry-run: would create ${created} artist(s). Nothing written.`
  : `\ncreated ${created} artist(s) · ${linkedStudios} artist-studio link(s)`);
process.exit(0);
