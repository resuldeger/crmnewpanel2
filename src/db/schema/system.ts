/* ── System · settings / integrations / webhooks / outbox ─────────────── */
import {
  pgTable, bigserial, serial, text, integer, boolean, jsonb, timestamp,
  index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { locations } from "./locations";
import { staff } from "./rbac";

/** Single-row console preferences */
export const workspaceSettings = pgTable("workspace_settings", {
  id: integer("id").primaryKey().default(1),
  defaultDateRange: text("default_date_range").notNull().default("30"),
  autoAssign: boolean("auto_assign").notNull().default(false),
  autoAssignStrategy: text("auto_assign_strategy").notNull().default("round_robin"), // round_robin | least_busy | by_language
  smsSound: boolean("sms_sound").notNull().default(true),
  dailyDigest: boolean("daily_digest").notNull().default(true),
  slaTargetMinutes: integer("sla_target_minutes").notNull().default(15),
  slaEscalateMinutes: integer("sla_escalate_minutes").notNull().default(60),
  defaultLocale: text("default_locale").notNull().default("en"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Integration credentials. secretEnc is encrypted at rest; never leaves the server in clear. */
export const integrations = pgTable(
  "integrations",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull(),            // vonage | twilio | timely | meta | google | tiktok | turnstile
    locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    publicKey: text("public_key"),
    secretEnc: text("secret_enc"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastStatus: text("last_status"),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),

    /* Set when the SYSTEM stopped this integration after a failure.
       `enabled` above stays the operator's own switch, so "I turned it off"
       and "it broke and stopped itself" never get confused — and a halt
       survives a restart, which an in-process brake does not. */
    haltedAt: timestamp("halted_at", { withTimezone: true }),
    haltReason: text("halt_reason"),
    haltDetail: text("halt_detail"),
    failureCount: integer("failure_count").notNull().default(0),
    firstFailedAt: timestamp("first_failed_at", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    /* Denormalised, and deliberately not a foreign key: the audit trail is
       append-only and an FK here would make a staff row undeletable. */
    clearedBy: integer("cleared_by"),
    clearedByName: text("cleared_by_name"),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex("uniq_integration").on(t.provider, sql`coalesce(${t.locationId}, 0)`) }),
);

/** Idempotent webhook inbox — Twilio/Vonage/Meta retries are safe */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    provider: text("provider").notNull(),
    externalSid: text("external_sid").notNull(),
    eventType: text("event_type").notNull(),
    signatureValid: boolean("signature_valid").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    processed: boolean("processed").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("uniq_webhook_delivery").on(t.provider, t.externalSid, t.eventType),
    unprocessedIdx: index("idx_webhook_unprocessed").on(t.receivedAt).where(sql`${t.processed} = false`),
  }),
);

/** Realtime fan-out log. Rows are NOTIFY'd and replayed to reconnecting sockets. */
export const realtimeEvents = pgTable(
  "realtime_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    channel: text("channel").notNull(),              // calls:live | sms:thread:42 | leads:live | presence
    topic: text("topic").notNull(),                  // call.ringing | sms.received | lead.assigned
    locationId: integer("location_id"),
    /** when set, only this staff member receives it */
    staffId: integer("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    /** permission required to receive — the gateway filters on it */
    requiredPermission: text("required_permission"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    channelIdx: index("idx_realtime_channel").on(t.channel, t.id),
    createdIdx: index("idx_realtime_created").on(t.createdAt),
  }),
);

/** In-app notifications (SLA breach, assignment, mention) */
export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    staffId: integer("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    severity: text("severity").notNull().default("info"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    unreadIdx: index("idx_notifications_unread").on(t.staffId, t.createdAt).where(sql`${t.readAt} is null`),
  }),
);

/** Per-IP / per-session throttle counters for the public booking API */
export const rateLimits = pgTable(
  "rate_limits",
  {
    bucket: text("bucket").primaryKey(),             // "session:PUT:<ip>" etc.
    count: integer("count").notNull().default(0),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  },
);
