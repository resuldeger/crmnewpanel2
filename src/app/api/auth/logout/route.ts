import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { activityLog } from "@/db/schema";
import { currentUser, destroySession } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const user = await currentUser();
  if (user) {
    await db.insert(activityLog).values({
      actorKind: "user",
      actorStaffId: user.id,
      actorName: user.name,
      actorRoleId: user.roleId,
      targetType: "staff",
      targetId: String(user.id),
      action: "logout",
    });
  }
  await destroySession();
  return NextResponse.json({ ok: true });
}
