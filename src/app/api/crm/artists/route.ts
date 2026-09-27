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
  const body = (await req.json().catch(() => ({}))) as {
    id?: number;
    active?: boolean;
    calendar_feed_url?: string | null;
  };

  const id = Number(body.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ message: "id is required" }, { status: 422 });
  }
  const wantsActive = typeof body.active === "boolean";
  const wantsFeed = body.calendar_feed_url !== undefined;
  if (!wantsActive && !wantsFeed) {
    return NextResponse.json({ message: "Nothing to change" }, { status: 422 });
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

  /* ── Replacing a diary link ────────────────────────────────────────
   * Timely publishes each artist's calendar at a private URL with the
   * token in the path, and retires it when the link is regenerated or the
   * artist leaves — which is why 30 of them answer 404 on every sweep.
   * Fixing that means pasting the new link, and it belongs here rather
   * than in a shell command: the URL is a credential, and a command line
   * puts it in the shell history of whoever ran it.
   *
   * It is write-only. Nothing ever reads it back out to a browser.
   * ────────────────────────────────────────────────────────── */
  const patch: Record<string, unknown> = {};
  if (wantsActive && existing.active !== body.active) patch.active = body.active;

  if (wantsFeed) {
    const raw = (body.calendar_feed_url ?? "").trim();
    if (raw === "") {
      // Clearing it stops the sweep asking, which is the right move for
      // an artist who has gone.
      patch.calendarFeedUrl = null;
      patch.feedError = null;
      patch.feedCheckedAt = null;
    } else {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return NextResponse.json({ message: "That is not a URL" }, { status: 422 });
      }
      /* https only: the token travels in the path, and a plain-http feed
         would hand it to anyone on the network. */
      if (url.protocol !== "https:") {
        return NextResponse.json({ message: "The link must start with https://" }, { status: 422 });
      }
      if (!url.hostname.endsWith("gettimely.com")) {
        return NextResponse.json(
          { message: `Timely links come from gettimely.com, not ${url.hostname}` },
          { status: 422 },
        );
      }
      patch.calendarFeedUrl = url.toString();
      /* Cleared rather than kept: the old error described the old link,
         and leaving it there would show a red flag against a link nobody
         has tried yet. The next sweep says whether this one works. */
      patch.feedError = null;
      patch.feedCheckedAt = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ artist: existing, changed: false });
  }

  const [updated] = await db
    .update(artists)
    .set(patch)
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
    action: wantsFeed ? "updated" : "status_change",
    /* The link itself is never written to the trail — it is a credential,
       and an audit log is the last place it should be searchable. */
    summary: wantsFeed
      ? (patch.calendarFeedUrl ? "Timely diary link replaced" : "Timely diary link removed")
      : undefined,
    fromValue: wantsActive ? (existing.active ? "active" : "inactive") : null,
    toValue: wantsActive ? (body.active ? "active" : "inactive") : null,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ artist: updated, changed: true });
});
