import { NextResponse, type NextRequest } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { calls, leads, locations } from "@/db/schema";
import { withAuth, scopeFilter } from "@/server/auth/guard";
import { pageParams } from "@/server/crm/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Finding duplicates in the whole pipeline ──────────────────────────
 * The merge screen grouped `leads` from the console's store — the most
 * recent hundred. Two records for the same person are usually weeks
 * apart, which is exactly the pair that slice cannot contain, so the
 * screen was structurally unable to find the duplicates it exists to find
 * and reported a confident count of what it did find.
 *
 * Grouping belongs in the database, over every lead the operator may see.
 *
 * Matching stays narrow — same E.164 number, or same email — because a
 * false merge destroys someone's history, and the screen still asks a
 * human to confirm. Digits are compared rather than the stored string, so
 * "+1 404 555 0101" and "+14045550101" are one person.
 * ────────────────────────────────────────────────────────────────── */
export const GET = withAuth("leads.view", async (user, req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(p, 25);
  const scope = scopeFilter(user);

  /* A branch manager's duplicates are their own branch's. An unrestricted
     user gets everything, which is what `true` stands in for. */
  const inScope = scope
    ? sql`l.location_id = any(${sql.param(scope)}::int[])`
    : sql`true`;

  const groups = await db.execute<{
    kind: string;
    key: string;
    lead_ids: string[];
    total_count: number;
  }>(sql`
    with visible as (
      select l.* from leads l
       where l.merged_into is null and ${inScope}
    ),
    grouped as (
      select 'phone' as kind,
             regexp_replace(phone_e164, '[^0-9]', '', 'g') as key,
             array_agg(id order by created_at) as lead_ids,
             max(created_at) as newest
        from visible
       where phone_e164 is not null
         and regexp_replace(phone_e164, '[^0-9]', '', 'g') <> ''
       group by 2
      having count(*) > 1
      union all
      select 'email', lower(email), array_agg(id order by created_at), max(created_at)
        from visible
       where email is not null and email <> ''
       group by 2
      having count(*) > 1
    )
    select kind, key, lead_ids, count(*) over () ::int as total_count
      from grouped
     order by newest desc
     limit ${size} offset ${offset}
  `);

  const total = groups.rows[0]?.total_count ?? 0;
  const ids = groups.rows.flatMap((g) => g.lead_ids);

  /* One query for every lead on this page of groups, rather than one per
     group, and through the query builder rather than raw SQL: the console
     reads camelCase, and `select l.*` hands back the database's own
     snake_case column names. */
  const leadRows = ids.length
    ? await db
        .select({
          lead: leads,
          studio: { id: locations.id, name: locations.name, city: locations.city, slug: locations.slug },
          callCount: sql<number>`(select count(*)::int from ${calls} c where c.lead_id = ${leads.id})`,
        })
        .from(leads)
        .innerJoin(locations, eq(locations.id, leads.locationId))
        .where(inArray(leads.id, ids))
    : [];

  const byId = new Map(
    leadRows.map((r) => [r.lead.id, { ...r.lead, studio: r.studio, callCount: r.callCount }]),
  );

  return NextResponse.json(
    {
      groups: groups.rows.map((g) => ({
        kind: g.kind,
        key: g.key,
        leads: g.lead_ids.map((id) => byId.get(id)).filter(Boolean),
      })),
      page,
      pageSize: size,
      total,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
