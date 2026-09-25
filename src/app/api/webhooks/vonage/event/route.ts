import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  calls, customers, extensions, leads, locations,
  realtimeEvents, staff, webhookDeliveries,
} from "@/db/schema";
import { logVonageWebhook } from "@/server/vonage/debugLog";
import { normalizeNumber, studioForInboundNumber } from "@/server/twilio/resolve";
import { verifyVonageJwt, signatureCheckDisabled } from "@/server/vonage/signature";
import { parseVonageTime } from "@/server/vonage/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Vonage call lifecycle ─────────────────────────────────────────────
 * Until now the only source of call data was vonageSync, which polls the
 * Reports API every five minutes. That meant a call an agent had just
 * placed sat in the console as "Attempted · 0 sec" for up to five minutes,
 * an inbound call was invisible while it rang, and a live call board was
 * impossible. Reporting on who called whom — the thing the studios are
 * actually measured on — was always minutes behind and sometimes wrong,
 * because a call that ended between two polls could be missed entirely.
 *
 * This is the push side. The poller stays as a safety net: a webhook that
 * never arrives (a deploy, a network blip) is still reconciled later.
 *
 *   started / ringing  → the row appears, live board lights up
 *   answered           → ring time closes, talk time starts
 *   completed          → duration, outcome and recording land
 * ────────────────────────────────────────────────────────────────── */

interface VonageEvent {
  uuid?: string;
  conversation_uuid?: string;
  status?: string;
  direction?: string;
  from?: string | { number?: string };
  to?: string | { number?: string };
  timestamp?: string;
  start_time?: string;
  end_time?: string;
  duration?: string | number;
  rate?: string;
  price?: string;
  network?: string;
  detail?: string;
  reason?: string;
  recording_url?: string;
  /* VBC sends the extension that handled the leg. */
  source_user?: string;
  destination_extension?: string;
}

/** Vonage sends `from` either as a bare string or as { number }. */
const party = (v: VonageEvent["from"]): string | null => {
  if (typeof v === "string") return normalizeNumber(v);
  if (v && typeof v === "object") return normalizeNumber(v.number);
  return null;
};

/** Vonage's status names → the four outcomes the console reports on. */
function outcomeOf(status: string, detail?: string): "Answered" | "Missed" | "Voicemail" | "Attempted" | null {
  const s = status.toLowerCase();
  const d = (detail ?? "").toLowerCase();

  if (s === "completed") {
    if (d.includes("voicemail") || d.includes("machine")) return "Voicemail";
    return "Answered";
  }
  if (s === "answered") return "Answered";
  if (["busy", "cancelled", "rejected", "unanswered", "timeout", "failed"].includes(s)) return "Missed";
  // started / ringing / ongoing: the call has no outcome yet.
  return null;
}

const TERMINAL = new Set(["completed", "busy", "cancelled", "rejected", "unanswered", "timeout", "failed"]);



export async function GET(req: Request) {
  const url = new URL(req.url);
  logVonageWebhook("EVENT_ROUTE_GET", "GET", req.headers, url.search);
  return Response.json({
    status: "ok",
    message: "Vonage Webhook Event Endpoint is ACTIVE and listening!",
    time: new Date().toISOString(),
    query: Object.fromEntries(url.searchParams.entries()),
  });
}

