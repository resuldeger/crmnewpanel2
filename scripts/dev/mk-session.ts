/* A short-lived console session, for driving the UI in a check.
 *   npx tsx scripts/dev/mk-session.ts   → prints the cookie value
 */
import "../env";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { sessions, staff } from "../../src/db/schema";

async function main() {
  const [who] = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(eq(staff.roleId, "super_admin"))
    .limit(1);
  if (!who) throw new Error("no super_admin on file");

  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    id: createHash("sha256").update(token).digest("hex"),
    staffId: who.id,
    expiresAt: new Date(Date.now() + 60 * 60_000),
    userAgent: "ui-check",
  });
  console.log(token);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
