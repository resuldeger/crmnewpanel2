import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Job, JobResult } from "./types";

/**
 * Pre-aggregates the reporting tables.
 *
 * Reports read these, never the raw tables — that is what keeps them
 * instant once there is real history. Each run recomputes a trailing
 * window rather than appending, so a late webhook or a corrected record
 * is picked up instead of being frozen into yesterday's numbers.
 *
 * Every aggregate is grouped by the STUDIO's local day, not UTC: a Pacific
 * studio's Monday evening is Tuesday in UTC, and a report that split its
 * evenings across two days would be wrong in a way nobody would notice.
 *
 * The agent scorecard is per studio, so every sub-query is filtered by the
 * studio too. Without that an agent working two branches had the same SLA
 * figure repeated under each, inflating the totals. Activity with no studio
 * (signing in, say) is not studio work and seeds no row at all.
 */
const WINDOW_DAYS = 3;

export const rollups: Job = {
  name: "rollups",
  everyMs: 10 * 60_000,

  async run(): Promise<JobResult> {
    const since = `now() - interval '${WINDOW_DAYS} days'`;

    /* ── Per studio, per local day ─────────────────────────────────── */
    const location = await db.execute(sql`
      insert into location_daily_stats (
        day, location_id,
        sessions_started, sessions_completed, sessions_abandoned,
        leads_new, leads_called, leads_converted,
        appts_created, appts_confirmed, appts_completed, appts_cancelled, appts_no_show,
        calls_total, calls_answered, calls_missed, talk_seconds,
        sms_outbound, sms_inbound, opt_outs,
        revenue_cents, deposit_cents,
        sla_0_5m, sla_5_15m, sla_15_60m, sla_60m_plus, sla_never_called,
        updated_at
      )
      select d.day, d.location_id,
        coalesce(s.started, 0), coalesce(s.completed, 0), coalesce(s.abandoned, 0),
        coalesce(l.new_leads, 0), coalesce(l.called, 0), coalesce(l.converted, 0),
        coalesce(a.created, 0), coalesce(a.confirmed, 0), coalesce(a.completed, 0),
        coalesce(a.cancelled, 0), coalesce(a.no_show, 0),
        coalesce(c.total, 0), coalesce(c.answered, 0), coalesce(c.missed, 0), coalesce(c.talk, 0),
        coalesce(m.outbound, 0), coalesce(m.inbound, 0), coalesce(m.opt_outs, 0),
        coalesce(a.revenue, 0), coalesce(a.deposit, 0),
        coalesce(l.sla_0_5m, 0), coalesce(l.sla_5_15m, 0), coalesce(l.sla_15_60m, 0),
        coalesce(l.sla_60m_plus, 0), coalesce(l.sla_never, 0),
        now()
      from (
        select loc.id as location_id, gs.day::date as day, loc.timezone
          from locations loc
          cross join lateral generate_series(
            (now() at time zone loc.timezone)::date - ${sql.raw(String(WINDOW_DAYS))},
            (now() at time zone loc.timezone)::date,
            interval '1 day'
          ) as gs(day)
      ) d
      left join lateral (
        select
          count(*) as started,
          count(*) filter (where bs.is_completed) as completed,
          count(*) filter (where not bs.is_completed and bs.phone_e164 is not null) as abandoned
        from booking_sessions bs
        where bs.location_id = d.location_id
          and (bs.created_at at time zone d.timezone)::date = d.day
      ) s on true
      left join lateral (
        select
          count(*) as new_leads,
          count(*) filter (where ld.first_called_at is not null) as called,
          count(*) filter (where ld.converted_at is not null) as converted,
          count(*) filter (where ld.first_called_at is not null
            and ld.first_called_at - ld.created_at < interval '5 minutes') as sla_0_5m,
          count(*) filter (where ld.first_called_at is not null
            and ld.first_called_at - ld.created_at >= interval '5 minutes'
            and ld.first_called_at - ld.created_at < interval '15 minutes') as sla_5_15m,
          count(*) filter (where ld.first_called_at is not null
            and ld.first_called_at - ld.created_at >= interval '15 minutes'
            and ld.first_called_at - ld.created_at < interval '1 hour') as sla_15_60m,
          count(*) filter (where ld.first_called_at is not null
            and ld.first_called_at - ld.created_at >= interval '1 hour') as sla_60m_plus,
          count(*) filter (where ld.first_called_at is null) as sla_never
        from leads ld
        where ld.location_id = d.location_id
          and ld.merged_into is null
          and (ld.created_at at time zone d.timezone)::date = d.day
      ) l on true
      left join lateral (
        select
          count(*) as created,
          count(*) filter (where ap.status = 'confirmed') as confirmed,
          count(*) filter (where ap.status = 'completed') as completed,
          count(*) filter (where ap.status = 'cancelled') as cancelled,
          count(*) filter (where ap.status = 'no_show') as no_show,
          coalesce(sum(ap.final_price_cents) filter (where ap.status = 'completed'), 0) as revenue,
          coalesce(sum(ap.deposit_cents) filter (where ap.deposit_paid), 0) as deposit
        from appointments ap
        where ap.location_id = d.location_id
          and (ap.created_at at time zone d.timezone)::date = d.day
      ) a on true
      left join lateral (
        select
          count(*) as total,
          count(*) filter (where cl.result = 'Answered') as answered,
          count(*) filter (where cl.result = 'Missed') as missed,
          coalesce(sum(cl.duration), 0) as talk
        from calls cl
        where cl.location_id = d.location_id
          and (cl.start_time at time zone d.timezone)::date = d.day
      ) c on true
      left join lateral (
        select
          count(*) filter (where sm.direction = 'outbound') as outbound,
          count(*) filter (where sm.direction = 'inbound') as inbound,
          count(*) filter (where sc.unsubscribed_at is not null
            and (sc.unsubscribed_at at time zone d.timezone)::date = d.day) as opt_outs
        from sms_messages sm
        join sms_conversations sc on sc.id = sm.conversation_id
        where sc.location_id = d.location_id
          and (sm.created_at at time zone d.timezone)::date = d.day
      ) m on true
      on conflict (day, location_id) do update set
        sessions_started = excluded.sessions_started,
        sessions_completed = excluded.sessions_completed,
        sessions_abandoned = excluded.sessions_abandoned,
        leads_new = excluded.leads_new, leads_called = excluded.leads_called,
        leads_converted = excluded.leads_converted,
        appts_created = excluded.appts_created, appts_confirmed = excluded.appts_confirmed,
        appts_completed = excluded.appts_completed, appts_cancelled = excluded.appts_cancelled,
        appts_no_show = excluded.appts_no_show,
        calls_total = excluded.calls_total, calls_answered = excluded.calls_answered,
        calls_missed = excluded.calls_missed, talk_seconds = excluded.talk_seconds,
        sms_outbound = excluded.sms_outbound, sms_inbound = excluded.sms_inbound,
        opt_outs = excluded.opt_outs,
        revenue_cents = excluded.revenue_cents, deposit_cents = excluded.deposit_cents,
        sla_0_5m = excluded.sla_0_5m, sla_5_15m = excluded.sla_5_15m,
        sla_15_60m = excluded.sla_15_60m, sla_60m_plus = excluded.sla_60m_plus,
        sla_never_called = excluded.sla_never_called,
        updated_at = now()
    `);

    /* ── Per agent, per local day — the operator scorecard ─────────── */
    const staffRows = await db.execute(sql`
      insert into staff_daily_stats (
        day, staff_id, location_id,
        calls_outbound, calls_inbound, calls_answered, calls_missed,
        talk_seconds, avg_talk_seconds,
        leads_touched, lead_status_changes, leads_converted,
        avg_speed_to_lead_seconds, sla_met_count, sla_breached_count,
        appts_confirmed, appts_completed, appts_cancelled,
        sms_sent, notes_added, tasks_completed, updated_at
      )
      select
        d.day, d.staff_id, d.location_id,
        coalesce(c.outbound, 0), coalesce(c.inbound, 0), coalesce(c.answered, 0), coalesce(c.missed, 0),
        coalesce(c.talk, 0), coalesce(c.avg_talk, 0),
        coalesce(al.leads_touched, 0), coalesce(al.status_changes, 0), coalesce(al.converted, 0),
        sp.avg_speed, coalesce(sp.met, 0), coalesce(sp.breached, 0),
        coalesce(ap.confirmed, 0), coalesce(ap.completed, 0), coalesce(ap.cancelled, 0),
        coalesce(sm.sent, 0), coalesce(nt.notes, 0), coalesce(tk.done, 0), now()
      from (
        select distinct
          (x.at at time zone coalesce(loc.timezone, 'UTC'))::date as day,
          x.staff_id, x.location_id, coalesce(loc.timezone, 'UTC') as timezone
        from (
          select start_time as at, staff_id, location_id from calls
            where staff_id is not null and location_id is not null
              and start_time > ${sql.raw(since)}
          union all
          select at, actor_staff_id, location_id from activity_log
            where actor_staff_id is not null and location_id is not null
              and at > ${sql.raw(since)}
        ) x(at, staff_id, location_id)
        join locations loc on loc.id = x.location_id
      ) d
      left join lateral (
        select
          count(*) filter (where cl.direction = 'outbound') as outbound,
          count(*) filter (where cl.direction = 'inbound') as inbound,
          count(*) filter (where cl.result = 'Answered') as answered,
          count(*) filter (where cl.result = 'Missed') as missed,
          coalesce(sum(cl.duration), 0) as talk,
          coalesce(avg(cl.duration) filter (where cl.result = 'Answered'), 0) as avg_talk
        from calls cl
        where cl.staff_id = d.staff_id
          and cl.location_id is not distinct from d.location_id
          and (cl.start_time at time zone d.timezone)::date = d.day
      ) c on true
      left join lateral (
        select
          count(distinct a.target_id) filter (where a.target_type = 'lead') as leads_touched,
          count(*) filter (where a.action = 'status_change') as status_changes,
          count(*) filter (where a.action = 'converted') as converted
        from activity_log a
        where a.actor_staff_id = d.staff_id
          and a.location_id is not distinct from d.location_id
          and (a.at at time zone d.timezone)::date = d.day
      ) al on true
      left join lateral (
        select
          avg(extract(epoch from (lf.first_called_at - lf.created_at))) as avg_speed,
          count(*) filter (where lf.first_called_at - lf.created_at <= interval '15 minutes') as met,
          count(*) filter (where lf.first_called_at - lf.created_at > interval '15 minutes') as breached
        from leads lf
        where lf.first_called_by_staff_id = d.staff_id
          and lf.location_id = d.location_id
          and (lf.first_called_at at time zone d.timezone)::date = d.day
      ) sp on true
      left join lateral (
        select
          count(*) filter (where apt.confirmed_by_staff_id = d.staff_id
            and (apt.confirmed_at at time zone d.timezone)::date = d.day) as confirmed,
          count(*) filter (where apt.completed_by_staff_id = d.staff_id
            and (apt.completed_at at time zone d.timezone)::date = d.day) as completed,
          count(*) filter (where apt.cancelled_by_staff_id = d.staff_id
            and (apt.cancelled_at at time zone d.timezone)::date = d.day) as cancelled
        from appointments apt
        where apt.location_id = d.location_id
          and d.staff_id in (apt.confirmed_by_staff_id, apt.completed_by_staff_id, apt.cancelled_by_staff_id)
      ) ap on true
      left join lateral (
        select count(*) as sent
          from sms_messages msg
          join sms_conversations conv on conv.id = msg.conversation_id
        where msg.sender_staff_id = d.staff_id
          and conv.location_id = d.location_id
          and (msg.created_at at time zone d.timezone)::date = d.day
      ) sm on true
      left join lateral (
        select count(*) as notes from notes n
        where n.author_staff_id = d.staff_id
          and (n.created_at at time zone d.timezone)::date = d.day
      ) nt on true
      left join lateral (
        select count(*) as done from tasks t
        where t.done_by_staff_id = d.staff_id
          and t.location_id = d.location_id
          and (t.done_at at time zone d.timezone)::date = d.day
      ) tk on true
      on conflict (day, staff_id, coalesce(location_id, 0)) do update set
        calls_outbound = excluded.calls_outbound, calls_inbound = excluded.calls_inbound,
        calls_answered = excluded.calls_answered, calls_missed = excluded.calls_missed,
        talk_seconds = excluded.talk_seconds, avg_talk_seconds = excluded.avg_talk_seconds,
        leads_touched = excluded.leads_touched, lead_status_changes = excluded.lead_status_changes,
        leads_converted = excluded.leads_converted,
        avg_speed_to_lead_seconds = excluded.avg_speed_to_lead_seconds,
        sla_met_count = excluded.sla_met_count, sla_breached_count = excluded.sla_breached_count,
        appts_confirmed = excluded.appts_confirmed, appts_completed = excluded.appts_completed,
        appts_cancelled = excluded.appts_cancelled,
        sms_sent = excluded.sms_sent, notes_added = excluded.notes_added,
        tasks_completed = excluded.tasks_completed, updated_at = now()
    `);

    /* ── Funnel drop-off per step ──────────────────────────────────── */
    const funnel = await db.execute(sql`
      insert into funnel_daily_stats (day, location_id, step_index, step_key, reached, dropped_here, advanced, updated_at)
      select
        (bs.created_at at time zone loc.timezone)::date as day,
        bs.location_id,
        s.idx,
        s.key,
        count(*) filter (where bs.max_step_reached >= s.idx) as reached,
        count(*) filter (where bs.max_step_reached = s.idx and not bs.is_completed) as dropped_here,
        count(*) filter (where bs.max_step_reached > s.idx) as advanced,
        now()
      from booking_sessions bs
      join locations loc on loc.id = bs.location_id
      cross join (values
        (0,'welcome'),(1,'purpose'),(2,'style'),(3,'story'),
        (4,'body_area'),(5,'size'),(6,'timing'),(7,'contact')
      ) as s(idx, key)
      where bs.created_at > ${sql.raw(since)}
      group by 1, 2, 3, 4
      on conflict (day, location_id, step_index) do update set
        reached = excluded.reached,
        dropped_here = excluded.dropped_here,
        advanced = excluded.advanced,
        step_key = excluded.step_key,
        updated_at = now()
    `);

    /* ── Marketing attribution ─────────────────────────────────────── */
    const attribution = await db.execute(sql`
      insert into attribution_daily_stats (
        day, location_id, platform, utm_source, utm_medium, utm_campaign,
        sessions, leads, appointments, completed, revenue_cents, updated_at
      )
      select
        (l.created_at at time zone loc.timezone)::date,
        l.location_id,
        l.platform::text,
        l.utm->>'utmSource',
        l.utm->>'utmMedium',
        l.utm->>'utmCampaign',
        0,
        count(*),
        count(*) filter (where l.converted_at is not null),
        count(*) filter (where ap.status = 'completed'),
        coalesce(sum(ap.final_price_cents) filter (where ap.status = 'completed'), 0),
        now()
      from leads l
      join locations loc on loc.id = l.location_id
      left join appointments ap on ap.id = l.converted_appointment_id
      where l.merged_into is null and l.created_at > ${sql.raw(since)}
      group by 1, 2, 3, 4, 5, 6
      on conflict (day, location_id, platform, coalesce(utm_source, ''), coalesce(utm_medium, ''), coalesce(utm_campaign, ''))
      do update set
        leads = excluded.leads,
        appointments = excluded.appointments,
        completed = excluded.completed,
        revenue_cents = excluded.revenue_cents,
        updated_at = now()
    `);

    return {
      summary: `rolled up ${WINDOW_DAYS}d`,
      counts: {
        locationDays: location.rowCount ?? 0,
        staffDays: staffRows.rowCount ?? 0,
        funnelRows: funnel.rowCount ?? 0,
        attributionRows: attribution.rowCount ?? 0,
      },
    };
  },
};
