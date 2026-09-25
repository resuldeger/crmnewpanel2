/* ── Outbound SMS ──────────────────────────────────────────────────────
 * Single funnel for every outbound message: agent replies, automation,
 * campaigns. Everything that can go wrong legally or operationally is
 * checked here, once, rather than at each call site.
 * ────────────────────────────────────────────────────────────────── */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  smsConversations, smsMessages, messageTemplates, unsubscribes,
  locations, leads, customers, realtimeEvents, activityLog,
} from "@/db/schema";
import { sendMessage, activeTransport } from "@/server/twilio/transport";
import { normalizeNumber } from "@/server/twilio/resolve";
import { checkPhone } from "@/server/booking/phone";
import { DEFAULT_TEMPLATES, render, segmentCount, type TemplateKey } from "./templates";

export type SendKind =
  | "lead_recovery_5m" | "lead_recovery_2h" | "lead_recovery_24h"
  | "appointment_reminder_24h" | "appointment_reminder_3h"
  | "booking_confirmation" | "winback" | "campaign" | "manual";

export interface SendRequest {
  to: string;
  locationId: number;
  body?: string;
  templateKey?: TemplateKey;
  vars?: Record<string, string | null | undefined>;
  locale?: string;
  kind?: SendKind;
  leadId?: string | null;
  campaignId?: number | null;
  /** null for automation; set when a human pressed send */
  senderStaffId?: number | null;
  senderName?: string | null;
  mediaUrls?: string[];
}

export type SendOutcome =
  | { ok: true; messageId: number; sid: string; segments: number; transport: string }
  | { ok: false; reason: "opted_out" | "no_number" | "no_sender" | "blocked" | "provider_error"; message: string };

/** Studio-specific template wins; otherwise the built-in default. */
async function resolveBody(req: SendRequest): Promise<string | null> {
  if (req.body) return req.body;
  if (!req.templateKey) return null;

  const locale = req.locale ?? "en";
  const rows = await db
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.key, req.templateKey), eq(messageTemplates.isActive, true)));

  const specific = rows.find((r) => r.locationId === req.locationId);
  const global = rows.find((r) => r.locationId === null);
  const bodies = specific?.bodyTranslations ?? global?.bodyTranslations ?? DEFAULT_TEMPLATES[req.templateKey];

  const template = bodies[locale] ?? bodies.en ?? Object.values(bodies)[0];
  return template ? render(template, req.vars ?? {}) : null;
}

