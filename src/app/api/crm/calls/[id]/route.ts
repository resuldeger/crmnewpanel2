import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, calls } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESULTS = ["Answered", "Missed", "Voicemail", "Attempted"] as const;
type Result = (typeof RESULTS)[number];

/* ── Correcting what a call actually was ───────────────────────────────
 * Vonage marks an outbound leg that reached the customer's voicemail as
 * "Answered" — from the carrier's side the far end did pick up, and no
 * field separates the two. Eighteen seconds of leaving a message is
 * counted as a conversation, and every report built on that is wrong in
 * the same direction.
 *
 * Only the desk can tell, by listening. So they say, and it sticks: the
 * row is flagged and both webhooks then leave `result` alone. The
 * carrier's own verdict is kept in `result_was`, so the correction can be
 * undone and so a disagreement is visible rather than overwritten.
 * ────────────────────────────────────────────────────────────────── */
export const PATCH = withAuth("calls.manage", async (user, req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const callId = Number(id);
  if (!Number.isInteger(callId)) {
    return NextResponse.json({ message: "Not a call id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { result?: string; clear?: boolean };

  const [call] = await db
    .select({
      id: calls.id,
      result: calls.result,
      locationId: calls.locationId,
      locked: calls.resultLocked,
      was: calls.resultWas,
    })
    .from(calls)
    .where(eq(calls.id, callId))
    .limit(1);

  if (!call) return NextResponse.json({ message: "Call not found" }, { status: 404 });
  // A branch manager may not reclassify another branch's calls.
  if (call.locationId) requireScope(user, call.locationId);

  /* Undo: hand the row back to the carrier, restoring what it last said
     so the next sync is not compared against a human's answer. */
  if (body.clear === true) {
    const [updated] = await db
      .update(calls)
      .set({
        result: (call.was as Result | null) ?? call.result,
        resultLocked: false,
        resultSetBy: null,
        resultSetAt: null,
        resultWas: null,
      })
      .where(eq(calls.id, callId))
      .returning({ result: calls.result, resultLocked: calls.resultLocked });

    await db.insert(activityLog).values({
      actorStaffId: user.id,
      actorName: user.name,
      actorRoleId: user.roleId,
      locationId: call.locationId,
      targetType: "call",
      targetId: String(callId),
      action: "updated",
      fromValue: call.result,
      toValue: updated.result,
      summary: "outcome handed back to the carrier",
    });

    return NextResponse.json({ result: updated.result, resultLocked: false });
  }

  const wanted = String(body.result ?? "") as Result;
  if (!RESULTS.includes(wanted)) {
    return NextResponse.json({ message: `result must be one of ${RESULTS.join(", ")}` }, { status: 422 });
  }
  if (wanted === call.result && call.locked) {
    return NextResponse.json({ result: call.result, resultLocked: true });
  }

  const [updated] = await db
    .update(calls)
    .set({
      result: wanted,
      resultLocked: true,
      resultSetBy: user.id,
      resultSetAt: new Date(),
      // Only on the first correction, or a second one would record the
      // first person's answer as the carrier's.
      resultWas: call.locked ? call.was : call.result,
    })
    .where(eq(calls.id, callId))
    .returning({ result: calls.result, resultLocked: calls.resultLocked, resultWas: calls.resultWas });

  /* Reclassifying a call moves a number on every report that counts
     outcomes, so it is not a silent edit. */
  await db.insert(activityLog).values({
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: call.locationId,
    targetType: "call",
    targetId: String(callId),
    action: "status_change",
    fromValue: call.result,
    toValue: wanted,
    summary: `carrier said ${updated.resultWas ?? call.result}`,
  });

  return NextResponse.json({
    result: updated.result,
    resultLocked: updated.resultLocked,
    resultWas: updated.resultWas,
  });
});
