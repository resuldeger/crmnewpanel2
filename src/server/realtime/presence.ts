/* ── Who is on the booking form right now ──────────────────────────────
 * Derived from booking_sessions rather than from a socket per visitor:
 * the public page already reports its step, and a 20-second heartbeat
 * covers idle reading. No anonymous connections, nothing to authenticate
 * on the public side.
 * ────────────────────────────────────────────────────────────────── */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/** A visitor is "live" if we heard from them within this window. */
const LIVE_WINDOW_SECONDS = 75;

export interface LiveVisitor {
  sessionUuid: string;
  locationId: number | null;
  studio: string | null;
  studioSlug: string | null;
  platform: string;
  utmSource: string | null;
  utmCampaign: string | null;
  step: string;
  stepIndex: number;
  maxStepReached: number;
  locale: string;
  deviceType: string | null;
  country: string | null;
  /** True once they have left a phone or email — a reachable lead. */
  identified: boolean;
  contactFirst: boolean;
  startedAt: string;
  lastSeenAt: string;
  secondsOnSite: number;
}

export interface PresenceSnapshot {
  total: number;
  identified: number;
  byStudio: { locationId: number; studio: string; slug: string; count: number }[];
  bySource: { source: string; count: number }[];
  byStep: { step: string; stepIndex: number; count: number }[];
  visitors: LiveVisitor[];
  at: string;
}

/** @param scope studios the viewer may see, or null for no restriction. */
export async function presenceSnapshot(scope: number[] | null): Promise<PresenceSnapshot> {
  const empty: PresenceSnapshot = {
    total: 0, identified: 0, byStudio: [], bySource: [], byStep: [],
    visitors: [], at: new Date().toISOString(),
  };
  // An empty scope means "this user has no studios" — return nothing
  // rather than letting an unfiltered query through.
  if (scope !== null && scope.length === 0) return empty;

  const rows = await db.execute<{
    session_uuid: string; location_id: number | null; studio: string | null; slug: string | null;
    platform: string; utm_source: string | null; utm_campaign: string | null;
    step: string; step_index: number; max_step: number; locale: string;
    device_type: string | null; country: string | null;
    identified: boolean; contact_first: boolean;
    started_at: string; last_seen_at: string; seconds_on_site: number;
  }>(sql`
    select
      bs.session_uuid,
      bs.location_id,
      loc.name as studio,
      loc.slug as slug,
      bs.platform::text as platform,
      bs.utm->>'source'   as utm_source,
      bs.utm->>'campaign' as utm_campaign,
      bs.current_step::text as step,
      bs.current_step_index as step_index,
      bs.max_step_reached   as max_step,
      bs.locale,
      bs.device_type,
      bs.ip_country as country,
      (bs.phone_e164 is not null or bs.email is not null) as identified,
      bs.contact_first,
      bs.created_at   as started_at,
      bs.last_seen_at as last_seen_at,
      extract(epoch from (now() - bs.created_at))::int as seconds_on_site
    from booking_sessions bs
    left join locations loc on loc.id = bs.location_id
    where bs.is_completed = false
      and bs.last_seen_at > now() - make_interval(secs => ${LIVE_WINDOW_SECONDS})
      ${
        // Each id is its own bound parameter. Interpolating the array made
        // drizzle flatten it to a single scalar, and `= any(1)` is a type
        // error Postgres rejects — the board silently showed nothing.
        scope
          ? sql`and bs.location_id in (${sql.join(scope.map((id) => sql`${id}`), sql`, `)})`
          : sql``
      }
    order by bs.last_seen_at desc
    limit 500
  `);

  const visitors: LiveVisitor[] = rows.rows.map((r) => ({
    sessionUuid: r.session_uuid,
    locationId: r.location_id,
    studio: r.studio,
    studioSlug: r.slug,
    platform: r.platform,
    utmSource: r.utm_source,
    utmCampaign: r.utm_campaign,
    step: r.step,
    stepIndex: r.step_index,
    maxStepReached: r.max_step,
    locale: r.locale,
    deviceType: r.device_type,
    country: r.country,
    identified: r.identified,
    contactFirst: r.contact_first,
    startedAt: r.started_at,
    lastSeenAt: r.last_seen_at,
    secondsOnSite: r.seconds_on_site,
  }));

  const tally = <T extends string | number>(key: (v: LiveVisitor) => T | null) => {
    const m = new Map<T, number>();
    for (const v of visitors) {
      const k = key(v);
      if (k === null) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };

  const byStudio = [...tally((v) => v.locationId).entries()]
    .map(([locationId, count]) => {
      const sample = visitors.find((v) => v.locationId === locationId)!;
      return { locationId, studio: sample.studio ?? "—", slug: sample.studioSlug ?? "", count };
    })
    .sort((a, b) => b.count - a.count);

  const bySource = [...tally((v) => v.utmSource ?? v.platform).entries()]
    .map(([source, count]) => ({ source: String(source), count }))
    .sort((a, b) => b.count - a.count);

  const byStep = [...tally((v) => v.step).entries()]
    .map(([step, count]) => ({
      step: String(step),
      stepIndex: visitors.find((v) => v.step === step)?.stepIndex ?? 0,
      count,
    }))
    .sort((a, b) => a.stepIndex - b.stepIndex);

  return {
    total: visitors.length,
    identified: visitors.filter((v) => v.identified).length,
    byStudio, bySource, byStep, visitors,
    at: new Date().toISOString(),
  };
}
