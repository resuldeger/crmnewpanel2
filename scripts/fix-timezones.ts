/* Re-applies the timezone correction map to every studio.
 *
 * The live Laravel database stores 21 of the 46 studios as
 * America/New_York regardless of where they are, so importing from it
 * reintroduces the bug. This is the authority instead: the studio's own
 * address decides, with explicit overrides where a state spans zones. */
import "./env";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { locations } from "../src/db/schema";
import { resolveTimezone } from "./timezones";

async function main() {
  const rows = await db
    .select({ id: locations.id, slug: locations.slug, address: locations.address, timezone: locations.timezone })
    .from(locations);

  const changed: string[] = [];
  for (const row of rows) {
    const { timezone, via } = resolveTimezone(row.slug, row.address);
    if (timezone === row.timezone) continue;
    await db.update(locations).set({ timezone, updatedAt: new Date() }).where(eq(locations.id, row.id));
    changed.push(`  ${row.slug.padEnd(20)} ${row.timezone} → ${timezone}  (${via})`);
  }

  console.log(`checked ${rows.length} studio(s), corrected ${changed.length}`);
  for (const line of changed) console.log(line);
  process.exit(0);
}

void main();
