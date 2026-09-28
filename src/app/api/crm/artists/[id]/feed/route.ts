import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, artists } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Showing one diary link, to someone who asked ──────────────────────
 * A Timely calendar URL needs no login: the token is in the path, so the
 * URL is the credential. It used to ride along in the bootstrap payload,
 * which handed every signed-in browser a readable copy of 125 artists'
 * diaries on every page load — including viewers, who have no business
 * with any of them.
 *
 * Administrators do need to see and copy one, so this returns it: one
 * artist, on request, for a role that manages staff, and written to the
 * trail. The difference from before is not whether it can be seen but how
 * many are handed out and to whom.
 * ────────────────────────────────────────────────────────────────── */
export const GET = withAuth(
  "staff.manage",
  async (user, _req, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const artistId = Number(id);
    if (!Number.isInteger(artistId)) {
      return NextResponse.json({ message: "Bad artist id" }, { status: 400 });
    }

    const [artist] = await db
      .select({ name: artists.name, feedUrl: artists.calendarFeedUrl })
      .from(artists)
      .where(eq(artists.id, artistId))
      .limit(1);

    if (!artist) return NextResponse.json({ message: "Artist not found" }, { status: 404 });

    /* Logged because it is a credential being read. The trail records that
       it was looked at and by whom, never the value. */
    await db.insert(activityLog).values({
      actorKind: "user",
      actorStaffId: user.id,
      actorName: user.name,
      actorRoleId: user.roleId,
      targetType: "staff",
      targetId: String(artistId),
      targetLabel: artist.name,
      action: "viewed_pii",
      summary: "Revealed the Timely diary link",
    });

    return NextResponse.json(
      { feedUrl: artist.feedUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
