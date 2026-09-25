/* The floor's events are recorded whether or not anyone is watching.
 *
 * They used to be a browser array of the last twelve entries, filled only
 * while the page was open and emptied by a reload — and the gateway
 * returned early when the room was empty, so a night's ringing left no
 * trace at all and there was nothing to report on.
 *
 *   npx tsx scripts/dev/test-floor-events.ts
 */
import "../env";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { db } from "../../src/db/client";
import { sessions, staff, vonageEvents } from "../../src/db/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const [who] = await db.select({ id: staff.id }).from(staff).where(eq(staff.roleId, "super_admin")).limit(1);
  if (!who) throw new Error("no super_admin");

  const token = randomBytes(32).toString("hex");
  const sessionId = createHash("sha256").update(token).digest("hex");
  await db.insert(sessions).values({
    id: sessionId, staffId: who.id, expiresAt: new Date(Date.now() + 15 * 60_000), userAgent: "floor-test",
  });
  const cookie = `cleo_session=${token}`;
  const callUuid = `floor-test-${randomUUID()}`;

  try {
    console.log("\n1. bir cagrinin yasam dongusu kaydediliyor");
    await db.insert(vonageEvents).values([
      { callUuid, eventType: "call.started", locationId: null,
        payload: { direction: "inbound", extension: "447", agent: "Callcenter2", remote: "+15551230001", status: "ringing" } },
      { callUuid, eventType: "call.updated", locationId: null,
        payload: { from: "ringing", to: "on-call", extension: "447", agent: "Callcenter2" } },
      { callUuid, eventType: "call.ended", locationId: null,
        payload: { extension: "447", agent: "Callcenter2", status: "disconnected" } },
    ]);

    const res = await fetch(`${BASE}/api/crm/calls/events?limit=100&hours=1`, { headers: { cookie } });
    const body = (await res.json()) as { events: { callUuid: string; eventType: string; payload: Record<string, unknown> }[] };
    check("200", res.status === 200, String(res.status));

    const mine = body.events.filter((e) => e.callUuid === callUuid);
    check("uc olay da geri geldi", mine.length === 3, `${mine.length}/3`);
    check("en yeni once", mine[0]?.eventType === "call.ended", String(mine[0]?.eventType));
    check("gecis kaydedilmis", mine.some((e) => e.payload.from === "ringing" && e.payload.to === "on-call"));
    check("dahili tasiniyor", mine.every((e) => e.payload.extension === "447"));

    console.log("\n2. sayfa yenilense de duruyorlar");
    const again = await fetch(`${BASE}/api/crm/calls/events?limit=100&hours=1`, { headers: { cookie } });
    const body2 = (await again.json()) as { events: { callUuid: string }[] };
    check("hala orada", body2.events.filter((e) => e.callUuid === callUuid).length === 3);

    console.log("\n3. oturumsuz erisim yok");
    const anon = await fetch(`${BASE}/api/crm/calls/events`);
    check("401/403", anon.status === 401 || anon.status === 403, String(anon.status));

    console.log("\n4. zaman penceresi uygulaniyor");
    await db.insert(vonageEvents).values({
      callUuid: `${callUuid}-old`, eventType: "call.started", payload: {},
      occurredAt: new Date(Date.now() - 48 * 3_600_000),
    });
    const recent = await fetch(`${BASE}/api/crm/calls/events?limit=200&hours=1`, { headers: { cookie } });
    const body3 = (await recent.json()) as { events: { callUuid: string }[] };
    check("48 saat oncesi gelmiyor", !body3.events.some((e) => e.callUuid === `${callUuid}-old`));
  } finally {
    await db.delete(vonageEvents).where(like(vonageEvents.callUuid, "floor-test-%"));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