export async function POST(req: Request) {
  /* Read the body ONCE as text. The JWT binds a hash of these exact bytes,
     so re-serialising the parsed object would break verification. */
  const raw = await req.text();

  logVonageWebhook("EVENT_ROUTE_POST", "POST", req.headers, raw);

  let event: VonageEvent;
  try {
    event = JSON.parse(raw) as VonageEvent;
  } catch {
    return Response.json({ message: "Malformed body" }, { status: 400 });
  }

  const verdict = verifyVonageJwt(
    req.headers.get("authorization"),
    raw,
    process.env.VONAGE_SIGNATURE_SECRET ?? "",
  );
  const trusted = verdict.valid || signatureCheckDisabled();

  /* Recorded either way. A run of rejected deliveries is how a rotated
     secret or a spoofing attempt becomes visible instead of silent. */
  await db.insert(webhookDeliveries).values({
    provider: "vonage",
    // NOT NULL: an event without an id still has to be recorded.
    externalSid: event.uuid ?? event.conversation_uuid ?? "unknown",
    eventType: `call.${event.status ?? "unknown"}`,
    signatureValid: verdict.valid,
    payload: event as Record<string, unknown>,
    processed: false,
    error: trusted ? null : (verdict.reason ?? "unverified"),
  })
    // Vonage retries a delivery it did not get a 2xx for. The same event
    // arriving twice is normal and must not 500.
    .onConflictDoNothing();

  if (!trusted) {
    console.warn(`vonage/event: refused — ${verdict.reason}`);
    return Response.json({ message: "Invalid signature" }, { status: 403 });
  }

  const status = (event.status ?? "").toLowerCase();
  const callId = event.uuid ?? event.conversation_uuid;
  if (!callId || !status) {
    return Response.json({ message: "Nothing to record" }, { status: 202 });
  }

  const from = party(event.from);
  const to = party(event.to);
  const inbound = (event.direction ?? "").toLowerCase() === "inbound";

  /* The studio is whichever side of the call is one of our numbers. On an
     inbound leg that is the number dialled; on an outbound leg it is the
     number we called from. */
  const studio = (await studioForInboundNumber(inbound ? to : from))
    ?? (await studioForInboundNumber(inbound ? from : to));

  // The agent, if VBC named an extension.
  const extensionCode = event.source_user ?? event.destination_extension ?? null;
  let staffId: number | null = null;
  let agentName: string | null = null;
  if (extensionCode) {
    const [ext] = await db
      .select({ staffId: extensions.staffId, display: extensions.displayName })
      .from(extensions)
      .where(eq(extensions.extension, String(extensionCode)))
      .limit(1);
    staffId = ext?.staffId ?? null;
    agentName = ext?.display ?? null;
    if (staffId && !agentName) {
      const [s] = await db.select({ name: staff.name }).from(staff).where(eq(staff.id, staffId)).limit(1);
      agentName = s?.name ?? null;
    }
  }

  /* Whose number this is. A call has to land on the person's timeline or
     the desk cannot see that this lead was already rung twice today. */
  const other = inbound ? from : to;
  let leadId: string | null = null;
  let customerId: string | null = null;
  if (other) {
    const [lead] = await db
      .select({ id: leads.id, customerId: leads.customerId })
      .from(leads)
      .where(and(eq(leads.phoneE164, other), isNull(leads.mergedInto)))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    leadId = lead?.id ?? null;
    customerId = lead?.customerId ?? null;

    if (!customerId) {
      const [cust] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.phoneE164, other))
        .limit(1);
      customerId = cust?.id ?? null;
    }
  }

  const durationSeconds = Number(event.duration ?? 0) || 0;
  const startedAt = parseVonageTime(event.start_time) ?? new Date();
  const endedAt = parseVonageTime(event.end_time);
  const outcome = outcomeOf(status, event.detail ?? event.reason);

  /* Vonage sends several events per call, they arrive out of order, and a
     retried "answered" after "completed" is normal. Matching on the
     provider's own id means each one lands on the same row.

     Reading the row and then writing it lost that race. Two deliveries for
     one call can be in flight at the same millisecond: both saw no row,
     both inserted, and the second one hit uniq_call_external. That surfaces
     as a 500 — which is precisely the answer that makes Vonage redeliver,
     so a single collision became a loop of them. One statement, arbitrated
     by the unique index itself, cannot race with a copy of itself.

     Everything below only ever moves a call FORWARD. A late "ringing" must
     not turn a finished three-minute call back into "Attempted · 0 sec" in
     the log the studios are measured on. */
  const resultUpdate = !outcome
    // started / ringing: this delivery carries no outcome to record.
    ? sql`${calls.result}`
    : TERMINAL.has(status)
      // The call is over. This delivery is the final word on it.
      ? sql`excluded.result`
      // Mid-call progress only fills an outcome we do not have yet.
      : sql`case when ${calls.result} = 'Attempted' then excluded.result else ${calls.result} end`;

  await db
    .insert(calls)
    .values({
      direction: inbound ? "inbound" : "outbound",
      provider: "vonage",
      externalCallId: callId,
      fromNumber: from ?? "",
      toNumber: to ?? "",
      customerId,
      leadId,
      locationId: studio?.id ?? null,
      staffId,
      agentName,
      extension: extensionCode ? String(extensionCode) : null,
      startTime: startedAt,
      endTime: endedAt,
      duration: durationSeconds,
      result: outcome ?? "Attempted",
      hasRecording: Boolean(event.recording_url),
      recordingUrl: event.recording_url ?? null,
      initiatedFromConsole: false,
      raw: event as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [calls.provider, calls.externalCallId],
      set: {
        result: resultUpdate,
        /* An out-of-order delivery reports the duration as of ITS moment,
           which is shorter. The longest one is the true length. */
        duration: sql`greatest(${calls.duration}, excluded.duration)`,
        /* startTime falls back to now() when Vonage sends no start_time, so
           a later delivery carrying the real one is the earlier instant. */
        startTime: sql`least(${calls.startTime}, excluded.start_time)`,
        endTime: sql`coalesce(excluded.end_time, ${calls.endTime})`,
        recordingUrl: sql`coalesce(excluded.recording_url, ${calls.recordingUrl})`,
        hasRecording: sql`(${calls.hasRecording} or excluded.has_recording)`,
        /* Fill in what an earlier delivery did not carry, never blank out
           what it did. Vonage names the extension on some events and not
           others, and the studio only resolves once we know a number. */
        staffId: sql`coalesce(${calls.staffId}, excluded.staff_id)`,
        agentName: sql`coalesce(${calls.agentName}, excluded.agent_name)`,
        extension: sql`coalesce(${calls.extension}, excluded.extension)`,
        locationId: sql`coalesce(${calls.locationId}, excluded.location_id)`,
        leadId: sql`coalesce(${calls.leadId}, excluded.lead_id)`,
        customerId: sql`coalesce(${calls.customerId}, excluded.customer_id)`,
        fromNumber: sql`coalesce(nullif(excluded.from_number, ''), ${calls.fromNumber})`,
        toNumber: sql`coalesce(nullif(excluded.to_number, ''), ${calls.toNumber})`,
        raw: sql`excluded.raw`,
      },
    });

  /* The console's call board is what the floor watches; a five-minute-old
     poll cannot drive it. */
  await db.insert(realtimeEvents).values({
    channel: "calls:live",
    topic: `call.${status}`,
    locationId: studio?.id ?? null,
    requiredPermission: "calls.view",
    payload: {
      callId,
      direction: inbound ? "inbound" : "outbound",
      from,
      to,
      status,
      agent: agentName,
      leadId,
      duration: durationSeconds,
    },
  });

  await db
    .update(webhookDeliveries)
    .set({ processed: true, processedAt: new Date() })
    .where(
      and(
        eq(webhookDeliveries.provider, "vonage"),
        eq(webhookDeliveries.externalSid, callId),
        gte(webhookDeliveries.receivedAt, new Date(Date.now() - 60_000)),
      ),
    );

  void locations;
  return Response.json({ ok: true });
}
