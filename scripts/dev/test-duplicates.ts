/* Duplicates are found across the whole pipeline, not the loaded page.
 *
 * The merge screen grouped the console's own array — the hundred most
 * recent leads — so two records created weeks apart, which is what a
 * duplicate normally is, could not both be in it. The screen then
 * reported a confident count of what it had managed to find.
 *
 *   npx tsx scripts/dev/test-duplicates.ts
 */
import "../env";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../../src/db/client";
import { leads, locations, sessions, staff } from "../../src/db/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const [who] = await db.select({ id: staff.id }).from(staff).where(eq(staff.roleId, "super_admin")).limit(1);
  const [studio] = await db.select({ id: locations.id }).from(locations).limit(1);
  if (!who || !studio) throw new Error("need a super_admin and a studio");

  const token = randomBytes(32).toString("hex");
  const sessionId = createHash("sha256").update(token).digest("hex");
  await db.insert(sessions).values({
    id: sessionId, staffId: who.id, expiresAt: new Date(Date.now() + 15 * 60_000), userAgent: "dup-test",
  });
  const cookie = `cleo_session=${token}`;

  /* Two entries for one person, written 40 days apart — the gap is the
     point. Any window the console could hold in memory would contain one
     of these and not the other. */
  const phone = "+12125550143";
  const old = new Date(Date.now() - 40 * 86_400_000);
  const ids = [`DUPTEST-${randomUUID().slice(0, 8)}`, `DUPTEST-${randomUUID().slice(0, 8)}`];

  try {
    await db.insert(leads).values([
      { id: ids[0], locationId: studio.id, name: "Dup Test One", phoneE164: phone, platform: "webform", createdAt: old },
      { id: ids[1], locationId: studio.id, name: "Dup Test Two", phoneE164: phone, platform: "direct" },
    ]);

    const res = await fetch(`${BASE}/api/crm/leads/duplicates?page_size=50`, { headers: { cookie } });
    const body = (await res.json()) as { total: number; groups: { kind: string; key: string; leads: { id: string; name: string }[] }[] };

    console.log("\n1. 40 gun arayla olusturulan iki kayit");
    check("200", res.status === 200, String(res.status));
    const group = body.groups.find((g) => g.leads.some((l) => l.id === ids[0]));
    check("grup bulundu", !!group, `${body.groups.length} grup, total ${body.total}`);
    check("ikisi de grupta", group?.leads.length === 2, String(group?.leads.length));
    check("telefondan eslesti", group?.kind === "phone", String(group?.kind));
    check("isimler camelCase geldi", group?.leads.every((l) => typeof l.name === "string") === true);

    console.log("\n2. sayac tabloyu anlatiyor");
    const boot = await fetch(`${BASE}/api/crm/bootstrap`, { headers: { cookie } });
    const counters = ((await boot.json()) as { counters: Record<string, number> }).counters;
    check("duplicateGroups >= 1", counters.duplicateGroups >= 1, String(counters.duplicateGroups));

    console.log("\n3. oturumsuz reddediliyor");
    const anon = await fetch(`${BASE}/api/crm/leads/duplicates`);
    check("401/403", anon.status === 401 || anon.status === 403, String(anon.status));
  } finally {
    await db.delete(leads).where(inArray(leads.id, ids));
    await db.delete(leads).where(like(leads.id, "DUPTEST-%"));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
