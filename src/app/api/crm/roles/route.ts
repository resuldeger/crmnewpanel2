import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, permissions, rolePermissions, roles, staff } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── The permission matrix ─────────────────────────────────────────────
 * Ticking a box in Staff → Permissions only changed React state: the grant
 * looked applied, every server check still used the old matrix, and the
 * tick was gone on reload. Worse in the revoking direction — an operator
 * believed they had taken an ability away and had not.
 * ────────────────────────────────────────────────────────────────── */

export const GET = withAuth("staff.view", async () => {
  const [roleRows, permRows, grants] = await Promise.all([
    db.select().from(roles),
    db.select().from(permissions),
    db.select().from(rolePermissions),
  ]);

  const matrix: Record<string, string[]> = {};
  for (const r of roleRows) matrix[r.id] = [];
  for (const g of grants) (matrix[g.roleId] ??= []).push(g.permissionId);

  return NextResponse.json({ roles: roleRows, permissions: permRows, matrix });
});

export const PATCH = withAuth("staff.manage", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    role_id?: string;
    permission_id?: string;
    granted?: boolean;
  };

  const roleId = String(body.role_id ?? "");
  const permissionId = String(body.permission_id ?? "");
  const granted = body.granted === true;

  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) return NextResponse.json({ message: `Unknown role: ${roleId}` }, { status: 422 });

  const [perm] = await db.select().from(permissions).where(eq(permissions.id, permissionId)).limit(1);
  if (!perm) return NextResponse.json({ message: `Unknown permission: ${permissionId}` }, { status: 422 });

  /* super_admin is the role that can restore any other. Stripping it of
     staff.manage would lock the whole matrix with no way back in. */
  if (roleId === "super_admin" && !granted) {
    return NextResponse.json(
      { message: "Super Admin keeps every permission — change the person's role instead" },
      { status: 409 },
    );
  }

  // Nobody may remove a permission they are currently relying on to be here.
  if (!granted && permissionId === "staff.manage" && user.roleId === roleId) {
    return NextResponse.json(
      { message: "You cannot remove staff.manage from your own role" },
      { status: 409 },
    );
  }

  const existing = await db
    .select()
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)))
    .limit(1);

  const had = existing.length > 0;
  if (had === granted) return NextResponse.json({ changed: false });

  if (granted) {
    await db.insert(rolePermissions).values({ roleId, permissionId }).onConflictDoNothing();
  } else {
    await db
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)));
  }

  const affected = await db.select({ id: staff.id }).from(staff).where(eq(staff.roleId, roleId));

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    targetType: "role",
    targetId: roleId,
    targetLabel: role.name ?? roleId,
    action: "permission_change",
    fromValue: had ? permissionId : null,
    toValue: granted ? permissionId : null,
    summary: `${granted ? "Granted" : "Revoked"} ${permissionId} for ${roleId} (${affected.length} account(s))`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ changed: true, affectedStaff: affected.length });
});
