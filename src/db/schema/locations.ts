/* ── Studios (locations) · numbers · artists · extensions ─────────────── */
import {
  pgTable, serial, text, integer, bigint, boolean, numeric, jsonb, timestamp,
  primaryKey, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { numberKindEnum } from "./enums";

export interface DayHours { enabled: boolean; open: string; close: string }
export interface BusinessHours { mon: DayHours; tue: DayHours; wed: DayHours; thu: DayHours; fri: DayHours; sat: DayHours; sun: DayHours }
export interface SocialLinks { instagram?: string; facebook?: string; tiktok?: string; twitter?: string; youtube?: string }
export interface TwilioConfig { accountSid?: string; authToken?: string; messagingSid?: string; specificPhone?: string; smsAutomation?: boolean }
export interface VonageConfig { did?: string; extension?: string }
export interface SmtpConfig { enabled?: boolean; senderName?: string; senderEmail?: string; host?: string; port?: number; username?: string; password?: string; encryption?: string }

export const locations = pgTable(
  "locations",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),                       // "Cleopatra Ink Tacoma"
    slug: text("slug").notNull().unique(),              // public URL /{slug}/book
    /** legacy timely_locations.id — keeps the migration mapping honest */
    legacyId: integer("legacy_id").unique(),
    manager: text("manager"),
    branchPhone: text("branch_phone"),
    email: text("email"),
    address: text("address"),
    city: text("city").notNull(),
    state: text("state"),
    country: text("country").notNull().default("USA"),
    countryCode: text("country_code").notNull().default("US"),
    zip: text("zip"),
    accent: text("accent"),
    imageUrl: text("image_url"),
    gtmCountry: text("gtm_country"),
    gtmCityState: text("gtm_city_state"),
    mapsUrl: text("maps_url"),
    /** Timely's own id for this studio. */
    timelyId: bigint("timely_id", { mode: "number" }),
    lat: numeric("lat", { precision: 10, scale: 7 }),
    lng: numeric("lng", { precision: 11, scale: 8 }),
    /** FINDING #5 — IANA tz is the single source of truth for slot maths.
     *  Must match the studio's real geography (Tacoma = America/Los_Angeles). */
    timezone: text("timezone").notNull().default("America/New_York"),
    timezoneFriendly: text("timezone_friendly"),
    defaultLocale: text("default_locale").notNull().default("en"),
    displayOrder: integer("display_order").notNull().default(0),
    /** Concurrent appointments per slot: one ours, one from GetTimely. */
    slotCapacity: integer("slot_capacity").notNull().default(2),
    bookingIntervalMin: integer("booking_interval_min").notNull().default(30),
    bookingActive: boolean("booking_active").notNull().default(true),
    /** booking-window rules surfaced by /api/booking/config */
    maxBookingDaysAhead: integer("max_booking_days_ahead").notNull().default(14),
    sameDayLeadHours: integer("same_day_lead_hours").notNull().default(2),
    vipPickupEnabled: boolean("vip_pickup_enabled").notNull().default(false),
    social: jsonb("social").$type<SocialLinks>().notNull().default({}),
    twilio: jsonb("twilio").$type<TwilioConfig>().notNull().default({}),
    vonage: jsonb("vonage").$type<VonageConfig>().notNull().default({}),
    smtp: jsonb("smtp").$type<SmtpConfig>().notNull().default({}),
    hours: jsonb("hours").$type<Partial<BusinessHours>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index("idx_locations_active").on(t.bookingActive),
    orderIdx: index("idx_locations_order").on(t.displayOrder),
  }),
);

/** Routable numbers — inbound DID → location resolution */
export const numbers = pgTable(
  "numbers",
  {
    id: serial("id").primaryKey(),
    locationId: integer("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
    kind: numberKindEnum("kind").notNull(),
    label: text("label").notNull(),
    numberE164: text("number_e164").notNull().unique(),
    smsCapable: boolean("sms_capable").notNull().default(false),
  },
  (t) => ({ locIdx: index("idx_numbers_location").on(t.locationId) }),
);

export const artists = pgTable("artists", {
  id: serial("id").primaryKey(),
  legacyId: text("legacy_id"),
  name: text("name").notNull(),
  email: text("email"),
  phoneE164: text("phone_e164"),
  instagram: text("instagram"),
  specialties: text("specialties").array().notNull().default([]),
  portfolioUrls: text("portfolio_urls").array().notNull().default([]),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  active: boolean("active").notNull().default(true),
  /* Timely publishes each artist's diary as an iCalendar feed. Fetching
     these is how the booking engine learns the studio is already busy. */
  calendarFeedUrl: text("calendar_feed_url"),
  feedCheckedAt: timestamp("feed_checked_at", { withTimezone: true }),
  feedError: text("feed_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artistLocations = pgTable(
  "artist_locations",
  {
    artistId: integer("artist_id").notNull().references(() => artists.id, { onDelete: "cascade" }),
    locationId: integer("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.artistId, t.locationId] }) }),
);

/** Vonage extension directory. locationId null = call-centre pool. */
export const extensions = pgTable(
  "extensions",
  {
    id: serial("id").primaryKey(),
    extension: text("extension").notNull().unique(),
    displayName: text("display_name").notNull(),
    username: text("username"),
    phoneNumber: text("phone_number"),
    email: text("email"),
    userType: text("user_type").notNull().default("END_USER"),
    locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
    staffId: integer("staff_id"),                       // resolved agent, set by sync
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    locIdx: index("idx_extensions_location").on(t.locationId),
    userIdx: uniqueIndex("idx_extensions_username").on(t.username),
  }),
);
