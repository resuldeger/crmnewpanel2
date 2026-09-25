/* Concurrency test for /api/webhooks/vonage/event.
 *
 * Two deliveries for the same call, in flight together. Before the upsert
 * this produced a unique-index violation on uniq_call_external, surfaced as
 * a 500 — the one answer that makes Vonage redeliver, turning a single
 * collision into a loop of them.
 *
 *   npx tsx scripts/dev/test-vonage-event-race.ts
 */
import "../env";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { calls, webhookDeliveries } from "../../src/db/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.VONAGE_SIGNATURE_SECRET ?? "";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function sign(body: string): string {
  const header = b64({ alg: "HS256", typ: "JWT" });
  const payload = b64({
    iat: Math.floor(Date.now() / 1000),
    payload_hash: createHash("sha256").update(body, "utf8").digest("hex"),
  });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

async function deliver(event: Record<string, unknown>): Promise<number> {
  const body = JSON.stringify(event);
  const res = await fetch(`${BASE}/api/webhooks/vonage/event`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sign(body)}` },
    body,
  });
  return res.status;
}

const rowFor = async (callId: string) =>
  (await db
    .select({ result: calls.result, duration: calls.duration, from: calls.fromNumber })
    .from(calls)
    .where(and(eq(calls.provider, "vonage"), eq(calls.externalCallId, callId))))
    ;

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  if (!SECRET) throw new Error("VONAGE_SIGNATURE_SECRET not set — cannot sign test deliveries");
  const callId = `test-race-${randomUUID()}`;
  const base = { uuid: callId, direction: "inbound", from: "+15551230001", to: "+14703440356" };

  console.log(`\ncall ${callId}\n`);

  // 1. The race: ringing and completed leave at the same moment.
  console.log("1. iki delivery ayni anda");
  const [a, b] = await Promise.all([
    deliver({ ...base, status: "ringing" }),
    deliver({ ...base, status: "completed", duration: 180, end_time: "2026-09-25 10:03:00" }),
  ]);
  check("hicbiri 500 donmedi", a < 500 && b < 500, `statuses ${a}, ${b}`);

  let rows = await rowFor(callId);
  check("tek satir olustu", rows.length === 1, `${rows.length} satir`);
  check("sonuc Answered", rows[0]?.result === "Answered", String(rows[0]?.result));
  check("sure 180", rows[0]?.duration === 180, String(rows[0]?.duration));

  // 2. A retried "ringing" arriving after the call is over must not undo it.
  console.log("\n2. gecikmis ringing (out-of-order retry)");
  const late = await deliver({ ...base, status: "ringing" });
  rows = await rowFor(callId);
  check("2xx", late < 400, String(late));
  check("sonuc hala Answered", rows[0]?.result === "Answered", String(rows[0]?.result));
  check("sure hala 180", rows[0]?.duration === 180, String(rows[0]?.duration));
  check("hala tek satir", rows.length === 1, `${rows.length} satir`);

  // 3. Same delivery twice — Vonage's own retry behaviour.
  console.log("\n3. ayni delivery 5 kez paralel");
  const many = await Promise.all(
    Array.from({ length: 5 }, () => deliver({ ...base, status: "completed", duration: 180 })),
  );
  rows = await rowFor(callId);
  check("hicbiri 500 donmedi", many.every((s) => s < 500), many.join(","));
  check("hala tek satir", rows.length === 1, `${rows.length} satir`);

  // Cleanup
  await db.delete(calls).where(and(eq(calls.provider, "vonage"), eq(calls.externalCallId, callId)));
  await db.delete(webhookDeliveries).where(eq(webhookDeliveries.externalSid, callId));

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
