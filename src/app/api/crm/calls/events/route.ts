import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { locations, vonageEvents } from "@/db/schema";
import { withAuth, scopeFilter, requireScope } from "@/server/auth/guard";
import { compact } from "@/server/crm/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── What happened on the floor ────────────────────────────────────────
 * The console's event stream was an array in the browser holding the last
 * twelve entries, filled only while the page was open and emptied by a
 * reload. A night of ringing, answering and hanging up left no trace, and
 * there was nothing to report on afterwards.
 *
 * The poller writes every event now, and this reads them back, so the
 * stream survives a reload and a shift that nobody was watching.
 *
 * This is not the call log. The log says a call happened and how it
 * ended; these say how long it rang before anyone picked up, which
 * extension it moved between, and whether it was abandoned waiting —
 * none of which survives into the log.
 * ────────────────────────────────────────────────────────────────── */
export const GET = withAuth("calls.view", async (user, req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, Number(p.get("limit") ?? 50)));
  const scope = scopeFilter(user);

  const requested = p.get("location") && p.get("location") !== "all" ? Number(p.get("location")) : null;
  if (requested) requireScope(user, requested);

  const hours = Math.min(24 * 30, Math.max(1, Number(p.get("hours") ?? 24)));
  const since = new Date(Date.now() - hours * 3_600_000);

  const rows = await db
    .select({
      id: vonageEvents.id,
      callUuid: vonageEvents.callUuid,
      eventType: vonageEvents.eventType,
      locationId: vonageEvents.locationId,
      staffId: vonageEvents.staffId,
      payload: vonageEvents.payload,
      occurredAt: vonageEvents.occurredAt,
      studio: locations.name,
    })
    .from(vonageEvents)
    .leftJoin(locations, eq(locations.id, vonageEvents.locationId))
    .where(
      and(
        ...compact([
          gte(vonageEvents.occurredAt, since),
          requested ? eq(vonageEvents.locationId, requested) : undefined,
          /* A branch manager sees their own branches. An event with no
             studio — an extension we have not mapped — is only shown to
             someone who can see every branch, since there is no way to
             decide whose it is. */
          scope ? inArray(vonageEvents.locationId, scope) : undefined,
        ]),
      ),
    )
    /* By id as well as time: the poller writes several events for one
       call in the same millisecond, and ordering on the timestamp alone
       leaves their order undefined — the stream then shows a call ending
       before it started. */
    .orderBy(desc(vonageEvents.occurredAt), desc(vonageEvents.id))
    .limit(limit);

  return NextResponse.json({ events: rows }, { headers: { "Cache-Control": "no-store" } });
});
