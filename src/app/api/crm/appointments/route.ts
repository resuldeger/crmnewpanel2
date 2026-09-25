import { NextResponse, type NextRequest } from "next/server";
import { and, count, eq, gte, ilike, lte, or, type SQL, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, locations, leads, calls } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { scopeWhere, compact, countsByColumn, pageParams, rangeWhere, sortOrder } from "@/server/crm/scope";
import { csvResponse, stamp } from "@/server/crm/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const callCount = sql<number>`(select count(*)::int from ${calls} c where c.appointment_id = ${appointments.id})`;

const SORTABLE = {
  starts: appointments.startsAt,
  created: appointments.createdAt,
  name: appointments.name,
  status: appointments.status,
} as const;

export const GET = withAuth("appts.view", async (user, req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(p);

  const requested = p.get("location") && p.get("location") !== "all" ? Number(p.get("location")) : null;
  if (requested) requireScope(user, requested);

  const q = p.get("q")?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";

  /* The list is read two ways and they disagree about which date matters:
     the pipeline asks when the booking came in, the day sheet asks when
     the customer is due. `on` picks the appointment date; the default
     stays createdAt so existing callers are unchanged. */
  const dateColumn = p.get("on") === "starts" ? appointments.startsAt : appointments.createdAt;

  /* "Due >= today" is a window on the SLOT, which is a different question
     from the date filter above and has to be able to coexist with it: the
     desk asks for bookings taken this month that are still to come. The
     instant arrives resolved, because today starts at the operator's
     midnight and not the server's. */
  const slotAt = (key: string): Date | null => {
    const raw = p.get(key);
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const startsFrom = slotAt("starts_from");
  const startsTo = slotAt("starts_to");

  const base: (SQL | undefined)[] = [
    scopeWhere(user, appointments.locationId),
    requested ? eq(appointments.locationId, requested) : undefined,
    rangeWhere(p, dateColumn),
    startsFrom ? gte(appointments.startsAt, startsFrom) : undefined,
    startsTo ? lte(appointments.startsAt, startsTo) : undefined,
    q
      ? or(
          ilike(appointments.name, `%${q}%`),
          ilike(appointments.email, `%${q}%`),
          ilike(appointments.phoneE164, `%${q}%`),
          ilike(appointments.bkUuid, `%${q}%`),
          digits.length > 2
            ? sql`regexp_replace(coalesce(${appointments.phoneE164}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`
            : undefined,
        )
      : undefined,
  ];

  const status = p.get("status");
  const statusFilter = status && status !== "all" ? eq(appointments.status, status as never) : undefined;

  const whereForCounts = and(...compact(base));
  const where = and(...compact([...base, statusFilter]));

  const listQuery = (limit: number, skip: number) =>
    db
      .select({
        appointment: appointments,
        studio: { id: locations.id, name: locations.name, city: locations.city, slug: locations.slug },
        leadName: leads.name,
        callCount,
      })
      .from(appointments)
      .innerJoin(locations, eq(locations.id, appointments.locationId))
      .leftJoin(leads, eq(leads.id, appointments.leadId))
      .where(where)
      .orderBy(sortOrder(p, SORTABLE, "starts"))
      .limit(limit)
      .offset(skip);

  if (p.get("format") === "csv") {
    return csvResponse({
      filename: `cleopatra-appointments-${stamp()}.csv`,
      header: ["Ref", "Name", "Email", "Phone", "Status", "Starts", "Studio", "Purpose", "Style", "Calls", "Created"],
      fetchChunk: listQuery,
      row: (r) => [
        r.appointment.bkUuid, r.appointment.name, r.appointment.email, r.appointment.phoneE164,
        r.appointment.status, r.appointment.startsAt, r.studio.name, r.appointment.purpose ?? "",
        r.appointment.style ?? "", r.callCount, r.appointment.createdAt,
      ],
    });
  }

  const [rows, total, counts] = await Promise.all([
    listQuery(size, offset),
    db.select({ n: count() }).from(appointments).where(where),
    countsByColumn(appointments, appointments.status, whereForCounts),
  ]);

  return NextResponse.json(
    {
      appointments: rows.map((r) => ({ ...r.appointment, studio: r.studio, leadName: r.leadName, callCount: r.callCount })),
      page,
      pageSize: size,
      total: total[0]?.n ?? 0,
      counts,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
