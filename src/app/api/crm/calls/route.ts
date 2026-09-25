import { NextResponse, type NextRequest } from "next/server";
import { and, count, desc, eq, gte, or, ilike } from "drizzle-orm";
import { db } from "@/db/client";
import { calls, locations, staff } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { scopeWhere, compact, pageParams, daysAgo } from "@/server/crm/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withAuth("calls.view", async (user, req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const { page, size, offset } = pageParams(p, 50);

  const requested = p.get("location") && p.get("location") !== "all" ? Number(p.get("location")) : null;
  if (requested) requireScope(user, requested);

  const since = daysAgo(p);
  const result = p.get("result");
  const q = p.get("q")?.trim();

  const where = and(
    ...compact([
      scopeWhere(user, calls.locationId),
      requested ? eq(calls.locationId, requested) : undefined,
      result && result !== "all" ? eq(calls.result, result as never) : undefined,
      since ? gte(calls.startTime, since) : undefined,
      q ? or(ilike(calls.fromNumber, `%${q}%`), ilike(calls.toNumber, `%${q}%`), ilike(calls.agentName, `%${q}%`)) : undefined,
    ]),
  );

  const [rows, total] = await Promise.all([
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
      .orderBy(desc(calls.startTime))
      .limit(size)
      .offset(offset),
    db.select({ n: count() }).from(calls).where(where),
  ]);

  return NextResponse.json(
    {
      calls: rows.map((r) => ({ ...r.call, studio: r.studio, agent: r.agent })),
      page,
      pageSize: size,
      total: total[0]?.n ?? 0,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
