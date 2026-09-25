import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  calls, customers, extensions, leads,
  realtimeEvents, webhookDeliveries, vonageEvents,
} from "@/db/schema";
import { logVonageWebhook } from "@/server/vonage/debugLog";
import { normalizeNumber, studioForInboundNumber } from "@/server/twilio/resolve";
import { signatureCheckDisabled, verifyVisSignature } from "@/server/vonage/signature";
import { parseVonageTime } from "@/server/vonage/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Vonage VIS (Vonage Integration Suite) Call Webhook ────────────────
 *
 * Official Payload format:
 * {
 *   "event": {
 *     "id": "call-uuid",
 *     "externalId": "ext-id",
 *     "accountId": "«account id»",
 *     "phoneNumber": "+14155550100",
 *     "callerId": "Customer Name",
 *     "direction": "INBOUND" | "OUTBOUND",
 *     "state": "RINGING" | "ACTIVE" | "ANSWERED" | "MISSED" | "BUSY" | "CANCELLED",
 *     "startTime": "2026-09-24T16:10:06.000+0000",
 *     "answerTime": "...",
 *     "endTime": "...",
 *     "duration": 42,
 *     "userId": "1234",
 *     "internal": false
 *   },
 *   "metadata": {
 *     "deliveryId": "...",
 *     "signature": "...",
 *     "webhookId": "..."
 *   }
 * }
 * ────────────────────────────────────────────────────────────────── */

interface VisEventPayload {
  id?: string;
  externalId?: string;
  accountId?: string;
  phoneNumber?: string;
  callerId?: string;
  direction?: string;
  state?: string;
  startTime?: string;
  answerTime?: string;
  endTime?: string;
  duration?: number;
  userId?: string;
  internal?: boolean;
}

interface VisWebhookBody {
  event?: VisEventPayload;
  metadata?: {
    attempt?: number;
    deliveryId?: string;
    signature?: string;
    webhookId?: string;
  };
}



/* Vonage retries any delivery it did not get a 2xx for, and sends several
   events per call. So RINGING can land after ANSWERED — and writing it
   would turn a completed three-minute call back into "Attempted · 0 sec"
   in the log the studios are measured on. Progress only moves forward. */
const STATE_RANK: Record<string, number> = {
  UNKNOWN: 0,
  RINGING: 1,
  ACTIVE: 2,
  ANSWERED: 3,
  COMPLETED: 3,
  MISSED: 3,
  BUSY: 3,
  CANCELLED: 3,
  REJECTED: 3,
  VOICEMAIL: 3,
};
const rankOf = (state: string): number => STATE_RANK[state] ?? 0;

function mapVisStateToResult(state?: string): "Answered" | "Missed" | "Voicemail" | "Attempted" {
  const s = (state ?? "").toUpperCase();
  if (s === "ANSWERED" || s === "ACTIVE" || s === "COMPLETED") return "Answered";
  if (s === "MISSED" || s === "BUSY" || s === "CANCELLED" || s === "REJECTED") return "Missed";
  if (s === "VOICEMAIL") return "Voicemail";
  return "Attempted";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  logVonageWebhook("VIS_CALL", "GET", req.headers, url.search);
  return Response.json({
    status: "ok",
    message: "Vonage VIS Call Webhook endpoint is ACTIVE and listening!",
    endpoint: "/api/webhooks/vonage/call",
    time: new Date().toISOString(),
  });
}

