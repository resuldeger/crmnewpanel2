/* ── Booking funnel domain — FINDING #1 (was missing entirely) ─────────── */
import {
  pgTable, serial, bigserial, text, integer, boolean, jsonb, timestamp, uuid,
  index, uniqueIndex, date, time, smallint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { locations } from "./locations";
import { bookingStepEnum, stepKeyEnum, availabilitySourceEnum, platformEnum } from "./enums";

/* ──────────────────────────────────────────────────────────────────────
 * 1. Locales — FINDING #7: the client must be told which locale it really
 *    got, and which ones exist. No more silent fallback to English.
 * ────────────────────────────────────────────────────────────────────── */
export const locales = pgTable("locales", {
  code: text("code").primaryKey(),                    // en | tr | es | de
  name: text("name").notNull(),                       // "German"
  nativeName: text("native_name").notNull(),          // "Deutsch"
  fallbackCode: text("fallback_code").notNull().default("en"),
  direction: text("direction").notNull().default("ltr"),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

/* ──────────────────────────────────────────────────────────────────────
 * 2. Translations — hierarchical, 4-layer resolution:
 *      global+en → global+locale → location+en → location+locale (wins)
 *    Serves BOTH the booking SPA and the CRM console (FINDING #2).
 * ────────────────────────────────────────────────────────────────────── */
export const translations = pgTable(
  "translations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** null = global default for every studio */
    locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }),
    /** "booking" (SPA) | "console" (CRM) | "sms" | "email" */
    app: text("app").notNull().default("booking"),
    namespace: text("namespace").notNull(),           // ui.buttons, step.style, body.areas, …
    key: text("key").notNull(),                       // continue, title, forearm, …
    locale: text("locale").notNull().references(() => locales.code, { onDelete: "cascade" }),
    value: text("value").notNull(),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // coalesce keeps "global" (null) rows unique alongside per-location overrides
    uniq: uniqueIndex("uniq_translation").on(
      sql`coalesce(${t.locationId}, 0)`, t.app, t.namespace, t.key, t.locale,
    ),
    lookupIdx: index("idx_translations_lookup").on(t.app, t.locale, t.namespace),
    locIdx: index("idx_translations_location").on(t.locationId),
  }),
);

/* ──────────────────────────────────────────────────────────────────────
 * 3. Step options — the dynamic wizard choices, with per-branch override.
 *    A row with locationId = X overrides the global row with the same
 *    (step_key, option_key); is_active=false hides it for that branch only.
 * ────────────────────────────────────────────────────────────────────── */
export const bookingStepOptions = pgTable(
  "booking_step_options",
  {
    id: serial("id").primaryKey(),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "cascade" }),
    stepKey: stepKeyEnum("step_key").notNull(),
    optionKey: text("option_key").notNull(),          // realism | black_grey | piercing | …
    /** { en: "Realism", tr: "Gerçekçi", … } — inline so one read serves the step */
    labelTranslations: jsonb("label_translations").$type<Record<string, string>>().notNull().default({}),
    descriptionTranslations: jsonb("description_translations").$type<Record<string, string>>().notNull().default({}),
    imageUrl: text("image_url"),
    /** when set, picking this option skips those wizard steps (piercing → skips story/body/size) */
    skipsSteps: text("skips_steps").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("uniq_step_option").on(sql`coalesce(${t.locationId}, 0)`, t.stepKey, t.optionKey),
    lookupIdx: index("idx_step_options_lookup").on(t.stepKey, t.isActive, t.sortOrder),
  }),
);

/* ──────────────────────────────────────────────────────────────────────
 * 4. Booking sessions — every visitor, every step, every abandonment.
 *    This is what powers lead recovery and the drop-off funnel report.
 * ────────────────────────────────────────────────────────────────────── */
export interface UtmData {
  source?: string | null; medium?: string | null; campaign?: string | null;
  term?: string | null; content?: string | null; id?: string | null;
}
export interface ClickIds {
  gclid?: string | null; gbraid?: string | null; wbraid?: string | null; dclid?: string | null;
  fbclid?: string | null; msclkid?: string | null; ttclid?: string | null; sccid?: string | null;
  epik?: string | null; twclid?: string | null; li_fat_id?: string | null;
  rdt_cid?: string | null; yclid?: string | null;
}

