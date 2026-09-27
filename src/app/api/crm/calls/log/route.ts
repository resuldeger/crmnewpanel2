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
 * Dialling needs a line to ring FIRST — Vonage rings that extension and
 * connects the customer when it is answered. So the line has to be one the
 * person pressing the button is actually sitting at, and for a while there
 * was no such thing: nobody had a personal extension, twelve call-centre
 * lines were shared by whoever was on shift, and the rest belonged to
 * studios. Picking by branch was the only option.
 *
 * That assumption broke the moment somebody did have their own extension.
 * The button dialled a call-centre seat nobody was at, Vonage rang the
 * customer, the customer answered, and there was silence on the line —
 * which is worse than the feature not working, because the customer has
 * been disturbed by a call from us with nobody on it.
 *
 * So the agent's own line comes first now. The branch and the call-centre
 * seats remain, in that order, for everyone who has not been linked to one
 * — which is still most people, and they are no worse off than before.
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

  /* ── Which line rings first ──────────────────────────────────────
     The agent's own, when the directory knows which one is theirs. It is
     the only line they can answer, and a call the agent cannot answer is a
     customer picking up to silence.

     A named extension is claimed by a person in the console — `staff_id` is
     set here, never by the carrier sync — so this is our mapping and not a
     guess at who owns what in the Vonage account. */
  const [ownLine] = await db
    .select({ extension: extensions.extension })
    .from(extensions)
    .where(eq(extensions.staffId, user.id))
    .orderBy(asc(extensions.extension))
    .limit(1);

  const [branchLine] = ownLine
    ? []
    : await db
        .select({ extension: extensions.extension })
        .from(extensions)
        .where(locationId === null ? sql`false` : eq(extensions.locationId, locationId))
        .orderBy(asc(extensions.extension))
        .limit(1);

  const [callCentreLine] = ownLine || branchLine
    ? []
    : await db
        .select({ extension: extensions.extension })
        .from(extensions)
        .where(and(isNull(extensions.locationId), ilike(extensions.displayName, "%callcenter%")))
        .orderBy(asc(extensions.extension))
        .limit(1);

  const mine = ownLine ?? branchLine ?? callCentreLine ?? null;

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
