import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks, locations, staff, activityLog } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { scopeWhere, compact } from "@/server/crm/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withAuth("calls.view", async (user, req: NextRequest) => {
  const status = req.nextUrl.searchParams.get("status") ?? "open";

  const where = and(
    ...compact([
      scopeWhere(user, tasks.locationId),
      status !== "all" ? eq(tasks.status, status as never) : undefined,
    ]),
  );

  const rows = await db
    .select({
      task: tasks,
      studio: { id: locations.id, city: locations.city },
      assignee: { id: staff.id, name: staff.name },
    })
    .from(tasks)
    .leftJoin(locations, eq(locations.id, tasks.locationId))
    .leftJoin(staff, eq(staff.id, tasks.assigneeStaffId))
    .where(where)
    .orderBy(asc(tasks.dueAt))
    .limit(200);

  return NextResponse.json(
    { tasks: rows.map((r) => ({ ...r.task, studio: r.studio, assignee: r.assignee })) },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/* ── Writes ────────────────────────────────────────────────────────────
 * The task list is the desk's callback queue: an SLA breach, a voicemail,
 * a "ring them back tomorrow". Creating and completing a task only changed
 * React state, so the queue emptied itself on reload and the callback was
 * never made. */

const SOURCES = ["callback", "voicemail", "manual", "follow_up", "sla_breach"] as const;
type Source = (typeof SOURCES)[number];

export const POST = withAuth("calls.manage", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    lead_id?: string | null;
    appointment_id?: number | null;
    lead_name?: string | null;
    phone_e164?: string | null;
    location_id?: number | null;
    assignee_staff_id?: number | null;
    due_at?: string | null;
    source?: string;
  };

  const title = String(body.title ?? "").trim();
  if (title.length < 2 || title.length > 300) {
    return NextResponse.json({ message: "Title must be 2–300 characters" }, { status: 422 });
  }

  const source = SOURCES.includes(body.source as Source) ? (body.source as Source) : "manual";

  // A task belongs to a studio; without scoping it, one branch could queue
  // work on another's desk.
  const locationId = body.location_id ?? null;
  if (locationId !== null) requireScope(user, locationId);
  else if (!user.scopeAll) {
    return NextResponse.json({ message: "Pick a studio for this task" }, { status: 422 });
  }

  /* due_at is NOT NULL: a callback with no time is due now, which is what
     puts it at the top of the queue rather than nowhere. */
  let dueAt = new Date();
  if (body.due_at) {
    const parsed = new Date(body.due_at);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ message: "Invalid due date" }, { status: 422 });
    }
    dueAt = parsed;
  }

  const [row] = await db
    .insert(tasks)
    .values({
      title,
      leadId: body.lead_id ?? null,
      appointmentId: body.appointment_id ?? null,
      leadName: body.lead_name ?? null,
      phoneE164: body.phone_e164 ?? null,
      locationId,
      assigneeStaffId: body.assignee_staff_id ?? null,
      createdByStaffId: user.id,
      dueAt,
      source,
      status: "open",
    })
    .returning();

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId,
    targetType: "task",
    targetId: String(row.id),
    targetLabel: title.slice(0, 80),
    action: "created",
    summary: `Task created (${source})`,
  });

  return NextResponse.json({ task: row }, { status: 201 });
});

export const PATCH = withAuth("calls.manage", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    id?: number;
    status?: string;
    assignee_staff_id?: number | null;
  };

  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ message: "Bad task id" }, { status: 400 });

  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!existing) return NextResponse.json({ message: "Task not found" }, { status: 404 });
  requireScope(user, existing.locationId);

  const patch: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (body.status !== "open" && body.status !== "done") {
      return NextResponse.json({ message: "Status must be open or done" }, { status: 422 });
    }
    patch.status = body.status;
    // Who closed it and when — the metric the desk is measured on.
    patch.doneAt = body.status === "done" ? new Date() : null;
    patch.doneByStaffId = body.status === "done" ? user.id : null;
  }

  if (body.assignee_staff_id !== undefined) patch.assigneeStaffId = body.assignee_staff_id;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ task: existing, changed: false });
  }

  const [updated] = await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: existing.locationId,
    targetType: "task",
    targetId: String(id),
    targetLabel: existing.title.slice(0, 80),
    action: body.status ? "status_change" : "assigned",
    fromValue: body.status ? existing.status : null,
    toValue: body.status ?? null,
  });

  return NextResponse.json({ task: updated, changed: true });
});

export const DELETE = withAuth("calls.manage", async (user, req: NextRequest) => {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ message: "Bad task id" }, { status: 400 });

  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!existing) return NextResponse.json({ message: "Task not found" }, { status: 404 });
  requireScope(user, existing.locationId);

  await db.delete(tasks).where(eq(tasks.id, id));

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: existing.locationId,
    targetType: "task",
    targetId: String(id),
    targetLabel: existing.title.slice(0, 80),
    action: "deleted",
    summary: "Task deleted",
  });

  return NextResponse.json({ ok: true });
});
