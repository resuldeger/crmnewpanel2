import { NextResponse, type NextRequest } from "next/server";
import { and, count, desc, eq, gte, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { leads, locations, calls } from "@/db/schema";
import { withAuth, scopeFilter, requireScope } from "@/server/auth/guard";
import { pageParams } from "@/server/crm/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const filters: (SQL | undefined)[] = [
    isNull(leads.mergedInto),
    // A converted lead has left the pipeline; it is not work any more.
    p.get("include_converted") === "1" ? undefined : isNull(leads.convertedAt),
    scope ? inArray(leads.locationId, scope) : undefined,
    requestedLocation ? eq(leads.locationId, requestedLocation) : undefined,
  ];

  const status = p.get("status");
  if (status && status !== "all") filters.push(eq(leads.callStatus, status as never));

  const platform = p.get("platform");
  if (platform && platform !== "all") filters.push(eq(leads.platform, platform as never));

  const q = p.get("q")?.trim();
  if (q) {
    const like = `%${q}%`;
    filters.push(
      or(ilike(leads.name, like), ilike(leads.email, like), ilike(leads.phoneE164, like), ilike(leads.id, like)),
    );
  }

  const days = Number(p.get("days") ?? 0);
  if (days > 0) filters.push(gte(leads.createdAt, new Date(Date.now() - days * 86_400_000)));

  const where = and(...filters.filter(Boolean as never as (x: SQL | undefined) => x is SQL));

  const [rows, total] = await Promise.all([
    db
      .select({
        lead: leads,
        studio: { id: locations.id, name: locations.name, city: locations.city, slug: locations.slug },
        callCount: sql<number>`(select count(*)::int from ${calls} c where c.lead_id = ${leads.id})`,
      })
      .from(leads)
      .innerJoin(locations, eq(locations.id, leads.locationId))
      .where(where)
      .orderBy(desc(leads.createdAt))
      .limit(size)
      .offset(offset),
    db.select({ n: count() }).from(leads).where(where),
  ]);

  return NextResponse.json(
    {
      leads: rows.map((r) => ({ ...r.lead, studio: r.studio, callCount: r.callCount })),
      page,
      pageSize: size,
      total: total[0]?.n ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
