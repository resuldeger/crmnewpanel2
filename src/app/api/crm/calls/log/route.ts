import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { calls, activityLog, realtimeEvents } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { normalizeNumber } from "@/server/twilio/resolve";
import { eq } from "drizzle-orm";
import { extensions } from "@/db/schema";
import { placeCall } from "@/server/vonage/telephony";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Places an outbound call, and records it.
 *
 * It used to only record. The row said "Attempted", the toast said
 * "Calling…", and nothing dialled — the agent still picked up a handset
 * and typed the number, while the console claimed to have rung it.
 *
 * Dialling needs to know which phone to ring first, which is the agent's
 * own extension. That comes from the extensions table, where an
 * administrator links a staff member to their line. Nobody is linked yet,
 * so this answers honestly rather than pretending: the attempt is still
 * recorded, and the response says it was not dialled and why.
 *
 * The outcome is never invented here. A coin flip used to decide
 * "Answered" 60% of the time with a random talk duration, so the log and
 * every report on it were fiction. The real result arrives from the
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

  /* The agent's own line. Without it there is nothing to ring first, and
     guessing an extension would place the call from a colleague's phone. */
  const [mine] = await db
    .select({ extension: extensions.extension })
    .from(extensions)
    .where(eq(extensions.staffId, user.id))
    .limit(1);

  let dialled: { ok: boolean; detail?: string; callId?: string | null } = {
    ok: false,
    detail: "no extension is linked to this account",
  };
  if (mine?.extension) {
    const placed = await placeCall(mine.extension, to);
    dialled = placed.ok
      ? { ok: true, callId: placed.callId }
      : { ok: false, detail: placed.detail };
    if (!placed.ok) console.warn(`calls/log: could not dial ${to} from ${mine.extension} — ${placed.detail}`);
  }

  const [row] = await db
    .insert(calls)
    .values({
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
      extension: mine?.extension ?? null,
      /* The carrier's own id when it dialled, so the webhook that reports
         the outcome lands on THIS row instead of creating a second one. */
      provider: dialled.ok ? "vonage" : "console",
      externalCallId: dialled.callId ?? null,
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

  /* The console needs to know which of the two happened, because "we are
     ringing your phone now" and "this is logged, dial it yourself" are
     different instructions to the person reading it. */
  return NextResponse.json(
    { call: row, dialled: dialled.ok, reason: dialled.ok ? null : dialled.detail },
    { status: 201 },
  );
});
