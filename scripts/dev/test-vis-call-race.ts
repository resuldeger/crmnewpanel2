/* Concurrency for the VIS call webhook — the one that actually drives the
 * live board.
 *
 * Its insert carried onConflictDoNothing, so unlike the Voice API route it
 * never 500'd. It failed quietly instead: whichever of two simultaneous
 * deliveries landed first created the row, and the other was dropped. A
 * RINGING winning that race left a real conversation recorded as
 * "Attempted · 0 sec".
 *
 *   npx tsx scripts/dev/test-vis-call-race.ts
 */
import "../env";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db } from "../../src/db/client";
import { calls, vonageEvents, webhookDeliveries } from "../../src/db/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.VONAGE_SIGNATURE_SECRET ?? "";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

interface VisEvent {
  externalId: string;
  state: string;
  direction: string;
  phoneNumber: string;
  callerId: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  userId?: string;
}

/** The "raw-body" convention: HMAC over the bytes finally sent. */
async function deliver(event: VisEvent): Promise<number> {
  const withoutSig = JSON.stringify({ event, metadata: { deliveryId: randomUUID() } });
  const signature = createHmac("sha256", SECRET).update(withoutSig, "utf8").digest("hex");
  const body = JSON.stringify({ ...JSON.parse(withoutSig), metadata: { ...JSON.parse(withoutSig).metadata, signature } });
  // The signature covers the body WITHOUT it, which is the convention the
  // verifier calls "omitted-signature".
  const res = await fetch(`${BASE}/api/webhooks/vonage/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return res.status;
}

const rowFor = (callId: string) =>
  db
    .select({ result: calls.result, duration: calls.duration, endTime: calls.endTime })
    .from(calls)
    .where(and(eq(calls.provider, "vonage"), eq(calls.externalCallId, callId)));

async function main() {
  if (!SECRET) throw new Error("VONAGE_SIGNATURE_SECRET not set");
  const callId = `vis-race-${randomUUID()}`;
  const base = {
    externalId: callId,
    direction: "INBOUND",
    phoneNumber: "+15551230002",
    callerId: "+14703440356",
  };

  console.log(`\ncall ${callId}\n`);

  // ── 1. RINGING and ANSWERED leave together ─────────────────────────
  console.log("1. RINGING ve ANSWERED ayni anda");
  const [a, b] = await Promise.all([
    deliver({ ...base, state: "RINGING", startTime: "2026-09-25T10:00:00.000+0000" }),
    deliver({
      ...base,
      state: "ANSWERED",
      startTime: "2026-09-25T10:00:00.000+0000",
      endTime: "2026-09-25T10:04:00.000+0000",
      duration: 240,
    }),
  ]);
  check("ikisi de kabul edildi", a < 400 && b < 400, `${a}, ${b}`);

  let rows = await rowFor(callId);
  check("tek satir", rows.length === 1, `${rows.length} satir`);
  check("ANSWERED dusmedi", rows[0]?.result === "Answered", String(rows[0]?.result));
  check("sure kaydedildi", rows[0]?.duration === 240, String(rows[0]?.duration));

  // ── 2. A late RINGING must not undo a finished call ────────────────
  console.log("\n2. gecikmis RINGING");
  const late = await deliver({ ...base, state: "RINGING" });
  rows = await rowFor(callId);
  check("2xx", late < 400, String(late));
  check("sonuc hala Answered", rows[0]?.result === "Answered", String(rows[0]?.result));
  check("sure hala 240", rows[0]?.duration === 240, String(rows[0]?.duration));

  // ── 3. Vonage's own retries ────────────────────────────────────────
  console.log("\n3. ayni delivery 5 kez paralel");
  const many = await Promise.all(
    Array.from({ length: 5 }, () =>
      deliver({ ...base, state: "COMPLETED", endTime: "2026-09-25T10:04:00.000+0000", duration: 240 }),
    ),
  );
  rows = await rowFor(callId);
  check("hicbiri 500 degil", many.every((s) => s < 500), many.join(","));
  check("hala tek satir", rows.length === 1, `${rows.length} satir`);

  // Cleanup
  await db.delete(calls).where(and(eq(calls.provider, "vonage"), eq(calls.externalCallId, callId)));
  await db.delete(vonageEvents).where(eq(vonageEvents.callUuid, callId));
  await db.delete(webhookDeliveries).where(like(webhookDeliveries.externalSid, `${callId}%`));

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
