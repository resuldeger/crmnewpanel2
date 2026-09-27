/**
 * Claims a VBC extension for a member of staff.
 *
 *   npx tsx scripts/dev/link-extension.ts 487 1
 *   npx tsx scripts/dev/link-extension.ts --list
 *
 * "Call back" rings this line first, because it is the only one that person
 * can answer. Without the link it falls back to the branch line and then to
 * a shared call-centre seat — and a seat nobody is sitting at means the
 * customer picks up to silence.
 *
 * `staff_id` is ours: the carrier sync never writes it, so nothing here is
 * overwritten by the hourly directory refresh.
 */
import "../env";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../../src/db/client";
import { extensions, staff } from "../../src/db/schema";

const [a, b] = process.argv.slice(2);

if (a === "--list" || !a) {
  const rows = await db
    .select({
      extension: extensions.extension,
      displayName: extensions.displayName,
      did: extensions.phoneNumber,
      staffId: extensions.staffId,
    })
    .from(extensions)
    .where(isNotNull(extensions.staffId));
  console.log(rows.length === 0 ? "No extension is claimed by anyone yet." : "Claimed extensions:");
  for (const r of rows) console.log(`  ${r.extension}  ${r.displayName}  → staff #${r.staffId}`);
  console.log("\nUsage: npx tsx scripts/dev/link-extension.ts <extension> <staffId>");
  process.exit(0);
}

const staffId = Number(b);
if (!Number.isInteger(staffId)) throw new Error("staffId must be a number — see `--list`");

const [person] = await db.select().from(staff).where(eq(staff.id, staffId)).limit(1);
if (!person) throw new Error(`no staff member with id ${staffId}`);

const [line] = await db.select().from(extensions).where(eq(extensions.extension, a)).limit(1);
if (!line) throw new Error(`no extension ${a} in the directory — run the vonage-directory job first`);

await db.update(extensions).set({ staffId }).where(eq(extensions.extension, a));
console.log(`${a} (${line.displayName}, ${line.phoneNumber ?? "no DID"}) → ${person.name} <${person.email}>`);
process.exit(0);
