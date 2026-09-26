/* Our own name for a caller beats the carrier's.
 *
 * The CNAM lookup the US networks keep returns "WIRELESS CALLER" when it
 * has no entry and surname-first capitals when it does, and it cannot know
 * the number belongs to someone we booked last month.
 *
 *   npx tsx scripts/dev/test-caller-name.ts
 */
import "../env";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { calls, customers, leads, locations, sessions, staff } from "../../src/db/schema";
import { knownCaller, forgetCallerName } from "../../src/server/vonage/callerName";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const PHONE = "+12125550177";

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
    id: sessionId, staffId: who.id, expiresAt: new Date(Date.now() + 15 * 60_000), userAgent: "name-test",
  });
  const cookie = `cleo_session=${token}`;

  const callUuid = `name-test-${randomUUID()}`;
  const leadId = `NAMETEST-${randomUUID().slice(0, 8)}`;
  const [call] = await db.insert(calls).values({
    provider: "vonage", externalCallId: callUuid, direction: "inbound",
    fromNumber: PHONE, toNumber: "+14045550100", fromName: "WIRELESS CALLER",
    locationId: studio.id, startTime: new Date(), duration: 40, result: "Answered",
  }).returning({ id: calls.id });

  try {
    console.log("\n1. taniyamadigimiz numara");
    forgetCallerName(PHONE);
    check("kayit yok", (await knownCaller(PHONE)) === null);

    console.log("\n2. lead olusunca lead'in adi");
    await db.insert(leads).values({ id: leadId, locationId: studio.id, name: "Ayse Yilmaz", phoneE164: PHONE, platform: "webform" });
    forgetCallerName(PHONE);
    let found = await knownCaller(PHONE);
    check("lead bulundu", found?.kind === "lead" && found.name === "Ayse Yilmaz", JSON.stringify(found));

    console.log("\n3. musteri lead'i yener");
    const [cust] = await db.insert(customers).values({ publicUid: `CUST-${randomUUID().slice(0, 8)}`, name: "Ayse Yilmaz Kaya", phoneE164: PHONE, locationId: studio.id }).returning({ id: customers.id });
    forgetCallerName(PHONE);
    found = await knownCaller(PHONE);
    check("musteri onde", found?.kind === "customer" && found.name === "Ayse Yilmaz Kaya", JSON.stringify(found));

    console.log("\n4. cagri kaydinda operatorun adi degil bizimki gorunuyor");
    const res = await fetch(`${BASE}/api/crm/calls?page_size=200&days=36500&q=${PHONE.slice(-7)}`, { headers: { cookie } });
    const body = (await res.json()) as { calls: { id: number; fromName: string | null; knownName: string | null }[] };
    const mine = body.calls.find((c) => c.id === call.id);
    check("cagri bulundu", !!mine, `${body.calls.length} satir`);
    check("bizim adimiz dondu", mine?.knownName === "Ayse Yilmaz Kaya", String(mine?.knownName));
    check("operatorun adi hala duruyor", mine?.fromName === "WIRELESS CALLER", String(mine?.fromName));

    console.log("\n5. kisa numaralar sorgulanmiyor");
    check("dahili null", (await knownCaller("447")) === null);
  } finally {
    await db.delete(calls).where(and(eq(calls.provider, "vonage"), eq(calls.externalCallId, callUuid)));
    await db.delete(leads).where(eq(leads.id, leadId));
    await db.delete(customers).where(eq(customers.phoneE164, PHONE));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    forgetCallerName(PHONE);
  }

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
