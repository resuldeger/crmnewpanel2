/* ── Timely, the way it actually works ─────────────────────────────────
 * Not one account: several. Each Timely login sees some of the studios and
 * not others, so "which account knows about Riverside" is a real question
 * the sync has to answer before it can ask anything else.
 *
 * And Timely's own ids are not ours. A studio is `locations` here and a
 * `timely_locations` row there, and the two are matched ONCE, deliberately,
 * rather than re-guessed from a name on every sweep — a studio renamed in
 * Timely must not silently become a different studio here.
 * ────────────────────────────────────────────────────────────────── */
import {
  boolean, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, index,
} from "drizzle-orm/pg-core";
/* BusinessHours is already ours — the booking engine reads the same shape
   off `locations`, and a second definition here would drift from it. */
import { locations, artists, type BusinessHours } from "./locations";

export const timelyAccounts = pgTable("timely_accounts", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  email: text("email").notNull().unique(),
  /* Sealed, not hashed: we have to replay it at Timely's login form.
     See server/crypto/secretBox.ts. */
  passwordEnc: text("password_enc"),
  /* The session, so a sweep does not log in again every time. Timely puts
     a Cloudflare cookie in here too, and a stale one is what turns a
     working login into a 403 — so the login clears them before retrying. */
  cookies: jsonb("cookies").$type<Record<string, string>>().notNull().default({}),
  active: boolean("active").notNull().default(true),

  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A studio as Timely knows it, and which of ours it is. */
export const timelyLocations = pgTable(
  "timely_locations",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => timelyAccounts.id, { onDelete: "cascade" }),
    /** Timely's own id. Unique per account, not globally. */
    timelyId: text("timely_id").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    /** Slug derived from the name, only ever a SUGGESTION for the match. */
    slug: text("slug"),
    businessHours: jsonb("business_hours").$type<Partial<BusinessHours>>().notNull().default({}),
    slotMinutes: integer("slot_minutes"),

    /* ── The mapping ──────────────────────────────────────────────
     * Null until somebody confirms it. Matching on a name every sweep is
     * how a studio renamed in Timely quietly becomes a different studio
     * here; this is set once and then left alone. */
    locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    linkedByName: text("linked_by_name"),

    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("uniq_timely_location").on(t.accountId, t.timelyId),
    locIdx: index("idx_timely_location_mapped").on(t.locationId),
  }),
);

/** A member of staff as Timely knows them, and which artist that is. */
export const timelyStaff = pgTable(
  "timely_staff",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => timelyAccounts.id, { onDelete: "cascade" }),
    timelyId: text("timely_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    /** Timely's own flag; 1 is active in their staffList payload. */
    status: integer("status").notNull().default(1),

    artistId: integer("artist_id").references(() => artists.id, { onDelete: "set null" }),
    webhookUrl: text("webhook_url"),
    webhookCheckedAt: timestamp("webhook_checked_at", { withTimezone: true }),
    webhookError: text("webhook_error"),
    linkedAt: timestamp("linked_at", { withTimezone: true }),

    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("uniq_timely_staff").on(t.accountId, t.timelyId),
  }),
);

/** Which Timely studios a Timely staff member works at. */
export const timelyStaffLocations = pgTable(
  "timely_staff_locations",
  {
    staffId: integer("staff_id").notNull().references(() => timelyStaff.id, { onDelete: "cascade" }),
    locationId: integer("location_id").notNull().references(() => timelyLocations.id, { onDelete: "cascade" }),
  },
  (t) => ({
    uniq: uniqueIndex("uniq_timely_staff_location").on(t.staffId, t.locationId),
  }),
);
