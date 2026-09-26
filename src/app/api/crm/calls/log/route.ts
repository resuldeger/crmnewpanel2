import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { calls, activityLog, realtimeEvents } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { normalizeNumber } from "@/server/twilio/resolve";
import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
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
 * Dialling needs a line to ring first, and it is the branch's rather than
 * the agent's. There is no per-person extension here: twelve call-centre
 * lines are shared by whoever is on shift, and the rest belong to
 * studios. Requiring an administrator to link every member of staff to a
 * line would have left the feature switched off for everyone.
 *
 * So the call decides. A callback for Riverside is dialled from
 * Riverside's own extension, which is also the number the customer will
 * recognise when it rings them. Anything with no studio falls back to a
 * call-centre line.
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
  /* A studio we could not work out is not a reason to refuse the call.
     Plenty of missed calls arrive on an extension the directory does not
     know, and "call this person back" is still the right thing to do —
     the console was being told to require something it could not supply. */
  const locationId = body.location_id ? body.location_id : null;
  if (locationId !== null) requireScope(user, locationId);
  else if (!user.scopeAll) {
    return NextResponse.json({ message: "Pick a studio for this call" }, { status: 422 });
  }

  /* The studio's own line first, a call-centre line second. Named
     individual extensions exist in the directory and are deliberately not
     used: they belong to whoever the carrier account says, not to whoever
     is signed in here. */
  const [branchLine] = await db
    .select({ extension: extensions.extension })
    .from(extensions)
    .where(locationId === null ? sql`false` : eq(extensions.locationId, locationId))
    .orderBy(asc(extensions.extension))
    .limit(1);

  const [callCentreLine] = branchLine
    ? []
    : await db
        .select({ extension: extensions.extension })
        .from(extensions)
        .where(and(isNull(extensions.locationId), ilike(extensions.displayName, "%callcenter%")))
        .orderBy(asc(extensions.extension))
        .limit(1);

  const mine = branchLine ?? callCentreLine ?? null;

  let dialled: { ok: boolean; detail?: string; callId?: string | null } = {
    ok: false,
    detail: "no line is configured for this studio or the call centre",
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
      locationId,
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
    locationId,
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
