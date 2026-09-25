import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { activityLog } from "@/db/schema";
import { hangUpCall } from "@/server/vonage/telephony";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Disconnects a call that is in progress.
 *
 * Restricted to super_admin rather than to a permission. Every other
 * action in this console edits a record; this one reaches into a
 * conversation a customer is having and cuts it off, and there is no
 * undoing it — so it is not something a role can be granted by accident
 * while someone is ticking boxes on the permissions screen.
 */
export const POST = withAuth(
  "calls.manage",
  async (user, _req: NextRequest, ctx: { params: Promise<{ callId: string }> }) => {
    if (user.roleId !== "super_admin") {
      return NextResponse.json(
        { message: "Only a super admin can end a call in progress" },
        { status: 403 },
      );
    }

    const { callId } = await ctx.params;
    if (!callId) return NextResponse.json({ message: "No call id" }, { status: 400 });

    const result = await hangUpCall(callId);

    /* Recorded either way. A disconnected customer who rings back asking
       what happened deserves an answer, and a refusal that nobody logged
       looks the same as a call that simply ended. */
    await db.insert(activityLog).values({
      actorKind: "user",
      actorStaffId: user.id,
      actorName: user.name,
      actorRoleId: user.roleId,
      targetType: "call",
      targetId: callId,
      targetLabel: callId,
      action: "updated",
      summary: result.ok
        ? `Ended the call in progress`
        : `Tried to end the call in progress — refused: ${result.detail.slice(0, 200)}`,
    });

    if (!result.ok) {
      return NextResponse.json(
        { message: "Vonage refused to end the call", detail: result.detail },
        { status: 502 },
      );
    }

    return NextResponse.json({ status: "ok", callId });
  },
);
