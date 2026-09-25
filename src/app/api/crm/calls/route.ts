import { NextResponse, type NextRequest } from "next/server";
import { and, count, eq, or, ilike, type SQL, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { calls, locations, staff } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { scopeWhere, compact, countsByColumn, pageParams, rangeWhere, sortOrder } from "@/server/crm/scope";
import { csvResponse, stamp } from "@/server/crm/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SORTABLE = {
  start: calls.startTime,
  duration: calls.duration,
  result: calls.result,
  agent: calls.agentName,
} as const;

export const GET = withAuth("calls.view", async (user, req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(p, 50);

  const requested = p.get("location") && p.get("location") !== "all" ? Number(p.get("location")) : null;
  if (requested) requireScope(user, requested);

  const q = p.get("q")?.trim();
  /* Operators search by the number as they read it off a note — "0212 555"
     — while the stored value is +902125550000, so the spaces alone made it
     never match. Digits are also compared against the number stripped of
     its own separators. */
  const digits = q?.replace(/\D/g, "") ?? "";

  const base: (SQL | undefined)[] = [
    scopeWhere(user, calls.locationId),
    requested ? eq(calls.locationId, requested) : undefined,
    rangeWhere(p, calls.startTime),
    p.get("direction") && p.get("direction") !== "all"
      ? eq(calls.direction, p.get("direction") as never) : undefined,
    q
      ? or(
          ilike(calls.fromNumber, `%${q}%`),
          ilike(calls.toNumber, `%${q}%`),
          ilike(calls.agentName, `%${q}%`),
          ilike(calls.extension, `%${q}%`),
          digits.length > 2
            ? sql`regexp_replace(${calls.fromNumber} || ${calls.toNumber}, '[^0-9]', '', 'g') like ${`%${digits}%`}`
            : undefined,
        )
      : undefined,
  ];

  const result = p.get("result");
  const resultFilter = result && result !== "all" ? eq(calls.result, result as never) : undefined;

  // Counted without the result filter, or every tab but the active one is 0.
  const whereForCounts = and(...compact(base));
  const where = and(...compact([...base, resultFilter]));

  const listQuery = (limit: number, skip: number) =>
    db
      .select({
        call: calls,
        studio: { id: locations.id, name: locations.name, city: locations.city },
        agent: { id: staff.id, name: staff.name },
      })
      .from(calls)
      .leftJoin(locations, eq(locations.id, calls.locationId))
      .leftJoin(staff, eq(staff.id, calls.staffId))
      .where(where)
      .orderBy(sortOrder(p, SORTABLE, "start"))
      .limit(limit)
      .offset(skip);

  if (p.get("format") === "csv") {
    return csvResponse({
      filename: `cleopatra-calls-${stamp()}.csv`,
      header: ["Started", "Direction", "From", "To", "Agent", "Extension", "Result", "Duration (s)", "Studio", "Recording"],
      fetchChunk: listQuery,
      row: (r) => [
        r.call.startTime, r.call.direction, r.call.fromNumber, r.call.toNumber,
        r.agent?.name ?? r.call.agentName ?? "", r.call.extension ?? "",
        r.call.result, r.call.duration, r.studio?.name ?? "", r.call.recordingUrl ?? "",
      ],
    });
  }

  const [rows, total, counts] = await Promise.all([
    listQuery(size, offset),
    db.select({ n: count() }).from(calls).where(where),
    countsByColumn(calls, calls.result, whereForCounts),
  ]);

  return NextResponse.json(
    {
      calls: rows.map((r) => ({ ...r.call, studio: r.studio, agent: r.agent })),
      page,
      pageSize: size,
      total: total[0]?.n ?? 0,
      counts,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
