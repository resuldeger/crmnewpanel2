import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, campaigns } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── SMS campaigns ─────────────────────────────────────────────────────
 * Creating one only pushed a row into React state, so a campaign the
 * operator had "scheduled" did not exist for the dispatcher job and was
 * never sent. Queued here instead; campaignDispatcher picks it up.
 *
 * This route never sends anything itself — it marks a campaign ready and
 * lets the worker do the sending, one place that already handles opt-outs,
 * segment counting and per-studio senders.
 * ────────────────────────────────────────────────────────────────── */

export const GET = withAuth("sms.view", async () => {
  const rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(200);
  return NextResponse.json({ campaigns: rows });
});

export const POST = withAuth("sms.campaign", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    body?: string;
    body_translations?: Record<string, string>;
    segment?: Record<string, unknown>;
    scheduled_at?: string | null;
  };

  const name = String(body.name ?? "").trim();
  const text = String(body.body ?? "").trim();

  if (name.length < 2 || name.length > 120) {
    return NextResponse.json({ message: "Name must be 2–120 characters" }, { status: 422 });
  }
  /* 1600 is Twilio's hard ceiling for a concatenated message. Anything
     longer is rejected at send time, per recipient, after it has already
     been queued — so it is refused here instead. */
  if (text.length < 1 || text.length > 1600) {
    return NextResponse.json({ message: "Message must be 1–1600 characters" }, { status: 422 });
  }

  let scheduledAt: Date | null = null;
  if (body.scheduled_at) {
    const parsed = new Date(body.scheduled_at);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ message: "Invalid schedule time" }, { status: 422 });
    }
    if (parsed.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ message: "Schedule time is in the past" }, { status: 422 });
    }
    scheduledAt = parsed;
  }

  const [row] = await db
    .insert(campaigns)
    .values({
      name,
      body: text,
      bodyTranslations: body.body_translations ?? {},
      segment: body.segment ?? {},
      /* scheduled_at is NOT NULL, so a draft still carries a timestamp;
         `status` is what tells the dispatcher whether to look at it. */
      scheduledAt: scheduledAt ?? new Date(),
      status: scheduledAt ? "scheduled" : "draft",
      createdByStaffId: user.id,
    })
    .returning();

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    targetType: "campaign",
    targetId: String(row.id),
    targetLabel: name,
    action: "created",
    toValue: row.status,
    summary: scheduledAt ? `Scheduled for ${scheduledAt.toISOString()}` : "Saved as draft",
  });

  return NextResponse.json({ campaign: row }, { status: 201 });
});

export const PATCH = withAuth("sms.campaign", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { id?: number; action?: string };

  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ message: "Bad campaign id" }, { status: 400 });

  const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!existing) return NextResponse.json({ message: "Campaign not found" }, { status: 404 });

  if (body.action === "send") {
    /* Only a campaign that has not gone out may be released. Re-sending a
       finished one would message everyone in the segment a second time. */
    if (existing.status !== "draft" && existing.status !== "scheduled") {
      return NextResponse.json(
        { message: `A campaign that is already ${existing.status} cannot be sent again` },
        { status: 409 },
      );
    }

    const [updated] = await db
      .update(campaigns)
      .set({ status: "scheduled", scheduledAt: new Date() })
      .where(eq(campaigns.id, id))
      .returning();

    await db.insert(activityLog).values({
      actorKind: "user",
      actorStaffId: user.id,
      actorName: user.name,
      actorRoleId: user.roleId,
      targetType: "campaign",
      targetId: String(id),
      targetLabel: existing.name,
      action: "status_change",
      fromValue: existing.status,
      toValue: "scheduled",
      summary: "Released to the dispatcher",
    });

    return NextResponse.json({ campaign: updated });
  }

  if (body.action === "cancel") {
    if (existing.status === "sent" || existing.status === "sending") {
      return NextResponse.json({ message: "Sending has already started" }, { status: 409 });
    }
    const [updated] = await db
      .update(campaigns)
      .set({ status: "draft" })
      .where(eq(campaigns.id, id))
      .returning();

    await db.insert(activityLog).values({
      actorKind: "user",
      actorStaffId: user.id,
      actorName: user.name,
      actorRoleId: user.roleId,
      targetType: "campaign",
      targetId: String(id),
      targetLabel: existing.name,
      action: "status_change",
      fromValue: existing.status,
      toValue: "draft",
      summary: "Pulled back to draft",
    });

    return NextResponse.json({ campaign: updated });
  }

  return NextResponse.json({ message: "Unknown action" }, { status: 422 });
});
