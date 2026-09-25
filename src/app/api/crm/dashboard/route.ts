import { NextResponse, type NextRequest } from "next/server";
import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { leads, appointments, calls, smsMessages, locations } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";
import { scopeWhere, compact, parseDays } from "@/server/crm/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Headline numbers, this window versus the one before it. */
export const GET = withAuth("reports.view", async (user, req: NextRequest) => {
  const days = parseDays(req.nextUrl.searchParams.get("days"));
  const now = Date.now();
  const from = new Date(now - days * 86_400_000);
  const prevFrom = new Date(now - 2 * days * 86_400_000);

  const leadScope = scopeWhere(user, leads.locationId);
  const apptScope = scopeWhere(user, appointments.locationId);
  const callScope = scopeWhere(user, calls.locationId);

  async function window(start: Date, end: Date | null) {
    // Same predicate across four different tables, so the column type has
    // to be the generic one rather than any single table's.
    const inWindow = (col: PgColumn) =>
      end ? and(gte(col, start), sql`${col} < ${end}`) : gte(col, start);

    const [newLeads, converted, booked, completed, callRows, smsOut] = await Promise.all([
      db.select({ n: count() }).from(leads)
        .where(and(...compact([inWindow(leads.createdAt), isNull(leads.mergedInto), leadScope]))),
      db.select({ n: count() }).from(leads)
        .where(and(...compact([inWindow(leads.createdAt), sql`${leads.convertedAt} is not null`, leadScope]))),
      db.select({ n: count() }).from(appointments)
        .where(and(...compact([inWindow(appointments.createdAt), apptScope]))),
      db.select({ n: count() }).from(appointments)
        .where(and(...compact([inWindow(appointments.createdAt), eq(appointments.status, "completed"), apptScope]))),
      db.select({
        total: count(),
        answered: sql<number>`count(*) filter (where ${calls.result} = 'Answered')::int`,
        talk: sql<number>`coalesce(sum(${calls.duration}), 0)::int`,
      }).from(calls).where(and(...compact([inWindow(calls.startTime), callScope]))),
      db.select({ n: count() }).from(smsMessages)
        .where(and(...compact([inWindow(smsMessages.createdAt), eq(smsMessages.direction, "outbound")]))),
    ]);

    return {
      leads: newLeads[0]?.n ?? 0,
      converted: converted[0]?.n ?? 0,
      appointments: booked[0]?.n ?? 0,
      completed: completed[0]?.n ?? 0,
      calls: callRows[0]?.total ?? 0,
      callsAnswered: callRows[0]?.answered ?? 0,
      talkSeconds: callRows[0]?.talk ?? 0,
      smsOutbound: smsOut[0]?.n ?? 0,
    };
  }

  const [current, previous, byPlatform, byStudio] = await Promise.all([
    window(from, null),
    window(prevFrom, from),
    db
      .select({ platform: leads.platform, n: count() })
      .from(leads)
      .where(and(...compact([gte(leads.createdAt, from), isNull(leads.mergedInto), leadScope])))
      .groupBy(leads.platform),
    db
      .select({ locationId: leads.locationId, city: locations.city, n: count() })
      .from(leads)
      .innerJoin(locations, eq(locations.id, leads.locationId))
      .where(and(...compact([gte(leads.createdAt, from), isNull(leads.mergedInto), leadScope])))
      .groupBy(leads.locationId, locations.city)
      .orderBy(sql`count(*) desc`)
      .limit(10),
  ]);

  /* The daily series and the funnel the dashboard draws. Both were static
     arrays in the browser — the volume chart, the sparklines and the
     conversion funnel all showed the same invented numbers whatever the
     business actually did, which made the reporting screen worse than no
     reporting screen.

     generate_series gives every day in the window a row, so a quiet day
     plots as zero instead of being dropped and pulling the line forward. */
  const scopeIds = user.scopeAll ? null : user.locationIds;
  const scopeSql = (col: string) =>
    scopeIds && scopeIds.length > 0
      ? sql`and ${sql.raw(col)} = any(${sql.param(scopeIds)}::int[])`
      : scopeIds
        ? sql`and false`
        : sql``;

  const series = await db.execute<{
    day: string; leads: number; appointments: number; calls: number;
  }>(sql`
    with span as (
      select generate_series(
        (${from}::timestamptz at time zone 'UTC')::date,
        (now() at time zone 'UTC')::date,
        interval '1 day'
      )::date as day
    )
    select
      to_char(span.day, 'DD Mon') as day,
      (select count(*)::int from leads l
        where l.created_at::date = span.day and l.merged_into is null
        ${scopeSql("l.location_id")}) as leads,
      (select count(*)::int from appointments a
        where a.created_at::date = span.day
        ${scopeSql("a.location_id")}) as appointments,
      (select count(*)::int from calls c
        where c.start_time::date = span.day
        ${scopeSql("c.location_id")}) as calls
    from span order by span.day
  `).then((r) => r.rows);

  /* The funnel is measured, not assumed: every stage is a count of real
     rows, so the drop between two stages is a real drop. */
  const [funnelRow] = await db.execute<{
    sessions: number; identified: number; leadsTotal: number;
    contacted: number; booked: number; completed: number;
  }>(sql`
    select
      (select count(*)::int from booking_sessions s
        where s.created_at >= ${from} ${scopeSql("s.location_id")}) as sessions,
      (select count(*)::int from booking_sessions s
        where s.created_at >= ${from} and s.phone_e164 is not null
        ${scopeSql("s.location_id")}) as identified,
      (select count(*)::int from leads l
        where l.created_at >= ${from} and l.merged_into is null
        ${scopeSql("l.location_id")}) as "leadsTotal",
      (select count(*)::int from leads l
        where l.created_at >= ${from} and l.merged_into is null
          and l.call_status <> 'not_called' ${scopeSql("l.location_id")}) as contacted,
      (select count(*)::int from appointments a
        where a.created_at >= ${from} ${scopeSql("a.location_id")}) as booked,
      (select count(*)::int from appointments a
        where a.created_at >= ${from} and a.status = 'completed'
        ${scopeSql("a.location_id")}) as completed
  `).then((r) => r.rows);

  const funnel = [
    { key: "Sessions", count: Number(funnelRow?.sessions ?? 0), color: "#948d7d" },
    { key: "Identified", count: Number(funnelRow?.identified ?? 0), color: "#fba200" },
    { key: "Leads", count: Number(funnelRow?.leadsTotal ?? 0), color: "#e8a33d" },
    { key: "Contacted", count: Number(funnelRow?.contacted ?? 0), color: "#4c8dff" },
    { key: "Booked", count: Number(funnelRow?.booked ?? 0), color: "#2fbf71" },
    { key: "Completed", count: Number(funnelRow?.completed ?? 0), color: "#1e9e5c" },
  ];

  return NextResponse.json(
    { days, current, previous, byPlatform, byStudio, series, funnel },
    { headers: { "Cache-Control": "no-store" } },
  );
});
