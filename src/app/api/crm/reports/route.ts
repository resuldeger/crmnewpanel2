import { NextResponse, type NextRequest } from "next/server";
import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { leads, appointments, calls, locations } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";
import { scopeWhere, compact, parseDays } from "@/server/crm/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Reporting, aggregated in the database ─────────────────────────────
 * The reports screen used to pull every lead, appointment and call into
 * the browser and reduce over them. That is fine on seed data and hopeless
 * on a real chain: a year of 46 studios is hundreds of thousands of rows
 * shipped to a laptop to produce about forty numbers.
 *
 * One point of substance moved with it. The heatmap bucketed by
 * `new Date(createdAt).getHours()` — the hour in *the viewer's* timezone.
 * The same Seattle lead therefore landed in a different cell for someone
 * reading from Istanbul, and a chain-wide heatmap smeared every studio
 * across whatever timezone the reader happened to be in. Grouping now
 * happens at each studio's own local hour, which is the only reading of
 * "when do people enquire" that means anything operationally.
 * ────────────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

export const GET = withAuth("reports.view", async (user, req: NextRequest) => {
  const raw = req.nextUrl.searchParams.get("days");
  /* "all" keeps the screen's existing option. There is no previous window
     to compare an unbounded range against, so deltas are withheld rather
     than invented. */
  const days = raw === "all" ? null : parseDays(raw);
  const now = Date.now();
  const from = days === null ? new Date(0) : new Date(now - days * DAY_MS);
  const prevFrom = days === null ? null : new Date(now - 2 * days * DAY_MS);

  const leadScope = scopeWhere(user, leads.locationId);
  const apptScope = scopeWhere(user, appointments.locationId);
  const callScope = scopeWhere(user, calls.locationId);

  const between = (col: PgColumn, start: Date, end: Date | null) =>
    end ? and(gte(col, start), sql`${col} < ${end}`) : gte(col, start);

  /** The three counts a delta needs, for one window. */
  async function totals(start: Date, end: Date | null) {
    const [l, a, c] = await Promise.all([
      db.select({ n: count() }).from(leads)
        .where(and(...compact([between(leads.createdAt, start, end), isNull(leads.mergedInto), leadScope]))),
      db.select({ n: count() }).from(appointments)
        .where(and(...compact([between(appointments.createdAt, start, end), apptScope]))),
      db.select({
        total: count(),
        answered: sql<number>`count(*) filter (where ${calls.result} = 'Answered')::int`,
        talk: sql<number>`coalesce(sum(${calls.duration}) filter (where ${calls.result} = 'Answered'), 0)::int`,
      }).from(calls).where(and(...compact([between(calls.startTime, start, end), callScope]))),
    ]);
    const calls_ = c[0]?.total ?? 0;
    const answered = c[0]?.answered ?? 0;
    return {
      leads: l[0]?.n ?? 0,
      appointments: a[0]?.n ?? 0,
      calls: calls_,
      answered,
      answerRate: calls_ ? Math.round((answered / calls_) * 100) : 0,
      avgTalkSeconds: answered ? Math.round((c[0]?.talk ?? 0) / answered) : 0,
    };
  }

  const leadWindow = compact([
    between(leads.createdAt, from, null),
    isNull(leads.mergedInto),
    leadScope,
  ]);
  const apptWindow = compact([between(appointments.createdAt, from, null), apptScope]);

  const [current, previous, sla, heatRows, platforms, leadCampaigns, apptCampaigns, ops, studioLeads, studioAppts] =
    await Promise.all([
      totals(from, null),
      prevFrom ? totals(prevFrom, from) : Promise.resolve(null),

      /* Speed to lead. `never` counts the ones nobody rang at all, which is
         the number that actually costs bookings, so it is kept apart from
         the slow-but-called buckets rather than folded into them. */
      db
        .select({
          u5: sql<number>`count(*) filter (where ${leads.lastCalledAt} is not null and ${leads.callStatus} <> 'not_called' and extract(epoch from ${leads.lastCalledAt} - ${leads.createdAt}) <= 300)::int`,
          u15: sql<number>`count(*) filter (where ${leads.lastCalledAt} is not null and ${leads.callStatus} <> 'not_called' and extract(epoch from ${leads.lastCalledAt} - ${leads.createdAt}) > 300 and extract(epoch from ${leads.lastCalledAt} - ${leads.createdAt}) <= 900)::int`,
          u60: sql<number>`count(*) filter (where ${leads.lastCalledAt} is not null and ${leads.callStatus} <> 'not_called' and extract(epoch from ${leads.lastCalledAt} - ${leads.createdAt}) > 900 and extract(epoch from ${leads.lastCalledAt} - ${leads.createdAt}) <= 3600)::int`,
          over: sql<number>`count(*) filter (where ${leads.lastCalledAt} is not null and ${leads.callStatus} <> 'not_called' and extract(epoch from ${leads.lastCalledAt} - ${leads.createdAt}) > 3600)::int`,
          never: sql<number>`count(*) filter (where ${leads.callStatus} = 'not_called' or ${leads.lastCalledAt} is null)::int`,
          /* The screen showed an "average first response" derived from the
             lead count — a formula, not a measurement. This is the real
             thing: the median beats the mean here because one lead called
             back three days later drags an average past usefulness. */
          medianResponseSeconds: sql<number>`coalesce(percentile_cont(0.5) within group (
            order by extract(epoch from ${leads.lastCalledAt} - ${leads.createdAt})
          ) filter (where ${leads.lastCalledAt} is not null and ${leads.callStatus} <> 'not_called'), 0)::int`,
        })
        .from(leads)
        .where(and(...leadWindow)),

      /* Day and hour in the studio's own timezone — see the note above.
         Monday is 0 to match the grid the screen draws. */
      db
        .select({
          day: sql<number>`((extract(dow from ${leads.createdAt} at time zone ${locations.timezone})::int + 6) % 7)`,
          hour: sql<number>`extract(hour from ${leads.createdAt} at time zone ${locations.timezone})::int`,
          n: count(),
        })
        .from(leads)
        .innerJoin(locations, eq(locations.id, leads.locationId))
        .where(and(...leadWindow))
        .groupBy(sql`1`, sql`2`),

      db
        .select({ platform: leads.platform, n: count() })
        .from(leads)
        .where(and(...leadWindow))
        .groupBy(leads.platform)
        .orderBy(sql`count(*) desc`),

      /* utm lives in a jsonb blob; ->> yields null for a missing key, and
         an organic lead genuinely has none, so both collapse to "organic". */
      db
        .select({
          campaign: sql<string>`coalesce(nullif(${leads.utm} ->> 'utmCampaign', ''), 'organic')`,
          n: count(),
        })
        .from(leads)
        .where(and(...leadWindow))
        .groupBy(sql`1`),

      db
        .select({
          campaign: sql<string>`coalesce(nullif(${appointments.campaign}, ''), 'organic')`,
          n: count(),
        })
        .from(appointments)
        .where(and(...apptWindow))
        .groupBy(sql`1`),

      db
        .select({
          total: count(),
          lost: sql<number>`count(*) filter (where ${appointments.status} in ('no_show','cancelled'))::int`,
        })
        .from(appointments)
        .where(and(...apptWindow)),

      /* The leaderboard is two counts per studio. Done in the browser it
         meant one filter pass per studio per metric over the full lead and
         appointment arrays — 46 studios × 2, on every render. */
      db
        .select({ locationId: leads.locationId, name: locations.name, n: count() })
        .from(leads)
        .innerJoin(locations, eq(locations.id, leads.locationId))
        .where(and(...leadWindow))
        .groupBy(leads.locationId, locations.name),

      db
        .select({ locationId: appointments.locationId, name: locations.name, n: count() })
        .from(appointments)
        .innerJoin(locations, eq(locations.id, appointments.locationId))
        .where(and(...apptWindow))
        .groupBy(appointments.locationId, locations.name),
    ]);

  // The screen draws 7 days × 13 buckets of 1.5 hours, from 08:00 to 22:00.
  const heat: number[][] = Array.from({ length: 7 }, () => Array(13).fill(0));
  for (const row of heatRows) {
    if (row.hour < 8 || row.hour > 22) continue;
    const bucket = Math.min(12, Math.max(0, Math.floor((row.hour - 8) / 1.5)));
    heat[row.day][bucket] += row.n;
  }

  const campaigns = new Map<string, { leads: number; appts: number }>();
  for (const r of leadCampaigns) {
    const e = campaigns.get(r.campaign) ?? { leads: 0, appts: 0 };
    e.leads += r.n;
    campaigns.set(r.campaign, e);
  }
  for (const r of apptCampaigns) {
    const e = campaigns.get(r.campaign) ?? { leads: 0, appts: 0 };
    e.appts += r.n;
    campaigns.set(r.campaign, e);
  }

  const board = new Map<number, { id: number; name: string; leads: number; appts: number }>();
  for (const r of studioLeads) {
    board.set(r.locationId, { id: r.locationId, name: r.name, leads: r.n, appts: 0 });
  }
  for (const r of studioAppts) {
    const e = board.get(r.locationId) ?? { id: r.locationId, name: r.name, leads: 0, appts: 0 };
    e.appts = r.n;
    board.set(r.locationId, e);
  }

  const apptTotal = ops[0]?.total ?? 0;
  const lost = ops[0]?.lost ?? 0;
  const calledCount = (sla[0]?.u5 ?? 0) + (sla[0]?.u15 ?? 0) + (sla[0]?.u60 ?? 0) + (sla[0]?.over ?? 0);

  return NextResponse.json(
    {
      window: { days, from: from.toISOString(), comparable: previous !== null },
      current: {
        ...current,
        conversion: current.leads ? Math.round((current.appointments / current.leads) * 100) : 0,
      },
      /* Null when the range is unbounded. The screen previously compared the
         answer rate against a hardcoded 71, so every chain showed a delta
         against a number that came from nowhere. */
      previous: previous
        ? {
            ...previous,
            conversion: previous.leads ? Math.round((previous.appointments / previous.leads) * 100) : 0,
          }
        : null,
      sla: {
        ...(sla[0] ?? { u5: 0, u15: 0, u60: 0, over: 0, never: 0, medianResponseSeconds: 0 }),
        called: calledCount,
        withinSla: calledCount
          ? Math.round((((sla[0]?.u5 ?? 0) + (sla[0]?.u15 ?? 0)) / calledCount) * 100)
          : 0,
      },
      heat,
      platforms: platforms.map((p) => [p.platform, p.n] as const),
      campaigns: [...campaigns.entries()]
        .sort((a, b) => b[1].leads - a[1].leads)
        .slice(0, 8),
      studios: [...board.values()].sort((a, b) => b.appts - a.appts || b.leads - a.leads),
      ops: {
        noShowCancel: lost,
        noShowRate: apptTotal ? Math.round((lost / apptTotal) * 100) : 0,
        callsPerBooking: apptTotal ? Number((current.calls / apptTotal).toFixed(1)) : 0,
        avgTalkSeconds: current.avgTalkSeconds,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
