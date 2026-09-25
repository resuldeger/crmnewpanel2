/* The answer webhook used to compute its signature verdict, write it down
 * and connect the call regardless. Anyone who guessed the URL could ask it
 * which studio owns a DID and what that branch's real phone number is.
 *
 *   npx tsx scripts/dev/test-vonage-answer-auth.ts
 */
import "../env";
import { createHmac } from "node:crypto";
import { like } from "drizzle-orm";
import { db } from "../../src/db/client";
import { webhookDeliveries } from "../../src/db/schema";
import { redis } from "../../src/server/redis";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.VONAGE_SIGNATURE_SECRET ?? "";
const DID = process.env.TEST_VONAGE_LINE ?? "+14703440356";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** Vonage's query scheme: every field but `sig`, sorted, joined as &k=v. */
function sign(fields: Record<string, string>): string {
  const body = Object.keys(fields)
    .filter((k) => k !== "sig")
    .sort()
    .map((k) => `&${k}=${(fields[k] ?? "").replace(/[&=]/g, "_")}`)
    .join("");
  return createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
}

const callAnswer = async (fields: Record<string, string>) => {
  const qs = new URLSearchParams(fields).toString();
  const res = await fetch(`${BASE}/api/webhooks/vonage/answer?${qs}`);
  return { status: res.status, body: await res.text() };
};

async function main() {
  await redis.del(...(await redis.keys("rate:vonage:answer:*")).concat("noop"));

  const base = { to: DID, from: "+15551239876", uuid: `answer-test-${Date.now()}` };

  console.log("\n1. imzasiz teslimat (hesap imzalamiyor olabilir) — hizmet surmeli");
  const unsigned = await callAnswer(base);
  check("2xx", unsigned.status === 200, String(unsigned.status));
  check("NCCO dondu", unsigned.body.trim().startsWith("["), unsigned.body.slice(0, 60));

  console.log("\n2. YANLIS imza — reddedilmeli");
  const forged = await callAnswer({ ...base, uuid: `${base.uuid}-forged`, sig: "deadbeef".repeat(8) });
  check("403", forged.status === 403, String(forged.status));
  check("NCCO sizdirmadi", !forged.body.includes("connect"), forged.body.slice(0, 80));

  console.log("\n3. DOGRU imza — kabul edilmeli");
  const fields = { ...base, uuid: `${base.uuid}-signed` };
  const good = await callAnswer({ ...fields, sig: sign(fields) });
  check("200", good.status === 200, String(good.status));
  check("NCCO dondu", good.body.trim().startsWith("["), good.body.slice(0, 60));

  console.log("\n4. imzasiz taramaya hiz siniri");
  const sweep: number[] = [];
  for (let i = 0; i < 70; i += 1) {
    sweep.push((await callAnswer({ ...base, uuid: `${base.uuid}-sweep-${i}` })).status);
  }
  check("bir noktada 429 geldi", sweep.includes(429), `${sweep.filter((s) => s === 429).length} × 429`);
  check("ilk istekler hala hizmet gordu", sweep[0] === 200, String(sweep[0]));

  await db.delete(webhookDeliveries).where(like(webhookDeliveries.externalSid, "answer-test-%"));
  await redis.del(...(await redis.keys("rate:vonage:answer:*")).concat("noop"));

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
