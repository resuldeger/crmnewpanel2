import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { calls, customers, leads, realtimeEvents, webhookDeliveries } from "@/db/schema";
import { verifyTwilioSignature, publicUrl, formToRecord } from "@/server/twilio/signature";
import { studioForInboundNumber, normalizeNumber } from "@/server/twilio/resolve";
import { twiml, dial, say, hangup } from "@/server/twilio/twiml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Inbound voice call to a studio's Twilio number.
 *
 *   caller ──► Twilio DID ──► (this handler) ──► studio's real phone
 *
 * The DID identifies the studio; the studio record carries the branch line
 * we forward to. The leg is logged and matched to a lead so the call shows
 * up on that person's timeline in the console.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return twiml(say("Sorry, something went wrong.") + hangup());

  const params = formToRecord(form);
  const to = params.To ?? null;
  const from = params.From ?? null;
  const callSid = params.CallSid ?? null;

  const studio = await studioForInboundNumber(to);
  if (!studio) {
    // We do not own this number, so we cannot verify the signature either.
    // Say nothing useful and hang up rather than dialling somewhere.
    console.warn(`twilio/voice: no studio owns ${to}`);
    return twiml(say("This number is not in service.") + hangup());
  }

  // Signature is checked with the auth token of the account that owns the
  // number — resolved above. Parsing the body is not trusting it.
  const signature = req.headers.get("x-twilio-signature");
  const valid = verifyTwilioSignature(studio.authToken ?? "", publicUrl(req), params, signature);
  if (!valid && process.env.TWILIO_SKIP_SIGNATURE !== "1") {
    console.warn(`twilio/voice: bad signature for ${callSid}`);
    return new Response("Invalid signature", { status: 403 });
  }

  if (!studio.branchPhone) {
    console.error(`twilio/voice: ${studio.slug} has no branch phone configured`);
    return twiml(say("We are unable to take your call right now. Please try again later.") + hangup());
  }

  const callerE164 = normalizeNumber(from);

  // Match the caller to someone we already know, so the call lands on their
  // timeline instead of floating unattached.
  let leadId: string | null = null;
  let customerId: string | null = null;
  if (callerE164) {
    const [lead] = await db
      .select({ id: leads.id, customerId: leads.customerId })
      .from(leads)
      .where(and(eq(leads.phoneE164, callerE164), isNull(leads.mergedInto)))
      .orderBy(leads.createdAt)
      .limit(1);
    leadId = lead?.id ?? null;
    customerId = lead?.customerId ?? null;

    if (!customerId) {
      const [c] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.phoneE164, callerE164), isNull(customers.mergedInto)))
        .limit(1);
      customerId = c?.id ?? null;
    }
  }

  if (callSid) {
    // Retries of the same webhook must not create a second call row.
    await db
      .insert(webhookDeliveries)
      .values({
        provider: "twilio",
        externalSid: `voice:${callSid}`,
        eventType: "voice.inbound",
        payload: params,
        signatureValid: valid,
        processed: true,
        processedAt: new Date(),
      })
      .onConflictDoNothing();

    await db
      .insert(calls)
      .values({
        provider: "twilio",
        externalCallId: callSid,
        direction: "inbound",
        fromNumber: callerE164 ?? from ?? "unknown",
        toNumber: to ?? "unknown",
        toName: studio.name,
        locationId: studio.id,
        leadId,
        customerId,
        forwardedTo: studio.branchPhone,
        startTime: new Date(),
        result: "Attempted",
        raw: params,
      })
      .onConflictDoNothing();

    // Feeds the live call floor over the realtime channel.
    await db.insert(realtimeEvents).values({
      channel: "calls:live",
      topic: "call.ringing",
      locationId: studio.id,
      requiredPermission: "calls.view",
      payload: { callSid, from: callerE164, studio: studio.name, leadId },
    });
  }

  const statusCallback = new URL("/api/webhooks/twilio/voice/status", publicUrl(req)).toString();

  return twiml(
    dial({
      to: studio.branchPhone,
      // Show the caller's number so the studio sees who is calling, not us.
      callerId: callerE164 ?? undefined,
      timeoutSeconds: 25,
      statusCallback,
    }),
  );
}
