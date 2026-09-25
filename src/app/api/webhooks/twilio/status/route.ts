import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  smsMessages, smsConversations, locations,
  campaigns, campaignRecipients, realtimeEvents, webhookDeliveries,
} from "@/db/schema";
import { verifyTwilioSignature, publicUrl, formToRecord } from "@/server/twilio/signature";
import { twiml } from "@/server/twilio/twiml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_MAP: Record<string, "queued" | "sent" | "delivered" | "undelivered" | "failed"> = {
  queued: "queued",
  accepted: "queued",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  undelivered: "undelivered",
  failed: "failed",
};

/** Delivery receipts for messages we sent. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return twiml("");

  const params = formToRecord(form);
  const sid = params.MessageSid ?? params.SmsSid ?? null;
  const raw = params.MessageStatus ?? params.SmsStatus ?? "";
  const status = STATUS_MAP[raw];

  // A studio on its own Twilio subaccount signs with ITS token, not the
  // shared one — so resolve the token from the message we are being told
  // about before verifying. Falls back to the account-level token.
  let authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  if (sid) {
    const [owner] = await db
      .select({ twilio: locations.twilio })
      .from(smsMessages)
      .innerJoin(smsConversations, eq(smsConversations.id, smsMessages.conversationId))
      .innerJoin(locations, eq(locations.id, smsConversations.locationId))
      .where(eq(smsMessages.providerSid, sid))
      .limit(1);
    authToken = owner?.twilio?.authToken ?? authToken;
  }

  const valid = verifyTwilioSignature(
    authToken,
    publicUrl(req),
    params,
    req.headers.get("x-twilio-signature"),
  );
  if (!valid && process.env.TWILIO_SKIP_SIGNATURE !== "1") {
    return new Response("Invalid signature", { status: 403 });
  }
  if (!sid || !status) return twiml("");

  // One row per (sid, status): Twilio sends several as the message moves,
  // and each must be applied exactly once.
  const first = await db
    .insert(webhookDeliveries)
    .values({
      provider: "twilio",
      externalSid: `sms-status:${sid}:${status}`,
      eventType: "sms.status",
      payload: params,
      signatureValid: valid,
      processed: true,
      processedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  if (first.length === 0) return twiml("");

  const [message] = await db
    .update(smsMessages)
    .set({
      status,
      errorCode: params.ErrorCode ?? null,
      errorMessage: params.ErrorMessage ?? null,
      ...(status === "sent" ? { sentAt: new Date() } : {}),
      ...(status === "delivered" ? { deliveredAt: new Date() } : {}),
      // Twilio reports Price as a negative decimal string ("-0.00790").
      ...(params.Price
        ? {
            priceMicros: Math.round(Math.abs(Number(params.Price)) * 1_000_000),
            priceCurrency: params.PriceUnit ?? "USD",
          }
        : {}),
    })
    .where(eq(smsMessages.providerSid, sid))
    .returning({ id: smsMessages.id, conversationId: smsMessages.conversationId, campaignId: smsMessages.campaignId });

  // Campaign counters follow the same receipt.
  const [recipient] = await db
    .update(campaignRecipients)
    .set({
      status,
      ...(status === "delivered" ? { deliveredAt: new Date() } : {}),
      ...(status === "sent" ? { sentAt: new Date() } : {}),
      errorMessage: params.ErrorMessage ?? null,
    })
    .where(eq(campaignRecipients.providerSid, sid))
    .returning({ campaignId: campaignRecipients.campaignId });

  const campaignId = recipient?.campaignId ?? message?.campaignId ?? null;
  if (campaignId) {
    if (status === "delivered") {
      await db.update(campaigns)
        .set({ delivered: sql`${campaigns.delivered} + 1` })
        .where(eq(campaigns.id, campaignId));
    } else if (status === "failed" || status === "undelivered") {
      await db.update(campaigns)
        .set({ failed: sql`${campaigns.failed} + 1` })
        .where(eq(campaigns.id, campaignId));
    }
  }

  if (message) {
    await db.insert(realtimeEvents).values({
      channel: `sms:thread:${message.conversationId}`,
      topic: "sms.status",
      requiredPermission: "sms.view",
      payload: { messageId: message.id, status },
    });
  }

  return twiml("");
}
