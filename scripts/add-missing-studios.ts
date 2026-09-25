/* ── Studios Vonage knows and we did not ───────────────────────────────
 * The extension directory listed eight branches with no row of their own,
 * so calls to them were arriving attached to nothing.
 *
 * Only three things are known for certain: the name, the DID and — from
 * the DID's area code — the timezone. Address, opening hours and the rest
 * are not invented here; each is added with booking_active = false so it
 * exists for call attribution while staying out of the public booking
 * flow until someone fills the details in.
 *
 *   npx tsx scripts/add-missing-studios.ts          # what would change
 *   npx tsx scripts/add-missing-studios.ts --write  # apply
 * ────────────────────────────────────────────────────────────────── */
import "./env";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { locations } from "../src/db/schema";

interface NewStudio {
  name: string;
  slug: string;
  city: string;
  state: string;
  timezone: string;
  timezoneFriendly: string;
  branchPhone: string;
  /** The area code the timezone was read from, so the reasoning is on record. */
  areaCode: string;
}

const STUDIOS: NewStudio[] = [
  { name: "Cleopatra Ink Bradenton",     slug: "bradenton",     city: "Bradenton",     state: "FL", timezone: "America/New_York",    timezoneFriendly: "Eastern Time",     branchPhone: "+19412813999", areaCode: "941" },
  { name: "Cleopatra Ink Fort Pierce",   slug: "fort-pierce",   city: "Fort Pierce",   state: "FL", timezone: "America/New_York",    timezoneFriendly: "Eastern Time",     branchPhone: "+17724480910", areaCode: "772" },
  { name: "Cleopatra Ink Orlando",       slug: "orlando",       city: "Orlando",       state: "FL", timezone: "America/New_York",    timezoneFriendly: "Eastern Time",     branchPhone: "+16893581731", areaCode: "689" },
  { name: "Cleopatra Ink St. Augustine", slug: "st-augustine",  city: "St. Augustine", state: "FL", timezone: "America/New_York",    timezoneFriendly: "Eastern Time",     branchPhone: "+19045064191", areaCode: "904" },
  { name: "Cleopatra Ink Fort Sill",     slug: "fort-sill",     city: "Lawton",        state: "OK", timezone: "America/Chicago",     timezoneFriendly: "Central Time",     branchPhone: "+15804073391", areaCode: "580" },
  /* Arizona does not observe daylight saving. Filing Scottsdale under
     America/Denver would put every appointment an hour out for half the
     year, which is exactly the class of bug this column exists to avoid. */
  { name: "Cleopatra Ink Scottsdale",    slug: "scottsdale",    city: "Scottsdale",    state: "AZ", timezone: "America/Phoenix",     timezoneFriendly: "Arizona (no DST)", branchPhone: "+16232544010", areaCode: "623" },
  { name: "Cleopatra Ink JBLM",          slug: "jblm",          city: "Lakewood",      state: "WA", timezone: "America/Los_Angeles", timezoneFriendly: "Pacific Time",     branchPhone: "+12533217378", areaCode: "253" },
  { name: "Cleopatra Ink Rochester",     slug: "rochester",     city: "Rochester",     state: "NY", timezone: "America/New_York",    timezoneFriendly: "Eastern Time",     branchPhone: "+15859197678", areaCode: "585" },
];

async function main() {
  const write = process.argv.includes("--write");

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${locations.displayOrder}), 0)` })
    .from(locations)
    .where(sql`${locations.displayOrder} < 9000`);

  let order = Number(next);
  let added = 0;
  let skipped = 0;

  for (const s of STUDIOS) {
    const [existing] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.slug, s.slug))
      .limit(1);

    if (existing) {
      console.log(`  ${s.slug.padEnd(14)} zaten var (#${existing.id}) — atlandi`);
      skipped += 1;
      continue;
    }

    order += 10;
    console.log(
      `  ${s.slug.padEnd(14)} ${s.city}, ${s.state}  ${s.timezone.padEnd(20)} ` +
        `(alan kodu ${s.areaCode})  ${s.branchPhone}`,
    );

    if (!write) continue;

    await db.insert(locations).values({
      name: s.name,
      slug: s.slug,
      city: s.city,
      state: s.state,
      country: "USA",
      countryCode: "US",
      timezone: s.timezone,
      timezoneFriendly: s.timezoneFriendly,
      branchPhone: s.branchPhone,
      defaultLocale: "en",
      displayOrder: order,
      /* Off until a person supplies the address and the opening hours.
         A studio that takes bookings without hours would offer every slot
         of every day, which is worse than not appearing at all. */
      bookingActive: false,
    });
    added += 1;
  }

  console.log(
    write
      ? `\n${added} sube eklendi, ${skipped} atlandi. Hepsi booking_active=false.`
      : `\nDeneme calistirmasi — hicbir sey yazilmadi. Uygulamak icin --write ekleyin.`,
  );
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
