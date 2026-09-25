import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, activityLog, realtimeEvents } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Staff appointment changes ─────────────────────────────────────────
 * The console could already flip a booking's status, but only in React
 * state: the operator saw "confirmed", the audit trail showed an entry, and
 * a reload brought the old status back because nothing was written. This is
 * the desk's half of the flow the booking screen starts — someone rings the
 * customer, confirms, and that has to survive.
 * ────────────────────────────────────────────────────────────────── */

const STATUSES = [
  "pending", "confirmed", "deposit_paid", "completed",
  "cancelled", "no_show", "rescheduled", "spam",
] as const;
type Status = (typeof STATUSES)[number];

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth("appts.edit", async (user, req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return NextResponse.json({ message: "Bad appointment id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    status?: string;
    cancel_reason?: string;
    assigned_staff_id?: number | null;
  };

  const [existing] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, numericId))
    .limit(1);
  if (!existing) return NextResponse.json({ message: "Appointment not found" }, { status: 404 });
  requireScope(user, existing.locationId);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const diff: Record<string, [unknown, unknown]> = {};

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as Status)) {
      return NextResponse.json({ message: "Unknown status" }, { status: 422 });
    }
    if (body.status !== existing.status) {
      const next = body.status as Status;
      patch.status = next;
      diff.status = [existing.status, next];

      /* Who confirmed, completed or cancelled this — and when — is the
         reporting the desk is measured on, so it is stamped here rather
         than inferred later from the audit log. */
      if (next === "confirmed") {
        patch.confirmedAt = new Date();
        patch.confirmedByStaffId = user.id;
      }
      if (next === "completed") {
        patch.completedAt = new Date();
        patch.completedByStaffId = user.id;
      }
      if (next === "cancelled") {
        patch.cancelledAt = new Date();
        patch.cancelledByStaffId = user.id;
        patch.cancelReason = body.cancel_reason ?? "cancelled_by_staff";
      }
      // Moving back out of a confirmed state must not leave the old stamp
      // behind, or the booking still reads as agreed by someone.
      if (next !== "confirmed" && next !== "deposit_paid" && next !== "completed") {
        patch.confirmedAt = null;
        patch.confirmedByStaffId = null;
      }
    }
  }

  if (body.assigned_staff_id !== undefined && body.assigned_staff_id !== existing.assignedStaffId) {
    patch.assignedStaffId = body.assigned_staff_id;
    diff.assignedStaffId = [existing.assignedStaffId, body.assigned_staff_id];
  }

  if (Object.keys(diff).length === 0) {
    return NextResponse.json({ appointment: existing, changed: false });
  }

  const updated = await db.transaction(async (tx) => {
    const [upd] = await tx
      .update(appointments)
      .set(patch)
      .where(eq(appointments.id, numericId))
      .returning();

    await tx.insert(activityLog).values({
      actorKind: "user",
      actorStaffId: user.id,
      actorName: user.name,
      actorRoleId: user.roleId,
      locationId: existing.locationId,
      targetType: "appointment",
      targetId: String(numericId),
      targetLabel: existing.bkUuid,
      action: diff.status ? "status_change" : "assigned",
      fromValue: diff.status ? String(diff.status[0]) : null,
      toValue: diff.status ? String(diff.status[1]) : null,
      diff,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent"),
    });

    await tx.insert(realtimeEvents).values({
      channel: "appointments:live",
      topic: "appointment.updated",
      locationId: existing.locationId,
      requiredPermission: "appts.view",
      payload: { id: numericId, bkUuid: existing.bkUuid, diff, by: user.name },
    });

    return upd;
  });

  return NextResponse.json({ appointment: updated, changed: true });
});
