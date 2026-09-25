import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { activityLog } from "@/db/schema";
import { clearHalt } from "@/server/integrations/health";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lifts a halt after someone has fixed the cause.
 *
 * Deliberately a manual act. The failure that halts an integration is one
 * where retrying makes things worse — a locked account stays locked for as
 * long as anything keeps trying — so nothing here resumes on a timer.
 */
export const POST = withAuth(
  "settings.manage",
  async (user, _req: NextRequest, ctx: { params: Promise<{ provider: string }> }) => {
    const { provider } = await ctx.params;

    const cleared = await clearHalt(provider, { id: user.id, name: user.name });
    if (!cleared) {
      return NextResponse.json({ message: "Unknown integration" }, { status: 404 });
    }

    /* Worth a trail entry: it asserts the cause was dealt with, and if the
       integration halts again straight away that claim is the thing to
       look at first. */
    await db.insert(activityLog).values({
      actorKind: "user",
      actorStaffId: user.id,
      actorName: user.name,
      actorRoleId: user.roleId,
      targetType: "setting",
      targetId: `integration:${provider}`,
      targetLabel: provider,
      action: "updated",
      summary: `Cleared the halt on ${provider}`,
    });

    return NextResponse.json({ status: "ok", provider });
  },
);
