import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, artistLocations, artists } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── An artist's availability flag ─────────────────────────────────────
 * Switching an artist off only changed React state, so a tattooist who had
 * left kept counting toward the studio's roster and their Timely calendar
 * kept being polled. It reverted on reload, which made it look as if the
 * change had not registered rather than had not saved.
 * ────────────────────────────────────────────────────────────────── */

export const PATCH = withAuth("studios.edit", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { id?: number; active?: boolean };

  const id = Number(body.id);
  if (!Number.isInteger(id) || typeof body.active !== "boolean") {
    return NextResponse.json({ message: "id and active are required" }, { status: 422 });
  }

  const [existing] = await db.select().from(artists).where(eq(artists.id, id)).limit(1);
  if (!existing) return NextResponse.json({ message: "Artist not found" }, { status: 404 });

  /* An artist belongs to studios rather than to one, so the caller must
     cover at least one of them. */
  const links = await db
    .select({ locationId: artistLocations.locationId })
    .from(artistLocations)
    .where(eq(artistLocations.artistId, id));

  if (!user.scopeAll) {
    const mine = links.some((l) => user.locationIds.includes(l.locationId));
    if (!mine) {
      return NextResponse.json({ message: "That artist is outside your studios" }, { status: 403 });
    }
  }

  if (existing.active === body.active) {
    return NextResponse.json({ artist: existing, changed: false });
  }

  const [updated] = await db
    .update(artists)
    .set({ active: body.active })
    .where(eq(artists.id, id))
    .returning();

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: links[0]?.locationId ?? null,
    targetType: "staff",
    targetId: String(id),
    targetLabel: existing.name,
    action: "status_change",
    fromValue: existing.active ? "active" : "inactive",
    toValue: body.active ? "active" : "inactive",
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ artist: updated, changed: true });
});
