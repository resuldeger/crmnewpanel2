import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, staff, staffInvites } from "@/db/schema";
import { hashPassword, passwordProblems } from "@/server/auth/password";
import { allow } from "@/server/redis";
import { clientIp } from "@/server/booking/attribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Accepting an invitation ───────────────────────────────────────────
 * Unauthenticated by necessity: the person has no account yet. The token
 * IS the credential, so it is treated like one — looked up by hash, single
 * use, time limited, rate limited per address.
 *
 * Nothing here reveals whether a token merely expired or never existed:
 * both answer the same way, so the endpoint cannot be used to test tokens.
 * ────────────────────────────────────────────────────────────────── */

const REFUSED = { message: "This invitation is not valid any more" };

async function findInvite(token: string) {
  if (!token || token.length < 20) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const [row] = await db
    .select({
      inviteId: staffInvites.id,
      staffId: staff.id,
      name: staff.name,
      email: staff.email,
      roleId: staff.roleId,
      active: staff.active,
      passwordHash: staff.passwordHash,
    })
    .from(staffInvites)
    .innerJoin(staff, eq(staff.id, staffInvites.staffId))
    .where(
      and(
        eq(staffInvites.tokenHash, tokenHash),
        isNull(staffInvites.acceptedAt),
        gt(staffInvites.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** What the invite page shows before the password is chosen. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const invite = await findInvite(token);
  if (!invite || !invite.active) return NextResponse.json(REFUSED, { status: 404 });

  // Name and email only — enough to confirm it is the right person.
  return NextResponse.json({ name: invite.name, email: invite.email, roleId: invite.roleId });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers) ?? "unknown";
  // Guessing a 256-bit token is hopeless, but the limit costs nothing.
  if (!(await allow("invite:accept", ip, 10, 600))) {
    return NextResponse.json({ message: "Too many attempts" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { token?: string; password?: string };
  const invite = await findInvite(String(body.token ?? ""));
  if (!invite || !invite.active) return NextResponse.json(REFUSED, { status: 404 });

  /* An account that already has a password is not waiting for an invite —
     accepting one here would be a takeover, not a setup. */
  if (invite.passwordHash) return NextResponse.json(REFUSED, { status: 409 });

  const password = String(body.password ?? "");
  const problems = passwordProblems(password);
  if (problems.length > 0) {
    return NextResponse.json({ message: problems[0], problems }, { status: 422 });
  }

  const hash = await hashPassword(password);

  /* Marked accepted in the same breath as the password landing, and only
     while it is still unaccepted — two people opening the same link cannot
     both get through. */
  const claimed = await db
    .update(staffInvites)
    .set({ acceptedAt: new Date() })
    .where(and(eq(staffInvites.id, invite.inviteId), isNull(staffInvites.acceptedAt)))
    .returning({ id: staffInvites.id });

  if (claimed.length === 0) return NextResponse.json(REFUSED, { status: 409 });

  await db
    .update(staff)
    .set({ passwordHash: hash, updatedAt: new Date() })
    .where(eq(staff.id, invite.staffId));

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: invite.staffId,
    actorName: invite.name,
    actorRoleId: invite.roleId,
    targetType: "staff",
    targetId: String(invite.staffId),
    targetLabel: invite.name,
    action: "updated",
    summary: "Invitation accepted, password set",
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  // No session is issued here: they sign in normally, which proves the
  // password works before anyone relies on it.
  return NextResponse.json({ status: "success", email: invite.email });
}
