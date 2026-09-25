import { NextResponse, type NextRequest } from "next/server";
import { and, count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, locations, leads, calls } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { scopeWhere, compact, pageParams, daysAgo } from "@/server/crm/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withAuth("appts.view", async (user, req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(p);

  const requested = p.get("location") && p.get("location") !== "all" ? Number(p.get("location")) : null;
  if (requested) requireScope(user, requested);

  const since = daysAgo(p);
  const status = p.get("status");
  const q = p.get("q")?.trim();

  const where = and(
    ...compact([
      scopeWhere(user, appointments.locationId),
      requested ? eq(appointments.locationId, requested) : undefined,
      status && status !== "all" ? eq(appointments.status, status as never) : undefined,
      since ? gte(appointments.createdAt, since) : undefined,
      q
        ? or(
            ilike(appointments.name, `%${q}%`),
            ilike(appointments.email, `%${q}%`),
            ilike(appointments.phoneE164, `%${q}%`),
            ilike(appointments.bkUuid, `%${q}%`),
          )
        : undefined,
    ]),
  );

  const [rows, total] = await Promise.all([
    db
      .select({
        appointment: appointments,
        studio: { id: locations.id, name: locations.name, city: locations.city, slug: locations.slug },
        leadName: leads.name,
        callCount: sql<number>`(select count(*)::int from ${calls} c where c.appointment_id = ${appointments.id})`,
      })
      .from(appointments)
      .innerJoin(locations, eq(locations.id, appointments.locationId))
      .leftJoin(leads, eq(leads.id, appointments.leadId))
      .where(where)
      .orderBy(desc(appointments.startsAt))
      .limit(size)
      .offset(offset),
    db.select({ n: count() }).from(appointments).where(where),
  ]);

  return NextResponse.json(
    {
      appointments: rows.map((r) => ({ ...r.appointment, studio: r.studio, leadName: r.leadName, callCount: r.callCount })),
      page,
      pageSize: size,
      total: total[0]?.n ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