export const bookingSessions = pgTable(
  "booking_sessions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionUuid: uuid("session_uuid").notNull().unique().defaultRandom(),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
    locationSlug: text("location_slug"),
    locale: text("locale").notNull().default("en"),

    /* funnel position */
    currentStep: bookingStepEnum("current_step").notNull().default("welcome"),
    currentStepIndex: smallint("current_step_index").notNull().default(0),
    maxStepReached: smallint("max_step_reached").notNull().default(0),
    dropOffStep: bookingStepEnum("drop_off_step"),
    isCompleted: boolean("is_completed").notNull().default(false),

    /* contact captured mid-funnel — FINDING #8: only these fields are
       persisted from form_data; the rest stays in stepData as answers. */
    fullName: text("full_name"),
    email: text("email"),
    phoneE164: text("phone_e164"),
    smsConsent: boolean("sms_consent").notNull().default(false),
    /** true when the contact step was pulled to index 1 by an ad param */
    contactFirst: boolean("contact_first").notNull().default(false),

    stepData: jsonb("step_data").$type<Record<string, unknown>>().notNull().default({}),

    /* attribution */
    platform: platformEnum("platform").notNull().default("direct"),
    utm: jsonb("utm").$type<UtmData>().notNull().default({}),
    clickIds: jsonb("click_ids").$type<ClickIds>().notNull().default({}),
    extraParams: jsonb("extra_params").$type<Record<string, string>>().notNull().default({}),
    landingUrl: text("landing_url"),
    referrer: text("referrer"),

    /* device & trust — FINDING #9 */
    ip: text("ip"),
    ipCountry: text("ip_country"),
    userAgent: text("user_agent"),
    deviceType: text("device_type"),
    browser: text("browser"),
    os: text("os"),
    userTimezone: text("user_timezone"),
    turnstilePassed: boolean("turnstile_passed").notNull().default(false),
    turnstileToken: text("turnstile_token"),
    isTrusted: boolean("is_trusted").notNull().default(true),

    /* outcome */
    leadId: text("lead_id"),
    appointmentId: integer("appointment_id"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    recoveryScheduledAt: timestamp("recovery_scheduled_at", { withTimezone: true }),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    locIdx: index("idx_sessions_location_created").on(t.locationId, t.createdAt),
    createdIdx: index("idx_sessions_created").on(t.createdAt),
    phoneIdx: index("idx_sessions_phone").on(t.phoneE164),
    /* the abandoned-funnel queue: has a phone, never converted */
    abandonedIdx: index("idx_sessions_abandoned")
      .on(t.updatedAt)
      .where(sql`${t.isCompleted} = false and ${t.phoneE164} is not null`),
    funnelIdx: index("idx_sessions_funnel").on(t.locationId, t.maxStepReached, t.createdAt),
  }),
);

/* ──────────────────────────────────────────────────────────────────────
 * 5. Availability blocks — hybrid source of truth for slot maths.
 *    Timely is read into this table; our own appointments write to it too.
 * ────────────────────────────────────────────────────────────────────── */
export const availabilityBlocks = pgTable(
  "availability_blocks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    locationId: integer("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
    artistId: integer("artist_id"),
    /** UTC instants — never local wall-clock (FINDING #4) */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    source: availabilitySourceEnum("source").notNull(),
    externalId: text("external_id"),
    appointmentId: integer("appointment_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    rangeIdx: index("idx_availability_range").on(t.locationId, t.startsAt, t.endsAt),
    extIdx: uniqueIndex("uniq_availability_external").on(t.source, t.externalId),
  }),
);

/** Manual weekly closures / holidays that aren't a single block */
export const locationClosures = pgTable(
  "location_closures",
  {
    id: serial("id").primaryKey(),
    locationId: integer("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    allDay: boolean("all_day").notNull().default(true),
    fromTime: time("from_time"),
    toTime: time("to_time"),
    reason: text("reason"),
  },
  (t) => ({ dayIdx: index("idx_closures_day").on(t.locationId, t.day) }),
);

/* ──────────────────────────────────────────────────────────────────────
 * 6. Uploads — reference artwork (was an untracked path on disk)
 * ────────────────────────────────────────────────────────────────────── */
export const uploads = pgTable(
  "uploads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: integer("session_id"),
    appointmentId: integer("appointment_id"),
    leadId: text("lead_id"),
    url: text("url").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    checksum: text("checksum"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index("idx_uploads_session").on(t.sessionId),
    apptIdx: index("idx_uploads_appointment").on(t.appointmentId),
  }),
);
