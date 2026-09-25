/* ── VIS webhook rehearsal ─────────────────────────────────────────────
 * Drives a call all the way through /api/webhooks/vonage/call without
 * Vonage, so the pipeline is known-good before the account is reachable
 * and a failure on the day is known to be theirs, not ours.
 *
 * It signs each delivery with every convention the verifier accepts. The
 * endpoint reports which one it matched, which is the same answer a real
 * delivery gives — so the rehearsal and the real thing are read the same
 * way.
 *
 *   npm run test:vonage                    # against localhost
 *   npm run test:vonage -- <ngrok url>     # against the tunnel
 * ────────────────────────────────────────────────────────────────── */
import "./env";
import { createHmac } from "node:crypto";
import { eq, like, or } from "drizzle-orm";
import { db } from "../src/db/client";
import { calls, vonageEvents, webhookDeliveries } from "../src/db/schema";

const BASE = process.argv[2] ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
const ENDPOINT = `${BASE.replace(/\/$/, "")}/api/webhooks/vonage/call`;
const SECRET = process.env.VONAGE_SIGNATURE_SECRET;

/** The number one of our studios answers on — set to a real one to test routing. */
const OUR_LINE = process.env.TEST_VONAGE_LINE ?? "+15005550006";
const CUSTOMER = process.env.TEST_VONAGE_CUSTOMER ?? "+14155550142";

type Scheme = "raw-body" | "blanked-signature" | "omitted-signature";

/** Builds the body and its digest under one convention. */
function sign(payload: Record<string, unknown>, scheme: Scheme, secret: string) {
  const withBlank = JSON.stringify({
    ...payload,
    metadata: { ...(payload.metadata as object), signature: "" },
  });

  const bare = { ...payload, metadata: { ...(payload.metadata as Record<string, unknown>) } };
  delete (bare.metadata as Record<string, unknown>).signature;
  const withOmitted = JSON.stringify(bare);

  if (scheme === "blanked-signature") {
    const sig = createHmac("sha256", secret).update(withBlank, "utf8").digest("hex");
    return JSON.stringify({ ...payload, metadata: { ...(payload.metadata as object), signature: sig } });
  }
  if (scheme === "omitted-signature") {
    const sig = createHmac("sha256", secret).update(withOmitted, "utf8").digest("hex");
    return JSON.stringify({ ...payload, metadata: { ...(payload.metadata as object), signature: sig } });
  }
  // raw-body: the digest covers the bytes finally sent, so sign last.
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return JSON.stringify({ ...JSON.parse(body), metadata: { ...(payload.metadata as object), signature: sig } });
}

function event(callId: string, state: string, extra: Record<string, unknown> = {}) {
  return {
    event: {
      id: callId,
      accountId: process.env.VONAGE_ACCOUNT_ID ?? "test-account",
      phoneNumber: CUSTOMER,   // the outside party
      callerId: OUR_LINE,      // our own line — how the studio is resolved
      direction: "INBOUND",
      state,
      startTime: new Date().toISOString(),
      ...extra,
    },
    metadata: { deliveryId: `dlv-${Date.now()}`, signature: "", webhookId: "wh-test" },
  };
}

async function post(body: string) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await res.text();
  return { status: res.status, text };
}

/* Rehearsal rows are indistinguishable from real calls in the console, so
   each run clears the last one's rather than letting fake traffic build up
   in the log the studios are measured on. */
async function clearPreviousRuns() {
  const fake = or(like(calls.externalCallId, "rehearsal-%"), like(calls.externalCallId, "probe-%"));
  const gone = await db.delete(calls).where(fake).returning({ id: calls.id });
  await db.delete(vonageEvents).where(
    or(like(vonageEvents.callUuid, "rehearsal-%"), like(vonageEvents.callUuid, "probe-%")),
  );
  await db.delete(webhookDeliveries).where(
    or(like(webhookDeliveries.externalSid, "rehearsal-%"), like(webhookDeliveries.externalSid, "probe-%")),
  );
  if (gone.length > 0) console.log(`Cleared ${gone.length} row(s) from a previous rehearsal.`);
}

async function main() {
  console.log(`Endpoint : ${ENDPOINT}`);
  console.log(`Our line : ${OUR_LINE}   Customer: ${CUSTOMER}`);

  await clearPreviousRuns();

  if (!SECRET) {
    console.error("\nVONAGE_SIGNATURE_SECRET is not set — nothing to sign with.");
    console.error("Set it in .env.local, or set VONAGE_SKIP_SIGNATURE=1 to rehearse unsigned.");
    process.exit(1);
  }

  // 1. Which convention does the endpoint accept? All three should pass
  //    locally; against a real delivery only one will.
  console.log("\n── signing conventions ──");
  for (const scheme of ["raw-body", "blanked-signature", "omitted-signature"] as Scheme[]) {
    const { status } = await post(sign(event(`probe-${scheme}`, "RINGING"), scheme, SECRET));
    console.log(`  ${scheme.padEnd(20)} → HTTP ${status} ${status === 200 ? "accepted" : "refused"}`);
  }

  // 2. A forged delivery must be refused, or the check is decorative.
  const forged = JSON.stringify({
    ...event("probe-forged", "RINGING"),
    metadata: { deliveryId: "x", signature: "deadbeef", webhookId: "wh-test" },
  });
  const { status: forgedStatus } = await post(forged);
  console.log(`\n  forged signature     → HTTP ${forgedStatus} ${forgedStatus === 403 ? "refused (correct)" : "ACCEPTED — CHECK IS NOT WORKING"}`);

  // 3. A full call lifecycle, to prove the row is created then completed.
  const callId = `rehearsal-${Date.now()}`;
  console.log(`\n── call lifecycle (${callId}) ──`);
  for (const [state, extra] of [
    ["RINGING", {}],
    ["ANSWERED", { answerTime: new Date().toISOString() }],
    ["COMPLETED", { endTime: new Date().toISOString(), duration: 73 }],
  ] as [string, Record<string, unknown>][]) {
    const { status, text } = await post(sign(event(callId, state, extra), "raw-body", SECRET));
    console.log(`  ${state.padEnd(10)} → HTTP ${status} ${text.slice(0, 120)}`);
  }

  // 4. What actually landed.
  const [row] = await db.select().from(calls).where(eq(calls.externalCallId, callId)).limit(1);
  console.log("\n── database ──");
  if (!row) {
    console.log("  no call row — the handler accepted the delivery but wrote nothing.");
  } else {
    console.log(`  call #${row.id}  result=${row.result}  duration=${row.duration}s`);
    console.log(`  studio=${row.locationId ?? "UNRESOLVED"}  lead=${row.leadId ?? "—"}  customer=${row.customerId ?? "—"}`);
    if (row.locationId === null) {
      console.log(`  ↑ no studio matched ${OUR_LINE}. Set TEST_VONAGE_LINE to a number a studio owns.`);
    }
  }

  const deliveries = await db
    .select({ id: webhookDeliveries.id, valid: webhookDeliveries.signatureValid, err: webhookDeliveries.error })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.externalSid, callId));
  console.log(`  deliveries recorded: ${deliveries.length} (${deliveries.filter((d) => d.valid).length} verified)`);
  console.log("\nRehearsal rows stay until the next run, so they can be inspected in the console.");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
