import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  smsConversations, smsMessages, unsubscribes, leads, customers,
  realtimeEvents, webhookDeliveries,
} from "@/db/schema";
import { verifyTwilioSignature, publicUrl, formToRecord } from "@/server/twilio/signature";
import { studioForInboundNumber, normalizeNumber } from "@/server/twilio/resolve";
import { twiml } from "@/server/twilio/twiml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Carrier-mandated opt-out keywords (A2P 10DLC). */
const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout", "dur", "iptal"]);
const START_WORDS = new Set(["start", "unstop", "yes", "basla", "başla"]);

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return twiml("");

  const params = formToRecord(form);
  const messageSid = params.MessageSid ?? params.SmsSid ?? null;
  const from = normalizeNumber(params.From);
  const to = params.To ?? null;
  const body = (params.Body ?? "").trim();

  const studio = await studioForInboundNumber(to);
  const valid = verifyTwilioSignature(
    studio?.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "",
    publicUrl(req),
    params,
    req.headers.get("x-twilio-signature"),
  );
  if (!valid && process.env.TWILIO_SKIP_SIGNATURE !== "1") {
    return new Response("Invalid signature", { status: 403 });
  }
  if (!from || !messageSid) return twiml("");

  // Twilio retries on any non-2xx; the unique key makes that harmless.
  const inserted = await db
    .insert(webhookDeliveries)
    .values({ provider: "twilio", externalSid: `sms-in:${messageSid}`, eventType: "sms.inbound", payload: params, signatureValid: valid })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  if (inserted.length === 0) return twiml(""); // already handled

  const keyword = body.toLowerCase().replace(/[^a-zçğıöşü]/gi, "");

  // ── Opt-out. The trigger on `unsubscribes` cascades this everywhere:
  //    conversation, lead, customer, and any queued automation.
  if (STOP_WORDS.has(keyword)) {
    await db
      .insert(unsubscribes)
      .values({ phoneE164: from, reason: "inbound_keyword", sourceKeyword: body.slice(0, 40) })
      .onConflictDoNothing();
  }

  if (START_WORDS.has(keyword)) {
    await db.delete(unsubscribes).where(eq(unsubscribes.phoneE164, from));
    await db
      .update(smsConversations)
      .set({ unsubscribed: false, unsubscribedAt: null })
      .where(eq(smsConversations.phoneE164, from));
  }

  // ── Thread: one per phone number, created on first contact.
  let [conversation] = await db
    .select()
    .from(smsConversations)
    .where(eq(smsConversations.phoneE164, from))
    .limit(1);

  if (!conversation) {
    const [lead] = await db
      .select({ id: leads.id, name: leads.name, customerId: leads.customerId, locationId: leads.locationId })
      .from(leads)
      .where(and(eq(leads.phoneE164, from), isNull(leads.mergedInto)))
      .limit(1);

    const [customer] = lead?.customerId
      ? [{ id: lead.customerId }]
      : await db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.phoneE164, from), isNull(customers.mergedInto)))
          .limit(1);

    [conversation] = await db
      .insert(smsConversations)
      .values({
        phoneE164: from,
        leadId: lead?.id ?? null,
        customerId: customer?.id ?? null,
        customerName: lead?.name ?? null,
        locationId: studio?.id ?? lead?.locationId ?? null,
      })
      .returning();
  }

  const mediaCount = Number(params.NumMedia ?? 0) || 0;
  const mediaUrls = Array.from({ length: mediaCount }, (_, i) => params[`MediaUrl${i}`]).filter(Boolean);

  await db.insert(smsMessages).values({
    conversationId: conversation.id,
    direction: "inbound",
    channel: mediaCount > 0 ? "mms" : "sms",
    fromNumber: from,
    toNumber: to,
    body,
    mediaUrls,
    // Inbound is billed per segment too. Without this the cost reports
    // counted only what we sent, so a long reply looked free.
    segments: Number(params.NumSegments ?? 1) || 1,
    status: "received",
    providerSid: messageSid,
  });

  await db
    .update(smsConversations)
    .set({
      unreadCount: sql`${smsConversations.unreadCount} + 1`,
      lastMessageBody: body.slice(0, 500),
      lastMessageAt: new Date(),
      lastDirection: "inbound",
      updatedAt: new Date(),
    })
    .where(eq(smsConversations.id, conversation.id));

  await db.insert(realtimeEvents).values({
    channel: `sms:thread:${conversation.id}`,
    topic: "sms.received",
    locationId: conversation.locationId,
    requiredPermission: "sms.view",
    payload: { conversationId: conversation.id, from, body: body.slice(0, 200), hasMedia: mediaCount > 0 },
  });

  await db
    .update(webhookDeliveries)
    .set({ processed: true, processedAt: new Date() })
    .where(eq(webhookDeliveries.id, inserted[0].id));

  // Empty TwiML: no auto-reply. Carriers send their own STOP confirmation.
  return twiml("");
}
