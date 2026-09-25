import { NextResponse, type NextRequest } from "next/server";
import { and, count, eq, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { leads, locations, calls } from "@/db/schema";
import { withAuth, scopeFilter, requireScope } from "@/server/auth/guard";
import { compact, countsByColumn, pageParams, rangeWhere, sortOrder } from "@/server/crm/scope";
import { csvResponse, stamp } from "@/server/crm/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How many calls this lead has had — shown in the list and sortable by. */
const callCount = sql<number>`(select count(*)::int from ${calls} c where c.lead_id = ${leads.id})`;

/* Sorting is chosen from here, never from the query string, so `sort=`
   cannot name a column the console was not offered. */
const SORTABLE = {
  created: leads.createdAt,
  name: leads.name,
  calls: callCount,
  status: leads.callStatus,
} as const;

/** The call-centre pipeline, always narrowed to the caller's studios. */
export const GET = withAuth("leads.view", async (user, req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(p, 50);
  const scope = scopeFilter(user);

  const requestedLocation = p.get("location") && p.get("location") !== "all"
    ? Number(p.get("location")) : null;
  // Asking for a studio outside your scope is a 403, not an empty list —
  // silently returning nothing hides a misconfiguration.
  if (requestedLocation) requireScope(user, requestedLocation);

  const q = p.get("q")?.trim();
  /* A search for "0212 555" is looking for a phone number, and the stored
     one is +902125550000 — the spaces mean it never matches. Digits are
     therefore also tried against the number with its own separators
     stripped, which is how the operator expects to find someone. */
  const digits = q?.replace(/\D/g, "") ?? "";

  const base: (SQL | undefined)[] = [
    isNull(leads.mergedInto),
    // A converted lead has left the pipeline; it is not work any more.
    p.get("include_converted") === "1" ? undefined : isNull(leads.convertedAt),
    scope ? inArray(leads.locationId, scope) : undefined,
    requestedLocation ? eq(leads.locationId, requestedLocation) : undefined,
    p.get("platform") && p.get("platform") !== "all"
      ? eq(leads.platform, p.get("platform") as never) : undefined,
    rangeWhere(p, leads.createdAt),
    q
      ? or(
          ilike(leads.name, `%${q}%`),
          ilike(leads.email, `%${q}%`),
          ilike(leads.phoneE164, `%${q}%`),
          ilike(leads.id, `%${q}%`),
          digits.length > 2
            ? sql`regexp_replace(coalesce(${leads.phoneE164}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`
            : undefined,
        )
      : undefined,
  ];

  const status = p.get("status");
  const statusFilter = status && status !== "all"
    ? eq(leads.callStatus, status as never) : undefined;

  /* The tabs count the filtered set WITHOUT the status filter, or every
     tab but the active one reads zero. */
  const whereForCounts = and(...compact(base));
  const where = and(...compact([...base, statusFilter]));

  const selection = {
    lead: leads,
    studio: { id: locations.id, name: locations.name, city: locations.city, slug: locations.slug },
    callCount,
  };
  const listQuery = (limit: number, skip: number) =>
    db
      .select(selection)
      .from(leads)
      .innerJoin(locations, eq(locations.id, leads.locationId))
      .where(where)
      .orderBy(sortOrder(p, SORTABLE, "created"))
      .limit(limit)
      .offset(skip);

  /* The export is this same query without the paging, streamed. Exporting
     what the console had in memory meant exporting one page of it. */
  if (p.get("format") === "csv") {
    return csvResponse({
      filename: `cleopatra-leads-${stamp()}.csv`,
      header: ["ID", "Name", "Email", "Phone", "Call Status", "Platform", "Campaign", "Studio", "Calls", "Created"],
      fetchChunk: listQuery,
      row: (r) => [
        r.lead.id, r.lead.name, r.lead.email, r.lead.phoneE164, r.lead.callStatus,
        r.lead.platform, r.lead.utm?.utmCampaign ?? "", r.studio.name, r.callCount, r.lead.createdAt,
      ],
    });
  }

  const [rows, total, counts] = await Promise.all([
    listQuery(size, offset),
    db.select({ n: count() }).from(leads).where(where),
    countsByColumn(leads, leads.callStatus, whereForCounts),
  ]);

  return NextResponse.json(
    {
      leads: rows.map((r) => ({ ...r.lead, studio: r.studio, callCount: r.callCount })),
      page,
      pageSize: size,
      total: total[0]?.n ?? 0,
      counts,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