export async function sendSms(req: SendRequest): Promise<SendOutcome> {
  /* Last line of defence. Everything upstream validates, but a job or a
     row written before that validation existed can still reach here, and
     the carrier bills a rejected message the same as a delivered one. */
  const checked = checkPhone(req.to);
  const to = checked.ok ? checked.e164! : normalizeNumber(req.to);
  if (!checked.ok) {
    return { ok: false, reason: "no_number", message: checked.reason ?? "Unusable number" };
  }
  if (!to) return { ok: false, reason: "no_number", message: "No usable phone number" };

  // ── Opt-out is global per phone and is checked before anything else.
  //    A2P 10DLC: messaging someone who sent STOP is a carrier violation.
  const [optOut] = await db
    .select({ phone: unsubscribes.phoneE164 })
    .from(unsubscribes)
    .where(eq(unsubscribes.phoneE164, to))
    .limit(1);
  if (optOut) return { ok: false, reason: "opted_out", message: "This number has opted out" };

  const [studio] = await db.select().from(locations).where(eq(locations.id, req.locationId)).limit(1);
  if (!studio) return { ok: false, reason: "no_sender", message: "Unknown studio" };

  const body = await resolveBody(req);
  if (!body) return { ok: false, reason: "blocked", message: "No message body" };

  const from = normalizeNumber(studio.twilio?.specificPhone);
  const messagingServiceSid = studio.twilio?.messagingSid ?? null;
  if (!from && !messagingServiceSid) {
    return { ok: false, reason: "no_sender", message: `${studio.name} has no Twilio sender configured` };
  }

  // ── Thread: reuse or open.
  let [conversation] = await db
    .select()
    .from(smsConversations)
    .where(eq(smsConversations.phoneE164, to))
    .limit(1);

  if (!conversation) {
    const [lead] = req.leadId
      ? await db.select().from(leads).where(eq(leads.id, req.leadId)).limit(1)
      : await db.select().from(leads).where(and(eq(leads.phoneE164, to), isNull(leads.mergedInto))).limit(1);
    const [customer] = lead?.customerId
      ? [{ id: lead.customerId }]
      : await db.select({ id: customers.id }).from(customers)
          .where(and(eq(customers.phoneE164, to), isNull(customers.mergedInto))).limit(1);

    [conversation] = await db
      .insert(smsConversations)
      .values({
        phoneE164: to,
        leadId: lead?.id ?? req.leadId ?? null,
        customerId: customer?.id ?? null,
        customerName: lead?.name ?? null,
        locationId: req.locationId,
      })
      .returning();
  }

  // A thread flagged unsubscribed is a second guard in case the ledger and
  // the thread ever drift apart.
  if (conversation.unsubscribed) {
    return { ok: false, reason: "opted_out", message: "This conversation is opted out" };
  }

  const segments = segmentCount(body);

  const [message] = await db
    .insert(smsMessages)
    .values({
      conversationId: conversation.id,
      direction: "outbound",
      channel: (req.mediaUrls?.length ?? 0) > 0 ? "mms" : "sms",
      fromNumber: from ?? messagingServiceSid,
      toNumber: to,
      body,
      mediaUrls: req.mediaUrls ?? [],
      segments,
      status: "queued",
      kind: req.kind ?? "manual",
      senderStaffId: req.senderStaffId ?? null,
      senderName: req.senderName ?? (req.senderStaffId ? null : "Automation"),
      campaignId: req.campaignId ?? null,
    })
    .returning();

  /* Twilio rejects the whole message when StatusCallback is not publicly
     reachable: a localhost base URL failed every real send with 21609
     instead of merely losing the delivery receipt. Sent only when the
     carrier could actually call it back. */
  const base = (process.env.PUBLIC_BASE_URL ?? "").trim();
  const reachable =
    /^https?:\/\//i.test(base) &&
    !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(base);
  const statusCallback = reachable ? `${base}/api/webhooks/twilio/status` : null;

  const result = await sendMessage({
    to,
    from,
    messagingServiceSid,
    body,
    mediaUrls: req.mediaUrls,
    statusCallback,
    accountSid: studio.twilio?.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? null,
    authToken: studio.twilio?.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? null,
  });

  /* Handing Twilio a message is not delivery. Their create call returns
     'queued'; only the status webhook can say sent / delivered / failed.
     Writing 'sent' here made every accepted message count as delivered in
     the reports, and the local log transport — which sends nothing at all —
     looked identical to a real delivery. */
  await db
    .update(smsMessages)
    .set({
      status: result.status === "failed" ? "failed" : "queued",
      providerSid: result.sid || null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
      sentAt: null,
    })
    .where(eq(smsMessages.id, message.id));

  if (result.status === "failed") {
    return { ok: false, reason: "provider_error", message: result.errorMessage ?? "Send failed" };
  }

  await db
    .update(smsConversations)
    .set({
      lastMessageBody: body.slice(0, 500),
      lastMessageAt: new Date(),
      lastDirection: "outbound",
      updatedAt: new Date(),
    })
    .where(eq(smsConversations.id, conversation.id));

  await db.insert(realtimeEvents).values({
    channel: `sms:thread:${conversation.id}`,
    topic: "sms.sent",
    locationId: req.locationId,
    requiredPermission: "sms.view",
    payload: { conversationId: conversation.id, messageId: message.id, to, segments },
  });

  // Who sent what to whom is an auditable act, automation included.
  await db.insert(activityLog).values({
    actorKind: req.senderStaffId ? "user" : "worker",
    actorStaffId: req.senderStaffId ?? null,
    actorName: req.senderName ?? "Automation",
    locationId: req.locationId,
    targetType: "message",
    targetId: String(message.id),
    targetLabel: `${conversation.customerName ?? to} · ${req.kind ?? "manual"}`,
    action: "sms_sent",
    summary: body.slice(0, 180),
  });

  return { ok: true, messageId: message.id, sid: result.sid, segments, transport: activeTransport() };
}

void sql;
