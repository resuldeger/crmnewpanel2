/* ── CRM core · leads / appointments / calls / notes / tasks ───────────── */
import {
  pgTable, serial, bigserial, text, integer, boolean, jsonb, timestamp,
  date, time, index, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { locations, artists } from "./locations";
import { staff } from "./rbac";
import { bookingSessions } from "./booking";
import {
  platformEnum, lifecycleEnum, callStatusEnum, apptStatusEnum,
  callDirEnum, callResultEnum, notableEnum, taskStatusEnum, taskSourceEnum,
  leadSourceEnum,
} from "./enums";

export interface LeadMeta {
  purpose?: string; style?: string; storyType?: string; story?: string; size?: string;
  bodyAreas?: string[]; referenceImages?: string[]; language?: string; consent?: boolean;
}
export interface LeadAttr {
  utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null;
  utmTerm?: string | null; utmContent?: string | null;
  gclid?: string | null; fbclid?: string | null; ttclid?: string | null;
  landingPage?: string | null; referrer?: string | null; matchMethod?: string;
}

/* ── Customers: one human, however many leads they file ────────────────
 * The console's Customer 360 view aggregates over this identity. */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicUid: text("public_uid").notNull().unique(),   // used by /api/customers/{uid}
    name: text("name"),
    email: text("email"),
    phoneE164: text("phone_e164"),
    locationId: integer("location_id").references(() => locations.id),
    locale: text("locale").notNull().default("en"),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    firstTouchAt: timestamp("first_touch_at", { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    mergedInto: uuid("merged_into"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneIdx: uniqueIndex("uniq_customers_phone").on(t.phoneE164).where(sql`${t.mergedInto} is null and ${t.phoneE164} is not null`),
    emailIdx: index("idx_customers_email").on(t.email),
    locIdx: index("idx_customers_location").on(t.locationId),
  }),
);

export const leads = pgTable(
  "leads",
  {
    id: text("id").primaryKey(),                       // LEAD-1042 — quoted on the phone
    customerId: uuid("customer_id").references(() => customers.id),
    sessionId: integer("session_id").references(() => bookingSessions.id, { onDelete: "set null" }),
    locationId: integer("location_id").notNull().references(() => locations.id),
    name: text("name").notNull(),
    email: text("email"),
    phoneE164: text("phone_e164"),
    platform: platformEnum("platform").notNull().default("webform"),
    lifecycleStatus: lifecycleEnum("lifecycle_status").notNull().default("new"),
    callStatus: callStatusEnum("call_status").notNull().default("not_called"),
    source: leadSourceEnum("source").notNull().default("abandoned_form"),
    locale: text("locale").notNull().default("en"),

    /* A lead LEAVES the pipeline the moment it becomes a booking.
     * convertedAt is the switch: null = still in the pipeline, set = booked.
     * The row is never deleted — the funnel report needs its history. */
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    convertedAppointmentId: integer("converted_appointment_id"),

    /* ownership — who is responsible, who actually worked it */
    assignedStaffId: integer("assigned_staff_id").references(() => staff.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),

    utm: jsonb("utm").$type<LeadAttr>().notNull().default({}),
    meta: jsonb("meta").$type<LeadMeta>().notNull().default({}),

    /* SLA clock */
    firstCalledAt: timestamp("first_called_at", { withTimezone: true }),
    firstCalledByStaffId: integer("first_called_by_staff_id").references(() => staff.id, { onDelete: "set null" }),
    lastCalledAt: timestamp("last_called_at", { withTimezone: true }),
    callAttempts: integer("call_attempts").notNull().default(0),

    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    turnstilePassed: boolean("turnstile_passed").notNull().default(false),
    isTrusted: boolean("is_trusted").notNull().default(true),

    mergedInto: text("merged_into"),                   // soft merge — history is kept
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /* the pipeline: never merged away, never yet converted */
    activeIdx: index("idx_leads_active").on(t.locationId, t.callStatus)
      .where(sql`${t.mergedInto} is null and ${t.convertedAt} is null`),
    phoneIdx: index("idx_leads_phone").on(t.phoneE164).where(sql`${t.mergedInto} is null and ${t.phoneE164} is not null`),
    slaIdx: index("idx_leads_sla").on(t.createdAt)
      .where(sql`${t.callStatus} = 'not_called' and ${t.mergedInto} is null and ${t.convertedAt} is null`),
    assignedIdx: index("idx_leads_assigned").on(t.assignedStaffId, t.callStatus),
    createdIdx: index("idx_leads_created").on(t.createdAt),
    customerIdx: index("idx_leads_customer").on(t.customerId),
  }),
);

