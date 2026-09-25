import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { staff, roles, activityLog } from "@/db/schema";
import { verifyPassword } from "@/server/auth/password";
import { createSession, purgeExpiredSessions, currentUser } from "@/server/auth/session";
import { clientIp } from "@/server/booking/attribution";
import { allow } from "@/server/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers) ?? "unknown";
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  // Throttle per IP and per account, so neither a spray nor a single-account
  // brute force gets unlimited attempts.
  const ipOk = await allow("login:ip", ip, 20, 300);
  const accountOk = email ? await allow("login:account", email, 8, 300) : true;
  if (!ipOk || !accountOk) {
    return NextResponse.json({ message: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }

  const [found] = email
    ? await db.select({ s: staff, roleName: roles.name }).from(staff)
        .innerJoin(roles, eq(roles.id, staff.roleId))
        .where(eq(staff.email, email)).limit(1)
    : [];

  // Run the verify even when no account matched: same timing either way.
  const passwordOk = await verifyPassword(password, found?.s.passwordHash ?? null);

  if (!found || !passwordOk) {
    // Never say which half was wrong — that confirms account existence.
    return NextResponse.json({ message: "Email or password is incorrect" }, { status: 401 });
  }
  if (!found.s.active) {
    return NextResponse.json({ message: "This account is deactivated" }, { status: 403 });
  }

  await purgeExpiredSessions();
  await createSession(found.s.id, req);

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: found.s.id,
    actorName: found.s.name,
    actorRoleId: found.s.roleId,
    targetType: "staff",
    targetId: String(found.s.id),
    action: "login",
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  const user = await currentUser();
  return NextResponse.json({ user });
}