export async function POST(req: Request) {
  const startTime = Date.now();
  const rawBody = await req.text();

  logVonageWebhook("VIS_CALL", "POST", req.headers, rawBody);

  let body: VisWebhookBody;
  try {
    body = JSON.parse(rawBody) as VisWebhookBody;
  } catch {
    return Response.json({ message: "Malformed JSON" }, { status: 400 });
  }

  const event = body.event;
  if (!event) {
    return Response.json({ status: "ok", message: "No event payload" }, { status: 200 });
  }

  /* ── Which field identifies the call ───────────────────────────────
   * Vonage's own documentation names `externalId` as the call's unique
   * identifier and states that several events arrive for one call, to be
   * merged rather than inserted separately. It does not document an `id`
   * field at all.
   *
   * This used to key on `event.id` and, worse, return 200 when it was
   * missing — so a real delivery in the documented shape was accepted and
   * silently thrown away, and the console would have stayed empty with
   * nothing in the logs to say why. `id` is still honoured as a fallback
   * in case an account sends it, but `externalId` decides.
   */
  const callId = event.externalId ?? event.id ?? "";
  if (!callId) {
    console.warn("vonage/call: delivery carries no externalId — cannot key the call");
    return Response.json({ status: "ok", message: "No call identifier" }, { status: 200 });
  }

  const state = (event.state ?? "UNKNOWN").toUpperCase();
  const direction = (event.direction ?? "INBOUND").toLowerCase();
  const isInbound = direction === "inbound";
  const customerPhone = normalizeNumber(event.phoneNumber);

  // 1. Signature check, against every convention VIS might be using.
  const signature = body.metadata?.signature ?? req.headers.get("x-vonage-signature") ?? undefined;
  const verdict = verifyVisSignature(rawBody, signature, process.env.VONAGE_SIGNATURE_SECRET);
  const isSignatureValid = verdict.valid;

  if (verdict.valid) {
    /* Worth one line: the first genuine delivery names the convention this
       account actually signs with, which is the open question the code
       cannot answer on its own. */
    console.log(`vonage/call: signature verified via ${verdict.scheme}`);
  } else if (signature && verdict.candidates) {
    console.warn(
      `vonage/call: signature did not match. received=${signature.trim().toLowerCase()} ` +
        `expected=${JSON.stringify(verdict.candidates)}`,
    );
  }

  // 2. Record the delivery either way — a run of refusals is how a rotated
  //    secret or a spoofing attempt becomes visible instead of silent.
  const trusted = isSignatureValid || signatureCheckDisabled();

  await db.insert(webhookDeliveries).values({
    provider: "vonage",
    externalSid: callId,
    eventType: `vis.call.${state.toLowerCase()}`,
    signatureValid: isSignatureValid,
    payload: body as unknown as Record<string, unknown>,
    processed: trusted,
    processedAt: trusted ? new Date() : null,
    error: trusted ? null : (verdict.reason ?? "signature mismatch"),
  }).onConflictDoNothing();

  /* The verdict was recorded and then ignored: an unsigned request still
     wrote call rows and fired realtime events. */
  if (!trusted) {
    console.warn(`vonage/call: refused ${callId} — ${verdict.reason}`);
    return Response.json({ message: "Invalid signature" }, { status: 403 });
  }

  /* 3. Resolve the studio from OUR side of the call, not the customer's.
        studioForInboundNumber matches a number we own; the customer's
        number never is, so passing it found nothing and every call was
        filed against no studio. VIS names the outside party `phoneNumber`
        and our own line `callerId`, whichever way the call went. */
  const ourNumber = normalizeNumber(event.callerId);
  const studio =
    (ourNumber ? await studioForInboundNumber(ourNumber) : null) ??
    (customerPhone ? await studioForInboundNumber(customerPhone) : null);

  let staffId: number | null = null;
  let agentName: string | null = null;
  let extensionCode = event.userId ?? null;

  if (extensionCode) {
    const [ext] = await db
      .select({ staffId: extensions.staffId, display: extensions.displayName, ext: extensions.extension })
      .from(extensions)
      .where(eq(extensions.extension, String(extensionCode)))
      .limit(1);

    if (ext) {
      staffId = ext.staffId ?? null;
      agentName = ext.display ?? null;
      extensionCode = ext.ext;
    }
  }

  // 4. Resolve Customer / Lead
  let leadId: string | null = null;
  let customerId: string | null = null;

  if (customerPhone) {
    const [lead] = await db
      .select({ id: leads.id, customerId: leads.customerId })
      .from(leads)
      .where(and(eq(leads.phoneE164, customerPhone), isNull(leads.mergedInto)))
      .orderBy(desc(leads.createdAt))
      .limit(1);

    leadId = lead?.id ?? null;
    customerId = lead?.customerId ?? null;

    if (!customerId) {
      const [c] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.phoneE164, customerPhone), isNull(customers.mergedInto)))
        .limit(1);
      customerId = c?.id ?? null;
    }
  }

  // 5. Upsert Call record
  /* An unreadable timestamp used to become an Invalid Date, which the
     driver refuses with an error naming neither the field nor the call. */
  const callStartTime = parseVonageTime(event.startTime) ?? new Date();
  const callEndTime = parseVonageTime(event.endTime);
  const durationSec = typeof event.duration === "number" ? event.duration : 0;
  const callResult = mapVisStateToResult(state);

  /* Read the row, then write it — and two deliveries for one call are
     routinely in flight together, so both read nothing and both act on
     that. The insert carried onConflictDoNothing, which meant it did not
     500 the way the Voice API route did; it did something quieter and
     worse. The RINGING that happened to land first created the row, and
     the ANSWERED arriving a millisecond later was dropped without a word.
     The call then sat in the log the studios are measured on as
     "Attempted · 0 sec" for a conversation that actually happened.

     One statement, arbitrated by uniq_call_external, cannot race with a
     copy of itself. The lookup also matched on external_call_id alone
     while that index is on (provider, external_call_id), so a Twilio row
     that happened to share an id could be read — and updated — instead.

     Everything below only moves a call FORWARD. */
  const advances = rankOf(state) >= 2;
  const resultUpdate = advances
    /* Still guarded: a late delivery carrying no end time must not
       overwrite the outcome of a call already recorded as finished. */
    ? sql`case when ${calls.endTime} is null or excluded.end_time is not null
               then excluded.result else ${calls.result} end`
    : sql`${calls.result}`;

  await db
    .insert(calls)
    .values({
      provider: "vonage",
      externalCallId: callId,
      direction: isInbound ? "inbound" : "outbound",
      fromNumber: isInbound ? customerPhone ?? event.phoneNumber ?? "" : studio?.branchPhone ?? "",
      toNumber: isInbound ? studio?.branchPhone ?? "" : customerPhone ?? event.phoneNumber ?? "",
      leadId,
      customerId,
      locationId: studio?.id ?? null,
      staffId,
      agentName,
      extension: extensionCode,
      startTime: callStartTime,
      endTime: callEndTime,
      duration: durationSec,
      result: callResult,
      raw: body as unknown as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [calls.provider, calls.externalCallId],
      set: {
        result: resultUpdate,
        // An out-of-order delivery reports the duration as of ITS moment,
        // which is shorter. The longest one is the true length.
        duration: sql`greatest(${calls.duration}, excluded.duration)`,
        // startTime falls back to now() when VIS sends none, so a later
        // delivery carrying the real one is the earlier instant.
        startTime: sql`least(${calls.startTime}, excluded.start_time)`,
        endTime: sql`coalesce(excluded.end_time, ${calls.endTime})`,
        /* Fill in what an earlier delivery did not carry, never blank out
           what it did: VIS names the extension on some events and not
           others, and the studio only resolves once a number is known. */
        staffId: sql`coalesce(${calls.staffId}, excluded.staff_id)`,
        agentName: sql`coalesce(${calls.agentName}, excluded.agent_name)`,
        extension: sql`coalesce(${calls.extension}, excluded.extension)`,
        locationId: sql`coalesce(${calls.locationId}, excluded.location_id)`,
        leadId: sql`coalesce(${calls.leadId}, excluded.lead_id)`,
        customerId: sql`coalesce(${calls.customerId}, excluded.customer_id)`,
        fromNumber: sql`coalesce(nullif(excluded.from_number, ''), ${calls.fromNumber})`,
        toNumber: sql`coalesce(nullif(excluded.to_number, ''), ${calls.toNumber})`,
        // The last thing Vonage said is on file either way.
        raw: sql`excluded.raw`,
      },
    });

  // 6. Record raw Vonage event for Realtime Call Board
  await db.insert(vonageEvents).values({
    callUuid: callId,
    eventType: `vis.call.${state.toLowerCase()}`,
    locationId: studio?.id ?? null,
    staffId,
    payload: body as unknown as Record<string, unknown>,
    occurredAt: new Date(),
  }).catch(() => null);

  // 7. Push to Realtime Socket.IO Gateway
  await db.insert(realtimeEvents).values({
    /* One channel the rule table knows, with the studio on the envelope:
       the gateway re-checks locationId against each subscriber's scope on
       delivery, so a per-studio topic would match no rule and be refused. */
    channel: "calls:live",
    topic: "call.state_changed",
    locationId: studio?.id ?? null,
    requiredPermission: "calls.view",
    payload: {
      callId,
      state,
      direction,
      phoneNumber: customerPhone ?? event.phoneNumber,
      callerId: event.callerId,
      agentName,
      extension: extensionCode,
      leadId,
      customerId,
      studioName: studio?.name,
      timestamp: new Date().toISOString(),
    },
  }).catch(() => null);

  const elapsed = Date.now() - startTime;
  return Response.json({
    status: "ok",
    received: true,
    state,
    callId,
    processingTimeMs: elapsed,
  }, { status: 200 });
}
