import { NextResponse } from "next/server";
import { asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { extensions, locations } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";
import { scopeWhere, compact } from "@/server/crm/scope";
import { and } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Which line the call goes out on ───────────────────────────────────
 * SPIKE (spike/web-dialer). Not wired into anything yet.
 *
 * "Call back" already dials, but it chooses the line itself: the studio's
 * own extension, or a call-centre seat when there is no studio. That is the
 * right default and it is also the thing that cannot be checked — there is
 * no screen anywhere that says "ring THIS extension and dial THAT number".
 * This endpoint exists to make the choice explicit so the behaviour can be
 * watched end to end.
 *
 * The list is scoped: a branch manager may dial from their own studio's
 * line, not from another branch's. Call-centre seats belong to no studio
 * and are offered to everyone who may place a call at all, which is what
 * they are for.
 * ────────────────────────────────────────────────────────────────── */
export const GET = withAuth("calls.manage", async (user) => {
  const rows = await db
    .select({
      extension: extensions.extension,
      displayName: extensions.displayName,
      /* The DID is not decoration: with `from: { type: "extension" }` this
         is the number that shows up on the customer's handset, so choosing
         a line is also choosing what they see and call back. */
      did: extensions.phoneNumber,
      userType: extensions.userType,
      locationId: extensions.locationId,
      studio: locations.city,
    })
    .from(extensions)
    .leftJoin(locations, eq(locations.id, extensions.locationId))
    .where(
      user.scopeAll
        ? undefined
        : // Their own studios, plus the shared seats that belong to none.
          and(
            ...compact([
              scopeWhere(user, extensions.locationId) ?? undefined,
            ]),
          ),
    )
    .orderBy(asc(extensions.extension));

  /* The shared seats, added on top of the scoped list — and ONLY those.
     "Has no studio" is not the same as "belongs to everyone": the directory
     also holds named personal extensions, and offering one of those would
     let a manager ring a colleague's own desk and dial out from it. */
  const shared = user.scopeAll
    ? []
    : await db
        .select({
          extension: extensions.extension,
          displayName: extensions.displayName,
          did: extensions.phoneNumber,
          userType: extensions.userType,
          locationId: extensions.locationId,
          studio: locations.city,
        })
        .from(extensions)
        .leftJoin(locations, eq(locations.id, extensions.locationId))
        .where(and(isNull(extensions.locationId), eq(extensions.userType, "CALL_CENTRE")))
        .orderBy(asc(extensions.extension));

  const seen = new Set<string>();
  const lines = [...rows, ...shared].filter((r) => {
    if (seen.has(r.extension)) return false;
    seen.add(r.extension);
    return true;
  });

  return NextResponse.json({ lines }, { headers: { "Cache-Control": "no-store" } });
});
