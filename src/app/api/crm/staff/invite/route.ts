import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, locationScopes, roles, staff, staffInvites } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Inviting a colleague ──────────────────────────────────────────────
 * Creating an account needs a password, and there was no good way to set
 * one: an admin choosing it means a real credential travels through chat
 * and the admin knows it afterwards; a shared default means every new
 * account has the same password until someone remembers to change it.
 *
 * So the account is created with NO password — it cannot sign in — and the
 * admin gets a one-time link instead. The colleague sets their own; nobody
 * else ever learns it. Only the hash of the link's token is stored, the
 * same rule sessions follow.
 * ────────────────────────────────────────────────────────────────── */

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const POST = withAuth("staff.manage", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    role_id?: string;
    scope_all?: boolean;
    location_ids?: number[];
  };

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();

  if (name.length < 2) return NextResponse.json({ message: "Name is too short" }, { status: 422 });
  if (!EMAIL.test(email)) return NextResponse.json({ message: "Invalid email" }, { status: 422 });

  const [role] = await db.select().from(roles).where(eq(roles.id, String(body.role_id ?? ""))).limit(1);
  if (!role) return NextResponse.json({ message: "Pick a role" }, { status: 422 });

  /* Only an account that already covers every studio may hand out access to
     every studio, or a role that carries it. */
  const wantsEverything = body.scope_all === true || role.id === "super_admin";
  if (wantsEverything && !user.scopeAll) {
    return NextResponse.json({ message: "You cannot grant access wider than your own" }, { status: 403 });
  }

  const scopeIds = [...new Set((body.location_ids ?? []).filter(Number.isInteger))];
  if (!wantsEverything) {
    if (scopeIds.length === 0) {
      return NextResponse.json({ message: "Pick at least one studio" }, { status: 422 });
    }
    // A manager may only pass on studios they themselves cover.
    if (!user.scopeAll) {
      const outside = scopeIds.filter((id) => !user.locationIds.includes(id));
      if (outside.length > 0) {
        return NextResponse.json({ message: "Some of those studios are outside your access" }, { status: 403 });
      }
    }
  }

  const existing = await db.select({ id: staff.id }).from(staff).where(eq(staff.email, email)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ message: "An account already uses that email" }, { status: 409 });
  }

  /* passwordHash stays null. verifyPassword refuses a null stored hash, so
     the account exists but cannot sign in until the invite is accepted. */
  const [created] = await db
    .insert(staff)
    .values({
      name,
      email,
      roleId: role.id,
      scopeAll: wantsEverything,
      active: true,
      passwordHash: null,
    })
    .returning({ id: staff.id, name: staff.name, email: staff.email, roleId: staff.roleId });

  if (!wantsEverything && scopeIds.length > 0) {
    await db.insert(locationScopes).values(scopeIds.map((locationId) => ({ staffId: created.id, locationId })));
  }

  // Any earlier open invite for this person is void once a new one is cut.
  await db
    .update(staffInvites)
    .set({ acceptedAt: new Date() })
    .where(and(eq(staffInvites.staffId, created.id), isNull(staffInvites.acceptedAt)));

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.insert(staffInvites).values({
    tokenHash: createHash("sha256").update(token).digest("hex"),
    staffId: created.id,
    invitedBy: user.id,
    expiresAt,
  });

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    targetType: "staff",
    targetId: String(created.id),
    targetLabel: created.name,
    action: "created",
    toValue: role.id,
    summary: `Invited as ${role.id}${wantsEverything ? " (all studios)" : ` (${scopeIds.length} studio(s))`}`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  /* The raw token is returned exactly once, here, and never stored. If the
     admin loses it the invite is reissued, not recovered. */
  const base = process.env.PUBLIC_BASE_URL ?? "";
  return NextResponse.json(
    { staff: created, inviteUrl: `${base}/admin/invite/${token}`, expiresAt: expiresAt.toISOString() },
    { status: 201 },
  );
});
