/* ── Operator accountability · who did what, when, to which record ──────
 * Requirement: "editörlerimizin hangi randevuları ne yaptığı, hangi
 * aramaları yaptığı" — every side effect is attributable to a person.
 * activity_log is append-only: no UPDATE, no DELETE grants.
 * ────────────────────────────────────────────────────────────────────── */
import {
  pgTable, bigserial, serial, text, integer, boolean, jsonb, timestamp,
  date, index, uniqueIndex, real,
} from "drizzle-orm/pg-core";
import { locations } from "./locations";
import { staff } from "./rbac";
import { sql } from "drizzle-orm";
import { actorKindEnum, auditTargetEnum, auditActionEnum } from "./enums";

export const activityLog = pgTable(
  "activity_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorKind: actorKindEnum("actor_kind").notNull().default("user"),
    // No FK on purpose (migration 0020): an append-only trail cannot
    // accept the SET NULL a cascade would perform, and it keeps actorName
    // denormalised so it stays readable after the account is gone.
    actorStaffId: integer("actor_staff_id"),
    actorName: text("actor_name").notNull(),
    actorRoleId: text("actor_role_id"),
    locationId: integer("location_id"),

    targetType: auditTargetEnum("target_type").notNull(),
    targetId: text("target_id").notNull(),
    targetLabel: text("target_label"),                 // denormalized: "Jane Doe · BK-4F2A91"
    action: auditActionEnum("action").notNull(),

    fromValue: text("from_value"),
    toValue: text("to_value"),
    /** shallow field-level diff: { status: [from, to], assignee: [from, to] } */
    diff: jsonb("diff").$type<Record<string, [unknown, unknown]>>().notNull().default({}),
    summary: text("summary"),

    /* request context — makes an audit defensible */
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    durationMs: integer("duration_ms"),

    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index("idx_activity_actor").on(t.actorStaffId, t.at),
    targetIdx: index("idx_activity_target").on(t.targetType, t.targetId, t.at),
    locIdx: index("idx_activity_location").on(t.locationId, t.at),
    atIdx: index("idx_activity_at").on(t.at),
    actionIdx: index("idx_activity_action").on(t.action, t.at),
  }),
);

/** Live agent presence — drives the wallboard and the socket roster */
export const staffPresence = pgTable("staff_presence", {
  staffId: integer("staff_id").primaryKey().references(() => staff.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("offline"),     // online | busy | away | on_call | offline
  activeLocationId: integer("active_location_id").references(() => locations.id, { onDelete: "set null" }),
  currentCallId: integer("current_call_id"),
  currentRoute: text("current_route"),
  socketId: text("socket_id"),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  since: timestamp("since", { withTimezone: true }).notNull().defaultNow(),
});

/* ──────────────────────────────────────────────────────────────────────
 * Pre-aggregated rollups. Reporting reads these, never the raw tables —
 * that is what keeps the reports instant at 45 studios of history.
 * Refreshed incrementally by the `rollup` worker (every 10 min + nightly
 * full recompute of the trailing 3 days).
 * ────────────────────────────────────────────────────────────────────── */

/** Per agent, per day, per studio — the operator scorecard */
export const staffDailyStats = pgTable(
  "staff_daily_stats",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    day: date("day").notNull(),
    staffId: integer("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
    locationId: integer("location_id"),  // no FK: see 0020 { onDelete: "cascade" }),

    callsOutbound: integer("calls_outbound").notNull().default(0),
    callsInbound: integer("calls_inbound").notNull().default(0),
    callsAnswered: integer("calls_answered").notNull().default(0),
    callsMissed: integer("calls_missed").notNull().default(0),
    talkSeconds: integer("talk_seconds").notNull().default(0),
    avgTalkSeconds: real("avg_talk_seconds").notNull().default(0),

    leadsTouched: integer("leads_touched").notNull().default(0),
    leadStatusChanges: integer("lead_status_changes").notNull().default(0),
    leadsConverted: integer("leads_converted").notNull().default(0),
    /** seconds from lead creation to this agent's first call */
    avgSpeedToLeadSeconds: real("avg_speed_to_lead_seconds"),
    slaMetCount: integer("sla_met_count").notNull().default(0),
    slaBreachedCount: integer("sla_breached_count").notNull().default(0),

    apptsConfirmed: integer("appts_confirmed").notNull().default(0),
    apptsCompleted: integer("appts_completed").notNull().default(0),
    apptsCancelled: integer("appts_cancelled").notNull().default(0),
    apptsNoShow: integer("appts_no_show").notNull().default(0),

    smsSent: integer("sms_sent").notNull().default(0),
    notesAdded: integer("notes_added").notNull().default(0),
    tasksCompleted: integer("tasks_completed").notNull().default(0),

    revenueCents: integer("revenue_cents").notNull().default(0),
    depositCents: integer("deposit_cents").notNull().default(0),
    activeSeconds: integer("active_seconds").notNull().default(0),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("uniq_staff_daily").on(t.day, t.staffId, sql`coalesce(${t.locationId}, 0)`),
    dayIdx: index("idx_staff_daily_day").on(t.day),
    staffIdx: index("idx_staff_daily_staff").on(t.staffId, t.day),
  }),
);

