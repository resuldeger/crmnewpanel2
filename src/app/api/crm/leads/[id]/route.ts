import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { leads, locations, activityLog, realtimeEvents } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CALL_STATUSES = [
  "not_called", "no_answer", "busy", "interested", "not_interested",
  "callback_requested", "appointment_made", "already_scheduled", "didnt_pick_up",
  "wrong_number", "double_lead", "no_pn", "spam", "not_trusted",
] as const;

type Ctx = { params: Promise<{ id: string }> };

/* One lead by id, whatever state it is in.
 *
 * The pipeline list deliberately hides converted and merged leads — they
 * are not work any more — so the detail screen, which looked its subject up
 * in that list, showed "Lead not found" for exactly the leads that went on
 * to become appointments. Those are the ones staff most often follow a link
 * to from the booking they created. */
export const GET = withAuth("leads.view", async (user, _req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;

  const [row] = await db
    .select({
      lead: leads,
      studio: { id: locations.id, name: locations.name, city: locations.city, slug: locations.slug },
    })
    .from(leads)
    .leftJoin(locations, eq(locations.id, leads.locationId))
    .where(eq(leads.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ message: "Lead not found" }, { status: 404 });
  requireScope(user, row.lead.locationId);

  return NextResponse.json({ lead: { ...row.lead, studio: row.studio, callCount: 0 } });
});

/** Change a lead's call status. Every change is attributed and audited. */
export const PATCH = withAuth("leads.edit", async (user, req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { call_status?: string; assigned_staff_id?: number | null };

  const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing) return NextResponse.json({ message: "Lead not found" }, { status: 404 });
  requireScope(user, existing.locationId);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const diff: Record<string, [unknown, unknown]> = {};

  if (body.call_status) {
    if (!CALL_STATUSES.includes(body.call_status as never)) {
      return NextResponse.json({ message: "Unknown call status" }, { status: 422 });
    }
    if (body.call_status !== existing.callStatus) {
      patch.callStatus = body.call_status;
      diff.callStatus = [existing.callStatus, body.call_status];
      // Leaving not_called for the first time is what closes the SLA clock.
      if (existing.callStatus === "not_called" && !existing.firstCalledAt) {
        patch.firstCalledAt = new Date();
        patch.firstCalledByStaffId = user.id;
      }
      patch.lastCalledAt = new Date();
    }
  }

  if (body.assigned_staff_id !== undefined && body.assigned_staff_id !== existing.assignedStaffId) {
    patch.assignedStaffId = body.assigned_staff_id;
    patch.assignedAt = new Date();
    diff.assignedStaffId = [existing.assignedStaffId, body.assigned_staff_id];
  }

  if (Object.keys(diff).length === 0) {
    return NextResponse.json({ lead: existing, changed: false });
  }

  const updated = await db.transaction(async (tx) => {
    const [upd] = await tx.update(leads).set(patch).where(eq(leads.id, id)).returning();

    await tx.insert(activityLog).values({
      actorKind: "user",
      actorStaffId: user.id,
      actorName: user.name,
      actorRoleId: user.roleId,
      locationId: existing.locationId,
      targetType: "lead",
      targetId: id,
      targetLabel: existing.name,
      action: diff.callStatus ? "status_change" : "assigned",
      fromValue: diff.callStatus ? String(diff.callStatus[0]) : null,
      toValue: diff.callStatus ? String(diff.callStatus[1]) : null,
      diff,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
    });

    await tx.insert(realtimeEvents).values({
      channel: "leads:live",
      topic: "lead.updated",
      locationId: existing.locationId,
      requiredPermission: "leads.view",
      payload: { leadId: id, diff },
    });

    return upd;
  });

  return NextResponse.json({ lead: updated, changed: true });
});
