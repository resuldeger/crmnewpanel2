import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, notifications, realtimeEvents, staff, tasks } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Handing a task to someone ─────────────────────────────────────────
 * Assigning work silently is the same as not assigning it. The person is
 * not looking at the task list — they are on a call, or on another screen
 * — so the queue grows and everyone assumes somebody else has it.
 *
 * So an assignment writes a notification for them and pushes it down
 * their own socket. realtime_events with a staff_id is delivered to that
 * one account and nobody else, which matters because the task names a
 * customer.
 * ────────────────────────────────────────────────────────────────── */
export const PATCH = withAuth("calls.manage", async (user, req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) {
    return NextResponse.json({ message: "Not a task id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { assignee_staff_id?: number | null; status?: string };

  const [task] = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      leadName: tasks.leadName,
      locationId: tasks.locationId,
      assigneeStaffId: tasks.assigneeStaffId,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!task) return NextResponse.json({ message: "Task not found" }, { status: 404 });
  if (task.locationId) requireScope(user, task.locationId);

  const wanted = body.assignee_staff_id;
  if (wanted === undefined) {
    return NextResponse.json({ message: "assignee_staff_id is required" }, { status: 422 });
  }

  /* Unassigning is allowed — putting something back in the pool is a real
     decision — but assigning to someone who does not exist is not. */
  let recipient: { id: number; name: string } | null = null;
  if (wanted !== null) {
    const [found] = await db
      .select({ id: staff.id, name: staff.name, active: staff.active })
      .from(staff)
      .where(eq(staff.id, wanted))
      .limit(1);
    if (!found) return NextResponse.json({ message: "No such person" }, { status: 422 });
    if (!found.active) return NextResponse.json({ message: "That account is deactivated" }, { status: 422 });
    recipient = { id: found.id, name: found.name };
  }

  await db.update(tasks).set({ assigneeStaffId: wanted }).where(eq(tasks.id, taskId));

  const [previous] = task.assigneeStaffId
    ? await db.select({ name: staff.name }).from(staff).where(eq(staff.id, task.assigneeStaffId)).limit(1)
    : [];

  await db.insert(activityLog).values({
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: task.locationId,
    targetType: "task",
    targetId: String(taskId),
    targetLabel: task.leadName ?? task.title,
    action: "updated",
    fromValue: previous?.name ?? null,
    toValue: recipient?.name ?? null,
    summary: recipient ? `assigned to ${recipient.name}` : "returned to the pool",
  });

  /* Telling them. Not for an assignment to yourself — you were the one
     who pressed the button. */
  if (recipient && recipient.id !== user.id) {
    await db.insert(notifications).values({
      staffId: recipient.id,
      kind: "task_assigned",
      title: task.leadName ? `Call back ${task.leadName}` : task.title,
      body: `${user.name} assigned this to you.`,
      href: "/admin/tasks",
      severity: "info",
    });

    await db.insert(realtimeEvents).values({
      channel: "notifications",
      topic: "task.assigned",
      staffId: recipient.id,
      locationId: task.locationId,
      payload: { taskId, title: task.title, by: user.name, leadName: task.leadName },
    });
  }

  return NextResponse.json({ id: taskId, assigneeStaffId: wanted, assigneeName: recipient?.name ?? null });
});
