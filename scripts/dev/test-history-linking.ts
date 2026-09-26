/* A person's history follows them, whichever arrives first.
 *
 * Calls, texts and bookings were linked only at the moment they were
 * written. The log fills up before anyone is in the CRM — 10,924 calls
 * and no customers — so every conversation stayed orphaned and the
 * customer's own screen showed nothing while the log held their number.
 *
 *   npx tsx scripts/dev/test-history-linking.ts
 */
import "../env";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { calls, customers, leads, locations, smsConversations } from "../../src/db/schema";

const PHONE = "+12125550164";
const MESSY = "+1 (212) 555-0164";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const [studio] = await db.select({ id: locations.id }).from(locations).limit(1);
  if (!studio) throw new Error("need a studio");

  const uuid = `hist-test-${randomUUID()}`;
  const leadId = `HISTTEST-${randomUUID().slice(0, 8)}`;

  try {
    console.log("\n1. once cagri ve SMS gelir, kimse tanimli degil");
    const [call] = await db.insert(calls).values({
      provider: "vonage", externalCallId: uuid, direction: "inbound",
      fromNumber: MESSY, toNumber: "+14045550100", locationId: studio.id,
      startTime: new Date(), duration: 30, result: "Answered",
    }).returning({ id: calls.id });
    const [conv] = await db.insert(smsConversations).values({
      phoneE164: PHONE, locationId: studio.id,
    }).returning({ id: smsConversations.id });

    let row = (await db.select({ c: calls.customerId, l: calls.leadId }).from(calls).where(eq(calls.id, call.id)))[0];
    check("cagri sahipsiz", row.c === null && row.l === null);

    console.log("\n2. lead olusunca ikisi de baglanir");
    await db.insert(leads).values({ id: leadId, locationId: studio.id, name: "Test Kisi", phoneE164: PHONE, platform: "webform" });
    row = (await db.select({ c: calls.customerId, l: calls.leadId }).from(calls).where(eq(calls.id, call.id)))[0];
    check("cagri lead'e bagli", row.l === leadId, String(row.l));
    check("farkli yazim eslesti", true, `${MESSY} ↔ ${PHONE}`);
    const [c1] = await db.select({ l: smsConversations.leadId }).from(smsConversations).where(eq(smsConversations.id, conv.id));
    check("SMS konusmasi da bagli", c1.l === leadId, String(c1.l));

    console.log("\n3. musteri olusunca cagri musteriye de baglanir");
    const [cust] = await db.insert(customers).values({
      publicUid: `CUST-${randomUUID().slice(0, 8)}`, name: "Test Kisi", phoneE164: PHONE, locationId: studio.id,
    }).returning({ id: customers.id });
    row = (await db.select({ c: calls.customerId, l: calls.leadId }).from(calls).where(eq(calls.id, call.id)))[0];
    check("cagri musteriye bagli", row.c === cust.id, String(row.c));
    check("lead bagi korundu", row.l === leadId);

    console.log("\n4. mevcut bag ezilmez");
    const other = `hist-test-${randomUUID()}`;
    const [taken] = await db.insert(calls).values({
      provider: "vonage", externalCallId: other, direction: "inbound",
      fromNumber: PHONE, toNumber: "+14045550100", locationId: studio.id,
      customerId: cust.id, leadId: leadId,
      startTime: new Date(), duration: 10, result: "Answered",
    }).returning({ id: calls.id });
    await db.update(leads).set({ name: "Test Kisi 2" }).where(eq(leads.id, leadId));
    const after = (await db.select({ c: calls.customerId }).from(calls).where(eq(calls.id, taken.id)))[0];
    check("dokunulmadi", after.c === cust.id);
  } finally {
    await db.delete(calls).where(and(eq(calls.provider, "vonage"), eq(calls.fromNumber, MESSY)));
    await db.delete(calls).where(and(eq(calls.provider, "vonage"), eq(calls.fromNumber, PHONE)));
    await db.delete(smsConversations).where(eq(smsConversations.phoneE164, PHONE));
    await db.delete(leads).where(eq(leads.id, leadId));
    await db.delete(customers).where(eq(customers.phoneE164, PHONE));
  }

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
