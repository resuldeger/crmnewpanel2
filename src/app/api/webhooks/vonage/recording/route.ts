import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { calls, webhookDeliveries } from "@/db/schema";
import { verifyVonageJwt, signatureCheckDisabled } from "@/server/vonage/signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Recording ready ───────────────────────────────────────────────────
 * Vonage finishes writing the audio some seconds after the call ends and
 * calls this URL with the link. Attached to the call row so the console
 * can offer it on the timeline.
 *
 * The URL itself is stored, not the audio: fetching it needs the account's
 * credentials, so a link leaking out of the database is not a recording
 * leaking out. Downloading is a separate, authenticated step.
 * ────────────────────────────────────────────────────────────────── */

interface RecordingEvent {
  recording_url?: string;
  recording_uuid?: string;
  conversation_uuid?: string;
  start_time?: string;
  end_time?: string;
  size?: number;
  timestamp?: string;
}

export async function POST(req: Request) {
  const raw = await req.text();

  let event: RecordingEvent;
  try {
    event = JSON.parse(raw) as RecordingEvent;
  } catch {
    return Response.json({ message: "Malformed body" }, { status: 400 });
  }

  const verdict = verifyVonageJwt(
    req.headers.get("authorization"),
    raw,
    process.env.VONAGE_SIGNATURE_SECRET ?? "",
  );
  const trusted = verdict.valid || signatureCheckDisabled();

  await db.insert(webhookDeliveries).values({
    provider: "vonage",
    externalSid: event.conversation_uuid ?? event.recording_uuid ?? "unknown",
    eventType: "call.recording",
    signatureValid: verdict.valid,
    payload: event as Record<string, unknown>,
    processed: false,
    error: trusted ? null : (verdict.reason ?? "unverified"),
  }).onConflictDoNothing();

  if (!trusted) {
    console.warn(`vonage/recording: refused — ${verdict.reason}`);
    return Response.json({ message: "Invalid signature" }, { status: 403 });
  }

  const conversationId = event.conversation_uuid;
  if (!conversationId || !event.recording_url) {
    return Response.json({ message: "Nothing to attach" }, { status: 202 });
  }

  const updated = await db
    .update(calls)
    .set({ recordingUrl: event.recording_url, hasRecording: true })
    .where(and(eq(calls.provider, "vonage"), eq(calls.externalCallId, conversationId)))
    .returning({ id: calls.id });

  /* The recording can arrive before the call's own completed event. Saying
     so beats silently dropping it — the poller reconciles the call later
     and this delivery stays in the inbox as evidence. */
  if (updated.length === 0) {
    console.warn(`vonage/recording: no call yet for ${conversationId}`);
    return Response.json({ ok: true, attached: false });
  }

  await db
    .update(webhookDeliveries)
    .set({ processed: true, processedAt: new Date() })
    .where(
      and(
        eq(webhookDeliveries.provider, "vonage"),
        eq(webhookDeliveries.externalSid, conversationId),
        eq(webhookDeliveries.eventType, "call.recording"),
      ),
    );

  return Response.json({ ok: true, attached: true });
}
