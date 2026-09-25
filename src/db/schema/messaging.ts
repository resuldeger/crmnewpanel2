/* ── Messaging · conversations / messages / scheduled automation / campaigns ── */
import {
  pgTable, bigserial, serial, text, integer, boolean, jsonb, timestamp,
  index, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { locations } from "./locations";
import { staff } from "./rbac";
import { leads, appointments, customers } from "./crm";
import { bookingSessions } from "./booking";
import {
  callDirEnum, smsStatusEnum, channelEnum, messageKindEnum, campaignStatusEnum,
} from "./enums";

export const smsConversations = pgTable(
  "sms_conversations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    phoneE164: text("phone_e164").notNull().unique(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
    customerName: text("customer_name"),
    channel: channelEnum("channel").notNull().default("sms"),
    unreadCount: integer("unread_count").notNull().default(0),
    /** opt-out is global per phone, never per thread (A2P 10DLC) */
    unsubscribed: boolean("unsubscribed").notNull().default(false),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    lastMessageBody: text("last_message_body"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastDirection: callDirEnum("last_direction"),
    /** agent currently owning the thread — shown as "typing/handled by" */
    assignedStaffId: integer("assigned_staff_id").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    recentIdx: index("idx_conv_recent").on(t.lastMessageAt),
    unreadIdx: index("idx_conv_unread").on(t.unreadCount).where(sql`${t.unreadCount} > 0`),
    locIdx: index("idx_conv_location").on(t.locationId),
  }),
);

export const smsMessages = pgTable(
  "sms_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conversationId: integer("conversation_id").notNull().references(() => smsConversations.id, { onDelete: "cascade" }),
    direction: callDirEnum("direction").notNull(),
    channel: channelEnum("channel").notNull().default("sms"),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    body: text("body").notNull().default(""),
    mediaUrls: text("media_urls").array().notNull().default([]),
    segments: integer("segments").notNull().default(1),
    status: smsStatusEnum("status").notNull().default("queued"),
    kind: messageKindEnum("kind").notNull().default("manual"),
    /** who pressed send — null for automation (see senderKind) */
    senderStaffId: integer("sender_staff_id").references(() => staff.id, { onDelete: "set null" }),
    senderName: text("sender_name"),
    campaignId: integer("campaign_id"),
    providerSid: text("provider_sid").unique(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    /** Carrier cost in millionths of a currency unit. A US SMS costs
     *  $0.0079 — rounding that to whole cents reports 1¢, a ~27% error on
     *  every single message, which compounds badly in the cost reports. */
    priceMicros: integer("price_micros"),
    priceCurrency: text("price_currency"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    convIdx: index("idx_sms_conv_time").on(t.conversationId, t.createdAt),
    staffIdx: index("idx_sms_staff").on(t.senderStaffId, t.createdAt),
    campaignIdx: index("idx_sms_campaign").on(t.campaignId),
  }),
);

/* ──────────────────────────────────────────────────────────────────────
 * FINDING #3 — the automation queue had no home.
 * Lead recovery (5m/2h/24h) and appointment reminders (24h/3h) live here;
 * the every-minute worker drains it.
 * ────────────────────────────────────────────────────────────────────── */
export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: messageKindEnum("kind").notNull(),
    channel: channelEnum("channel").notNull().default("sms"),
    sessionId: integer("session_id").references(() => bookingSessions.id, { onDelete: "cascade" }),
    appointmentId: integer("appointment_id").references(() => appointments.id, { onDelete: "cascade" }),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }),
    toE164: text("to_e164").notNull(),
    locale: text("locale").notNull().default("en"),
    templateKey: text("template_key").notNull(),
    payload: jsonb("payload").$type<Record<string, string>>().notNull().default({}),
    renderedBody: text("rendered_body"),
    status: smsStatusEnum("status").notNull().default("scheduled"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    messageId: integer("message_id"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /* the worker's only query: due and still scheduled */
    dueIdx: index("idx_scheduled_due").on(t.scheduledAt).where(sql`${t.status} = 'scheduled'`),
    sessionIdx: index("idx_scheduled_session").on(t.sessionId),
    apptIdx: index("idx_scheduled_appointment").on(t.appointmentId),
    /* never schedule the same automation twice for the same target */
    /* NULLs are distinct in Postgres, so the nullable FKs are coalesced —
       otherwise the same reminder could be queued twice. */
    dedupeIdx: uniqueIndex("uniq_scheduled_kind").on(
      t.kind, t.toE164, sql`coalesce(${t.sessionId}, 0)`, sql`coalesce(${t.appointmentId}, 0)`,
    ).where(sql`${t.status} in ('scheduled','processing')`),
  }),
);

export interface CampaignSegment {
  locationIds?: number[] | "all";
  callStatuses?: string[] | "all";
  platforms?: string[] | "all";
  locales?: string[] | "all";
  createdAfter?: string;
  createdBefore?: string;
}

export const campaigns = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    body: text("body").notNull(),
    /** per-locale bodies so one campaign can address 4 languages */
    bodyTranslations: jsonb("body_translations").$type<Record<string, string>>().notNull().default({}),
    segment: jsonb("segment").$type<CampaignSegment>().notNull().default({}),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    total: integer("total").notNull().default(0),
    sent: integer("sent").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    replied: integer("replied").notNull().default(0),
    createdByStaffId: integer("created_by_staff_id").references(() => staff.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ statusIdx: index("idx_campaigns_status").on(t.status, t.scheduledAt) }),
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    toE164: text("to_e164").notNull(),
    locale: text("locale").notNull().default("en"),
    status: smsStatusEnum("status").notNull().default("queued"),
    providerSid: text("provider_sid").unique(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => ({
    pk: uniqueIndex("uniq_campaign_recipient").on(t.campaignId, t.leadId),
    queueIdx: index("idx_campaign_recipients_queue").on(t.campaignId, t.status),
  }),
);

/** Reusable SMS/email templates, per locale, with merge fields */
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    channel: channelEnum("channel").notNull().default("sms"),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }),
    bodyTranslations: jsonb("body_translations").$type<Record<string, string>>().notNull().default({}),
    subjectTranslations: jsonb("subject_translations").$type<Record<string, string>>().notNull().default({}),
    mergeFields: text("merge_fields").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex("uniq_template").on(sql`coalesce(${t.locationId}, 0)`, t.key, t.channel) }),
);

/** Global opt-out ledger — survives conversation deletion */
export const unsubscribes = pgTable(
  "unsubscribes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    phoneE164: text("phone_e164").notNull().unique(),
    customerId: uuid("customer_id"),
    reason: text("reason"),
    sourceKeyword: text("source_keyword"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