/** Per studio, per day — the executive dashboard's source */
export const locationDailyStats = pgTable(
  "location_daily_stats",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    day: date("day").notNull(),
    locationId: integer("location_id"),  // no FK: see 0020 { onDelete: "cascade" }),

    sessionsStarted: integer("sessions_started").notNull().default(0),
    sessionsCompleted: integer("sessions_completed").notNull().default(0),
    sessionsAbandoned: integer("sessions_abandoned").notNull().default(0),
    recoveredFromAbandon: integer("recovered_from_abandon").notNull().default(0),

    leadsNew: integer("leads_new").notNull().default(0),
    leadsCalled: integer("leads_called").notNull().default(0),
    leadsConverted: integer("leads_converted").notNull().default(0),

    apptsCreated: integer("appts_created").notNull().default(0),
    apptsConfirmed: integer("appts_confirmed").notNull().default(0),
    apptsCompleted: integer("appts_completed").notNull().default(0),
    apptsCancelled: integer("appts_cancelled").notNull().default(0),
    apptsNoShow: integer("appts_no_show").notNull().default(0),

    callsTotal: integer("calls_total").notNull().default(0),
    callsAnswered: integer("calls_answered").notNull().default(0),
    callsMissed: integer("calls_missed").notNull().default(0),
    talkSeconds: integer("talk_seconds").notNull().default(0),

    smsOutbound: integer("sms_outbound").notNull().default(0),
    smsInbound: integer("sms_inbound").notNull().default(0),
    optOuts: integer("opt_outs").notNull().default(0),

    revenueCents: integer("revenue_cents").notNull().default(0),
    depositCents: integer("deposit_cents").notNull().default(0),
    noShowCostCents: integer("no_show_cost_cents").notNull().default(0),

    /** speed-to-lead buckets, in seconds: <300 / 300-900 / 900-3600 / >3600 / never */
    sla_0_5m: integer("sla_0_5m").notNull().default(0),
    sla_5_15m: integer("sla_5_15m").notNull().default(0),
    sla_15_60m: integer("sla_15_60m").notNull().default(0),
    sla_60m_plus: integer("sla_60m_plus").notNull().default(0),
    slaNeverCalled: integer("sla_never_called").notNull().default(0),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("uniq_location_daily").on(t.day, t.locationId),
    dayIdx: index("idx_location_daily_day").on(t.day),
  }),
);

/** Funnel drop-off per step, per studio, per day */
export const funnelDailyStats = pgTable(
  "funnel_daily_stats",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    day: date("day").notNull(),
    locationId: integer("location_id"),  // no FK: see 0020 { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    stepKey: text("step_key").notNull(),
    reached: integer("reached").notNull().default(0),
    droppedHere: integer("dropped_here").notNull().default(0),
    advanced: integer("advanced").notNull().default(0),
    avgSecondsOnStep: real("avg_seconds_on_step"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex("uniq_funnel_daily").on(t.day, t.locationId, t.stepIndex) }),
);

/** Marketing attribution rollup — CPL / ROAS once cost is entered */
export const attributionDailyStats = pgTable(
  "attribution_daily_stats",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    day: date("day").notNull(),
    locationId: integer("location_id"),  // no FK: see 0020 { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    sessions: integer("sessions").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    appointments: integer("appointments").notNull().default(0),
    completed: integer("completed").notNull().default(0),
    revenueCents: integer("revenue_cents").notNull().default(0),
    /** filled from the ad platforms or entered by hand → CPL / ROAS */
    spendCents: integer("spend_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("uniq_attribution_daily").on(
      t.day, t.locationId, t.platform,
      sql`coalesce(${t.utmSource}, '')`, sql`coalesce(${t.utmMedium}, '')`, sql`coalesce(${t.utmCampaign}, '')`,
    ),
    dayIdx: index("idx_attribution_daily_day").on(t.day),
  }),
);

/** Hour-of-week demand heatmap — shift planning */
export const demandHeatmap = pgTable(
  "demand_heatmap",
  {
    id: serial("id").primaryKey(),
    locationId: integer("location_id"),  // no FK: see 0020 { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    dow: integer("dow").notNull(),                   // 0=Mon
    hour: integer("hour").notNull(),                 // 0-23, studio local time
    leads: integer("leads").notNull().default(0),
    calls: integer("calls").notNull().default(0),
    appointments: integer("appointments").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex("uniq_demand_cell").on(t.locationId, t.weekStart, t.dow, t.hour) }),
);

/** Bookkeeping for the rollup worker so it can resume incrementally */
export const rollupCheckpoints = pgTable("rollup_checkpoints", {
  name: text("name").primaryKey(),
  lastProcessedId: text("last_processed_id"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  running: boolean("running").notNull().default(false),
  lastError: text("last_error"),
});
