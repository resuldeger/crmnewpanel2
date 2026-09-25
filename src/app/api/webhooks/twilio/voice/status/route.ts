import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { calls, realtimeEvents, tasks, webhookDeliveries, leads } from "@/db/schema";
import { verifyTwilioSignature, publicUrl, formToRecord } from "@/server/twilio/signature";
import { studioForInboundNumber } from "@/server/twilio/resolve";
import { twiml } from "@/server/twilio/twiml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Twilio's <Dial> outcome → our four call results. */
function mapResult(status: string | undefined): "Answered" | "Missed" | "Voicemail" | "Attempted" {
  switch (status) {
    case "completed":
    case "answered":
      return "Answered";
    case "no-answer":
    case "busy":
    case "failed":
      return "Missed";
    case "canceled":
      return "Attempted";
    default:
      return "Attempted";
  }
}

/** Fired when the forwarded leg finishes: duration, outcome, recording. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return twiml("");

  const params = formToRecord(form);
  const callSid = params.CallSid ?? null;
  const studio = await studioForInboundNumber(params.To ?? null);

  const valid = verifyTwilioSignature(
    studio?.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "",
    publicUrl(req),
    params,
    req.headers.get("x-twilio-signature"),
  );
  if (!valid && process.env.TWILIO_SKIP_SIGNATURE !== "1") {
    return new Response("Invalid signature", { status: 403 });
  }
  if (!callSid) return twiml("");

  await db
    .insert(webhookDeliveries)
    .values({
      provider: "twilio",
      externalSid: `voice-status:${callSid}:${params.DialCallStatus ?? params.CallStatus ?? "unknown"}`,
      eventType: "voice.status",
      payload: params,
      signatureValid: valid,
      processed: true,
      processedAt: new Date(),
    })
    .onConflictDoNothing();

  const status = params.DialCallStatus ?? params.CallStatus;
  const result = mapResult(status);
  const duration = Number(params.DialCallDuration ?? params.CallDuration ?? 0) || 0;

  const [updated] = await db
    .update(calls)
    .set({
      result,
      duration,
      endTime: new Date(),
      hasRecording: Boolean(params.RecordingUrl),
      recordingUrl: params.RecordingUrl ?? null,
    })
    .where(and(eq(calls.provider, "twilio"), eq(calls.externalCallId, callSid)))
    .returning({
      id: calls.id,
      leadId: calls.leadId,
      locationId: calls.locationId,
      fromNumber: calls.fromNumber,
    });

  if (updated) {
    await db.insert(realtimeEvents).values({
      channel: "calls:live",
      topic: result === "Answered" ? "call.completed" : "call.missed",
      locationId: updated.locationId,
      requiredPermission: "calls.view",
      payload: { callSid, result, duration },
    });

    // A missed inbound call is a lead nobody is chasing — put it in the
    // callback queue instead of losing it. The unique index on
    // (lead_id, source) keeps repeat misses from stacking up duplicates.
    if (result !== "Answered" && updated.leadId) {
      const [lead] = await db
        .select({ name: leads.name })
        .from(leads)
        .where(eq(leads.id, updated.leadId))
        .limit(1);

      await db
        .insert(tasks)
        .values({
          title: "Missed inbound call — call back",
          leadId: updated.leadId,
          leadName: lead?.name ?? null,
          phoneE164: updated.fromNumber,
          locationId: updated.locationId,
          dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          source: "callback",
        })
        .onConflictDoNothing();
    }
  }

  return twiml("");
}
