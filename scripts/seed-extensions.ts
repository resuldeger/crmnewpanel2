/* Fills the extension directory from what the studios already carry.
 *
 * The live system records one Vonage extension per STUDIO, not per person
 * — 404 is Atlanta's line, not an individual's. The demo rows it replaces
 * invented a call-centre with four agent lines that do not exist.
 *
 * The Vonage webhook resolves a call's studio through this table, so an
 * empty one meant every inbound leg arrived unattributed. Which human sits
 * at a given extension is still unknown; staff_id stays null until someone
 * says. */
import "./env";
import { eq, isNull } from "drizzle-orm";
import { db } from "../src/db/client";
import { extensions, locations } from "../src/db/schema";

async function main() {
  const studios = await db
    .select({ id: locations.id, name: locations.name, vonage: locations.vonage })
    .from(locations);

  let written = 0;
  let skipped = 0;

  for (const studio of studios) {
    const code = (studio.vonage?.extension ?? "").trim();
    if (!code) { skipped += 1; continue; }

    const existing = await db
      .select({ id: extensions.id })
      .from(extensions)
      .where(eq(extensions.extension, code))
      .limit(1);
    if (existing.length > 0) continue;

    await db.insert(extensions).values({
      extension: code,
      displayName: studio.name.replace(/^Cleopatra Ink\s+/i, ""),
      username: `vbc-${code}`,
      phoneNumber: studio.vonage?.did ?? null,
      locationId: studio.id,
      staffId: null,
    });
    written += 1;
  }

  const orphans = await db.select({ id: extensions.id }).from(extensions).where(isNull(extensions.locationId));
  console.log(`${written} dahili yazildi, ${skipped} subede dahili yok, ${orphans.length} sahipsiz`);
  process.exit(0);
}

void main();
