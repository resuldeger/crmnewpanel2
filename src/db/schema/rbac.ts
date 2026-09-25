/* ── RBAC · roles / permissions / staff (profiles) / location scope ───── */
import {
  pgTable, text, boolean, integer, serial, bigserial, timestamp, primaryKey, index,
} from "drizzle-orm/pg-core";
import { locations } from "./locations";

export const roles = pgTable("roles", {
  id: text("id").primaryKey(),                 // super_admin | hq_admin | branch_manager | studio_admin | callcenter_agent | viewer
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("#7d8590"),
  isSystem: boolean("is_system").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const permissions = pgTable("permissions", {
  id: text("id").primaryKey(),                 // leads.view, sms.send, …
  label: text("label").notNull(),
  groupName: text("group_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permissionId] }) }),
);

/** StaffMember — console users. Auth handled by Auth.js against this table. */
export const staff = pgTable(
  "staff",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash"),        // bcrypt; null = SSO-only account
    roleId: text("role_id").notNull().references(() => roles.id),
    scopeAll: boolean("scope_all").notNull().default(false),   // locationIds === "all"
    active: boolean("active").notNull().default(true),
    locale: text("locale").notNull().default("en"),
    avatarUrl: text("avatar_url"),
    phoneE164: text("phone_e164"),
    /** Vonage extension this agent answers on — links calls to the person */
    vonageExtension: text("vonage_extension"),
    vonageUsername: text("vonage_username"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roleIdx: index("idx_staff_role").on(t.roleId),
    extIdx: index("idx_staff_extension").on(t.vonageExtension),
    activeIdx: index("idx_staff_active").on(t.active),
  }),
);

/** Branch scope — only consulted when scopeAll = false */
export const locationScopes = pgTable(
  "location_scopes",
  {
    staffId: integer("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
    locationId: integer("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.staffId, t.locationId] }) }),
);

/** Auth.js sessions (database strategy) — revocable from the console */
export const sessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    staffId: integer("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ staffIdx: index("idx_auth_sessions_staff").on(t.staffId) }),
);

/* An invitation to set a password. Only the hash is stored — a leaked
 * database must not hand out working invites, same rule as sessions. */
export const staffInvites = pgTable(
  "staff_invites",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    staffId: integer("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
    invitedBy: integer("invited_by").references(() => staff.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ openIdx: index("idx_staff_invites_open").on(t.staffId) }),
);
