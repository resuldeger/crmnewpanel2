/* A human's verdict on a call outlives the carrier's.
 *
 * Vonage reports an outbound leg that reached the customer's voicemail as
 * "Answered" — from its side the far end did pick up — and no field
 * separates that from a real conversation. The desk corrects it by
 * listening, and the next webhook delivery must not quietly undo them.
 *
 *   npx tsx scripts/dev/test-call-result-override.ts
 */
import "../env";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { activityLog, calls, sessions, staff, webhookDeliveries } from "../../src/db/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.VONAGE_SIGNATURE_SECRET ?? "";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(body: string): string {
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({ iat: Math.floor(Date.now() / 1000), payload_hash: createHash("sha256").update(body, "utf8").digest("hex") });
  return `${header}.${payload}.${createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url")}`;
}

async function main() {
  const [who] = await db.select({ id: staff.id }).from(staff).where(eq(staff.roleId, "super_admin")).limit(1);
  if (!who) throw new Error("no super_admin");

  const token = randomBytes(32).toString("hex");
  const sessionId = createHash("sha256").update(token).digest("hex");
  await db.insert(sessions).values({
    id: sessionId, staffId: who.id, expiresAt: new Date(Date.now() + 15 * 60_000), userAgent: "override-test",
  });
  const cookie = `cleo_session=${token}`;

  const callUuid = `override-test-${randomUUID()}`;
  const [call] = await db.insert(calls).values({
    provider: "vonage", externalCallId: callUuid, direction: "outbound",
    fromNumber: "+14045550100", toNumber: "+12125550199",
    startTime: new Date(), duration: 18, result: "Answered",
  }).returning({ id: calls.id });

  const patch = (body: unknown) =>
    fetch(`${BASE}/api/crm/calls/${call.id}`, {
      method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
    });

  const readResult = async () => (await db
    .select({ result: calls.result, locked: calls.resultLocked, was: calls.resultWas })
    .from(calls).where(eq(calls.id, call.id)))[0];

  const deliver = async (state: string) => {
    const body = JSON.stringify({ uuid: callUuid, status: state, direction: "outbound", duration: 18, from: "+14045550100", to: "+12125550199" });
    return (await fetch(`${BASE}/api/webhooks/vonage/event`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sign(body)}` }, body,
    })).status;
  };

  try {
    console.log("\n1. operator 'Sesli Mesaj' diyor");
    const res = await patch({ result: "Voicemail" });
    const j = (await res.json()) as { result: string; resultLocked: boolean; resultWas: string };
    check("200", res.status === 200, String(res.status));
    check("sonuc degisti", j.result === "Voicemail", j.result);
    check("kilitlendi", j.resultLocked === true);
    check("operatorun dedigi saklandi", j.resultWas === "Answered", j.resultWas);

    console.log("\n2. webhook tekrar 'Answered' diyor — ezmemeli");
    check("teslimat kabul edildi", (await deliver("completed")) < 400);
    let row = await readResult();
    check("hala Voicemail", row.result === "Voicemail", row.result);

    console.log("\n3. iz kaydi tutuldu");
    const trail = await db.select({ from: activityLog.fromValue, to: activityLog.toValue })
      .from(activityLog)
      .where(and(eq(activityLog.targetType, "call"), eq(activityLog.targetId, String(call.id))));
    check("bir kayit", trail.length >= 1, String(trail.length));
    check("Answered → Voicemail", trail[0]?.from === "Answered" && trail[0]?.to === "Voicemail",
      `${trail[0]?.from} → ${trail[0]?.to}`);

    console.log("\n4. gecersiz sonuc reddediliyor");
    check("422", (await patch({ result: "Banana" })).status === 422);

    console.log("\n5. geri alinca operatore devrediliyor");
    const undo = await patch({ clear: true });
    check("200", undo.status === 200, String(undo.status));
    row = await readResult();
    check("operatorun dedigine dondu", row.result === "Answered", row.result);
    check("kilit acildi", row.locked === false);

    console.log("\n6. kilit acikken webhook tekrar yazabiliyor");
    check("teslimat kabul edildi", (await deliver("completed")) < 400);
    row = await readResult();
    check("Answered", row.result === "Answered", row.result);

    console.log("\n7. oturumsuz degistiremez");
    const anon = await fetch(`${BASE}/api/crm/calls/${call.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ result: "Missed" }),
    });
    check("401/403", anon.status === 401 || anon.status === 403, String(anon.status));
  } finally {
    /* The activity log is append-only — a trigger rejects DELETE — and
       that is the point of it. The two rows this test writes stay, which
       is what an audit trail is for. */
    await db.delete(calls).where(eq(calls.id, call.id));
    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.externalSid, callUuid));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