export const appointments = pgTable(
  "appointments",
  {
    id: serial("id").primaryKey(),
    bkUuid: text("bk_uuid").notNull().unique(),        // public reference BK-XXXXXXXX
    leadId: text("lead_id").references(() => leads.id),
    customerId: uuid("customer_id").references(() => customers.id),
    sessionId: integer("session_id").references(() => bookingSessions.id, { onDelete: "set null" }),
    locationId: integer("location_id").notNull().references(() => locations.id),
    artistId: integer("artist_id").references(() => artists.id, { onDelete: "set null" }),

    name: text("name").notNull(),
    email: text("email"),
    phoneE164: text("phone_e164"),

    purpose: text("purpose"), style: text("style"), size: text("size"),
    storyType: text("story_type"), story: text("story"),
    bodyAreas: text("body_areas").array().notNull().default([]),
    referenceImageUrl: text("reference_image_url"),

    /* FINDING #4 — startsAt is the ONLY thing slot collision, reminders and
     * reports read. preferredDate/Time are kept purely for display. */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    preferredDate: date("preferred_date").notNull(),
    preferredTime: time("preferred_time").notNull(),
    displayTimezone: text("display_timezone").notNull(),   // studio tz used for the slot label
    userTimezone: text("user_timezone"),                   // browser tz at submit time

    status: apptStatusEnum("status").notNull().default("pending"),
    cancelReason: text("cancel_reason"),
    rescheduledFromId: integer("rescheduled_from_id"),

    /* ownership / operator attribution */
    assignedStaffId: integer("assigned_staff_id").references(() => staff.id, { onDelete: "set null" }),
    confirmedByStaffId: integer("confirmed_by_staff_id").references(() => staff.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedByStaffId: integer("completed_by_staff_id").references(() => staff.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledByStaffId: integer("cancelled_by_staff_id").references(() => staff.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    /* money — integer cents, always */
    estimatedPriceCents: integer("estimated_price_cents").notNull().default(0),
    depositCents: integer("deposit_cents").notNull().default(0),
    depositPaid: boolean("deposit_paid").notNull().default(false),
    depositPaidAt: timestamp("deposit_paid_at", { withTimezone: true }),
    finalPriceCents: integer("final_price_cents"),
    currency: text("currency").notNull().default("USD"),

    isFreePick: boolean("is_free_pick").notNull().default(false),
    addressStreet: text("address_street"), addressCity: text("address_city"),
    addressState: text("address_state"), addressZip: text("address_zip"),

    locale: text("locale").notNull().default("en"),
    platform: platformEnum("platform").notNull().default("webform"),
    campaign: text("campaign"),
    consent: boolean("consent").notNull().default(false),
    turnstilePassed: boolean("turnstile_passed").notNull().default(false),
    isTrusted: boolean("is_trusted").notNull().default(true),
    ip: text("ip"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    startsIdx: index("idx_appts_location_starts").on(t.locationId, t.startsAt),
    statusIdx: index("idx_appts_status").on(t.status, t.startsAt),
    leadIdx: index("idx_appts_lead").on(t.leadId),
    assignedIdx: index("idx_appts_assigned").on(t.assignedStaffId, t.startsAt),
    artistIdx: index("idx_appts_artist").on(t.artistId, t.startsAt),
    /* open bookings that still occupy a slot */
    liveIdx: index("idx_appts_live").on(t.locationId, t.startsAt)
      .where(sql`${t.status} in ('pending','confirmed','deposit_paid')`),
  }),
);

export const calls = pgTable(
  "calls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Which carrier produced this leg — Vonage VBC or Twilio Voice. */
    provider: text("provider").notNull().default("vonage"),
    /** Carrier's own id (Vonage call uuid / Twilio CallSid). Unique per
     *  provider, which is what makes webhook retries idempotent. */
    externalCallId: text("external_call_id"),
    direction: callDirEnum("direction").notNull(),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number").notNull(),
    fromName: text("from_name"), toName: text("to_name"),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    appointmentId: integer("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
    /** which human made/answered it — powers the agent performance report */
    staffId: integer("staff_id").references(() => staff.id, { onDelete: "set null" }),
    agentName: text("agent_name"),
    extension: text("extension"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }),
    ringSeconds: integer("ring_seconds").notNull().default(0),
    duration: integer("duration").notNull().default(0),
    result: callResultEnum("result").notNull(),
    hasRecording: boolean("has_recording").notNull().default(false),
    recordingUrl: text("recording_url"),
    recordingPath: text("recording_path"),
    /** true when this call was initiated from the console (click-to-call) */
    initiatedFromConsole: boolean("initiated_from_console").notNull().default(false),
    /** Inbound calls to a branch's Twilio number are forwarded on to the
     *  studio's real phone; this is the number we dialled. */
    forwardedTo: text("forwarded_to"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    startIdx: index("idx_calls_start").on(t.startTime),
    staffIdx: index("idx_calls_staff_start").on(t.staffId, t.startTime),
    locIdx: index("idx_calls_location_start").on(t.locationId, t.startTime),
    leadIdx: index("idx_calls_lead").on(t.leadId),
    customerIdx: index("idx_calls_customer").on(t.customerId),
    resultIdx: index("idx_calls_result").on(t.result, t.startTime),
    externalIdx: uniqueIndex("uniq_call_external").on(t.provider, t.externalCallId),
  }),
);

/** Raw Vonage event stream — feeds the live call floor over WebSocket */
export const vonageEvents = pgTable(
  "vonage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventUuid: text("event_uuid").unique(),
    callUuid: text("call_uuid"),
    eventType: text("event_type").notNull(),
    locationId: integer("location_id"),
    staffId: integer("staff_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ callIdx: index("idx_vonage_events_call").on(t.callUuid, t.occurredAt) }),
);

export const notes = pgTable(
  "notes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    notableType: notableEnum("notable_type").notNull(),
    notableId: text("notable_id").notNull(),
    authorStaffId: integer("author_staff_id").references(() => staff.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    content: text("content").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ targetIdx: index("idx_notes_target").on(t.notableType, t.notableId, t.createdAt) }),
);

export const tasks = pgTable(
  "tasks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    title: text("title").notNull(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    appointmentId: integer("appointment_id").references(() => appointments.id, { onDelete: "cascade" }),
    leadName: text("lead_name"),
    phoneE164: text("phone_e164"),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }),
    assigneeStaffId: integer("assignee_staff_id").references(() => staff.id, { onDelete: "set null" }),
    createdByStaffId: integer("created_by_staff_id").references(() => staff.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: taskStatusEnum("status").notNull().default("open"),
    source: taskSourceEnum("source").notNull().default("manual"),
    retryCount: integer("retry_count").notNull().default(0),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneByStaffId: integer("done_by_staff_id").references(() => staff.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    openIdx: index("idx_tasks_open").on(t.assigneeStaffId, t.dueAt).where(sql`${t.status} = 'open'`),
    leadIdx: index("idx_tasks_lead").on(t.leadId),
    /* one auto follow-up per lead per source — dedupes the SLA monitor */
    dedupeIdx: uniqueIndex("uniq_task_auto").on(sql`coalesce(${t.leadId}, '')`, t.source)
      .where(sql`${t.status} = 'open' and ${t.source} in ('follow_up','sla_breach')`),
  }),
);
