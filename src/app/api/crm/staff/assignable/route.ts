import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { locationScopes, staff, staffPresence } from "@/db/schema";
import { withAuth, scopeFilter, requireScope } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Presence is refreshed on a heartbeat; twice that is the grace period. */
const ONLINE_WINDOW_MS = 2 * Math.max(15_000, Number(process.env.PRESENCE_HEARTBEAT_MS ?? 30_000));

/* ── Who can take this ─────────────────────────────────────────────────
 * Handing work to someone who went home an hour ago is how a callback
 * sits untouched until tomorrow, so whoever is at their desk right now
 * comes first. But "online" is a convenience, not a rule: at nine in the
 * evening nobody is online and the work still has to go to someone, so
 * the list falls back to everyone rather than coming back empty.
 *
 * Narrowed twice. To the caller's own branches, because assigning across
 * a boundary they cannot see would let them read the name of someone at a
 * studio they have no access to. And, when the work belongs to a studio,
 * to the people who can actually open it: handing a Riverside callback to
 * someone scoped to Panama gives them a task they cannot even read.
 * ────────────────────────────────────────────────────────────────── */
export const GET = withAuth("calls.view", async (user, req: NextRequest) => {
  const scope = scopeFilter(user);
  const since = new Date(Date.now() - ONLINE_WINDOW_MS);

  /* The studio the work belongs to, when it belongs to one. A caller may
     only ask about a studio they can see themselves. */
  const asked = req.nextUrl.searchParams.get("location");
  const forLocation = asked && asked !== "all" ? Number(asked) : null;
  if (forLocation !== null) requireScope(user, forLocation);

  /* A branch-scoped user may assign to people who share a branch with
     them, and to anyone unrestricted. */
  const sharesABranch = scope
    ? or(
        eq(staff.scopeAll, true),
        sql`exists (
          select 1 from ${locationScopes} ls
           where ls.staff_id = ${staff.id}
             and ls.location_id = any(${sql.param(scope)}::int[])
        )`,
      )
    : undefined;

  /* Everyone unrestricted, plus everyone scoped to this studio. */
  const canOpenIt = forLocation === null
    ? undefined
    : or(
        eq(staff.scopeAll, true),
        sql`exists (
          select 1 from ${locationScopes} ls
           where ls.staff_id = ${staff.id} and ls.location_id = ${forLocation}
        )`,
      );

  const rows = await db
    .select({
      id: staff.id,
      name: staff.name,
      roleId: staff.roleId,
      status: staffPresence.status,
      lastSeenAt: staffPresence.lastHeartbeatAt,
    })
    .from(staff)
    .leftJoin(staffPresence, eq(staffPresence.staffId, staff.id))
    .where(and(...[eq(staff.active, true), sharesABranch, canOpenIt].filter(Boolean as never as <T>(x: T) => x is T)))
    .orderBy(asc(staff.name));

  const online = rows.filter(
    (r) => r.status === "online" && r.lastSeenAt !== null && r.lastSeenAt >= since,
  );

  return NextResponse.json(
    {
      /* The caller is told which list they are looking at, so the console
         can say "nobody is online" rather than implying these five people
         are all sitting there. */
      anyoneOnline: online.length > 0,
      staff: (online.length > 0 ? online : rows).map((r) => ({
        id: r.id,
        name: r.name,
        roleId: r.roleId,
        online: r.status === "online" && r.lastSeenAt !== null && r.lastSeenAt >= since,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
