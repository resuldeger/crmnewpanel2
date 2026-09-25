import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { calls, activityLog, realtimeEvents } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { normalizeNumber } from "@/server/twilio/resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Records an outbound call attempt made by an agent.
 *
 * It records an ATTEMPT and nothing more. The console used to invent the
 * outcome here — a coin flip decided "Answered" 60% of the time and a
 * random number became the talk duration — so the call log and every
 * report built on it were fiction. The real result arrives from the
 * carrier webhook and updates this row.
 */
export const POST = withAuth("calls.manage", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    to?: string; lead_id?: string; customer_id?: string;
    appointment_id?: number; location_id?: number; name?: string;
  };

  const to = normalizeNumber(body.to);
  if (!to) return NextResponse.json({ message: "A phone number is required" }, { status: 422 });
  if (!body.location_id) return NextResponse.json({ message: "location_id is required" }, { status: 422 });
  requireScope(user, body.location_id);

  const [row] = await db
    .insert(calls)
    .values({
      provider: "console",
      direction: "outbound",
      fromNumber: user.email,
      toNumber: to,
      fromName: user.name,
      toName: body.name ?? null,
      leadId: body.lead_id ?? null,
      customerId: body.customer_id ?? null,
      appointmentId: body.appointment_id ?? null,
      locationId: body.location_id,
      staffId: user.id,
      agentName: user.name,
      startTime: new Date(),
      duration: 0,
      result: "Attempted",
      initiatedFromConsole: true,
    })
    .returning();

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: body.location_id,
    targetType: "call",
    targetId: String(row.id),
    targetLabel: `${body.name ?? to}`,
    action: "call_logged",
    summary: `Outbound attempt to ${to}`,
  });

  await db.insert(realtimeEvents).values({
    channel: "calls:live",
    topic: "call.attempted",
    locationId: body.location_id,
    requiredPermission: "calls.view",
    payload: { callId: row.id, to, agent: user.name },
  });

  return NextResponse.json({ call: row }, { status: 201 });
});
