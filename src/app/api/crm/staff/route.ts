import { NextResponse, type NextRequest } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, locationScopes, roles, staff } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";
import { hashPassword, passwordProblems } from "@/server/auth/password";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

const withoutHash = <T extends { passwordHash?: string | null }>(row: T) => {
  const { passwordHash: _h, ...rest } = row;
  void _h;
  return rest;
};

/**
 * POST /api/crm/staff
 * Creates a new staff member with an optional direct password.
 */
export const POST = withAuth("staff.manage", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    role_id?: string;
    password?: string;
    scope_all?: boolean;
    location_ids?: number[];
    phone_e164?: string | null;
    vonage_extension?: string | null;
    locale?: string;
  };

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const roleId = body.role_id || "callcenter_agent";

  if (!name || name.length < 2) return NextResponse.json({ message: "Name is required" }, { status: 422 });
  if (!email || !EMAIL.test(email)) return NextResponse.json({ message: "Invalid email" }, { status: 422 });

  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) return NextResponse.json({ message: `Unknown role: ${roleId}` }, { status: 422 });

  const clash = await db.select({ id: staff.id }).from(staff).where(eq(staff.email, email)).limit(1);
  if (clash.length > 0) {
    return NextResponse.json({ message: "Another account already uses that email" }, { status: 409 });
  }

  let passwordHash: string | null = null;
  if (body.password && body.password.trim()) {
    const pwd = body.password.trim();
    const prob = passwordProblems(pwd);
    if (prob) return NextResponse.json({ message: prob }, { status: 422 });
    passwordHash = await hashPassword(pwd);
  }

  const [created] = await db
    .insert(staff)
    .values({
      name,
      email,
      roleId,
      passwordHash,
      scopeAll: body.scope_all ?? true,
      active: true,
      phoneE164: body.phone_e164?.trim() || null,
      vonageExtension: body.vonage_extension?.trim() || null,
      locale: body.locale || "tr",
    })
    .returning();

  if (body.scope_all === false && Array.isArray(body.location_ids) && body.location_ids.length > 0) {
    const ids = [...new Set(body.location_ids.filter(Number.isInteger))];
    if (ids.length > 0) {
      await db.insert(locationScopes).values(ids.map((locationId) => ({ staffId: created.id, locationId })));
    }
  }

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    targetType: "staff",
    targetId: String(created.id),
    targetLabel: created.name,
    action: "created",
    summary: `Created staff account ${created.name} (${created.email})`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ staff: withoutHash(created) }, { status: 201 });
});

/**
 * PATCH /api/crm/staff
 * Updates a staff member's details or sets a new password.
 */
export const PATCH = withAuth("staff.manage", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    id?: number;
    name?: string;
    email?: string;
    password?: string;
    role_id?: string;
    active?: boolean;
    scope_all?: boolean;
    location_ids?: number[];
    phone_e164?: string | null;
    vonage_extension?: string | null;
    locale?: string;
  };

  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ message: "Bad staff id" }, { status: 400 });

  const [existing] = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
  if (!existing) return NextResponse.json({ message: "Staff member not found" }, { status: 404 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const diff: Record<string, [unknown, unknown]> = {};

  const setIf = (key: string, next: unknown) => {
    if (next === undefined) return;
    const before = (existing as Record<string, unknown>)[key];
    if (before === next) return;
    patch[key] = next;
    diff[key] = [before, next];
  };

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL.test(email)) return NextResponse.json({ message: "Invalid email" }, { status: 422 });
    const clash = await db.select({ id: staff.id }).from(staff).where(eq(staff.email, email)).limit(1);
    if (clash.length > 0 && clash[0].id !== id) {
      return NextResponse.json({ message: "Another account already uses that email" }, { status: 409 });
    }
    setIf("email", email);
  }

  if (body.role_id !== undefined) {
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, body.role_id)).limit(1);
    if (!role) return NextResponse.json({ message: `Unknown role: ${body.role_id}` }, { status: 422 });
    setIf("roleId", body.role_id);
  }

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length < 2) return NextResponse.json({ message: "Name is too short" }, { status: 422 });
    setIf("name", name);
  }

  if (body.password && body.password.trim()) {
    const pwd = body.password.trim();
    const prob = passwordProblems(pwd);
    if (prob) return NextResponse.json({ message: prob }, { status: 422 });
    patch.passwordHash = await hashPassword(pwd);
    diff.password = ["(unchanged)", "(updated)"];
  }

  if (body.active === false && id === user.id) {
    return NextResponse.json({ message: "You cannot deactivate your own account" }, { status: 409 });
  }
  if ((body.active === false || (body.role_id && body.role_id !== "super_admin")) && existing.roleId === "super_admin") {
    const others = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.roleId, "super_admin"), ne(staff.id, id)));
    if (others.length === 0) {
      return NextResponse.json({ message: "This is the last super admin" }, { status: 409 });
    }
  }

  setIf("active", body.active);
  setIf("scopeAll", body.scope_all);
  setIf("phoneE164", body.phone_e164 === undefined ? undefined : body.phone_e164?.trim() || null);
  setIf("vonageExtension", body.vonage_extension === undefined ? undefined : body.vonage_extension?.trim() || null);
  setIf("locale", body.locale);

  let scopeChanged = false;
  if (Array.isArray(body.location_ids)) {
    const wanted = [...new Set(body.location_ids.filter(Number.isInteger))];
    const current = await db
      .select({ locationId: locationScopes.locationId })
      .from(locationScopes)
      .where(eq(locationScopes.staffId, id));
    const currentIds = current.map((r) => r.locationId).sort();
    if (JSON.stringify(currentIds) !== JSON.stringify([...wanted].sort())) {
      scopeChanged = true;
      /* One transaction: this is a replacement, and a failure between the
         delete and the insert leaves a branch manager scoped to nothing —
         which is not "no restriction", it is every studio gone, and nobody
         would connect it to an edit that appeared to fail. */
      await db.transaction(async (tx) => {
        await tx.delete(locationScopes).where(eq(locationScopes.staffId, id));
        if (wanted.length > 0) {
          await tx.insert(locationScopes).values(wanted.map((locationId) => ({ staffId: id, locationId })));
        }
      });
      diff.locationIds = [currentIds, wanted];
    }
  }

  if (Object.keys(diff).length === 0 && !patch.passwordHash) {
    return NextResponse.json({ staff: withoutHash(existing), changed: false });
  }

  const [updated] = Object.keys(patch).length > 1
    ? await db.update(staff).set(patch).where(eq(staff.id, id)).returning()
    : [existing];

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    targetType: "staff",
    targetId: String(id),
    targetLabel: existing.name,
    action: diff.roleId || scopeChanged ? "permission_change" : "updated",
    diff,
    summary: `Updated ${Object.keys(diff).join(", ")}`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ staff: withoutHash(updated), changed: true });
});

/**
 * DELETE /api/crm/staff
 * Deletes a staff member account.
 */
export const DELETE = withAuth("staff.manage", async (user, req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ message: "Invalid id" }, { status: 400 });

  if (id === user.id) {
    return NextResponse.json({ message: "You cannot delete your own account" }, { status: 409 });
  }

  const [existing] = await db.select().from(staff).where(eq(staff.id, id)).limit(1);
  if (!existing) return NextResponse.json({ message: "Staff member not found" }, { status: 404 });

  if (existing.roleId === "super_admin") {
    const others = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.roleId, "super_admin"), ne(staff.id, id)));
    if (others.length === 0) {
      return NextResponse.json({ message: "Cannot delete the last super admin" }, { status: 409 });
    }
  }

  /* One statement, not five. Invites, scopes, presence and sessions all
     cascade off the staff row already, so the four deletes that used to
     precede this were doing the database's work — and doing it outside a
     transaction, where a failure between the fourth and the fifth left an
     account with no sessions and no scopes that could still be seen, edited
     and assigned work. The rows that record what this person did are not
     touched: those columns are `set null`, so the history keeps the note and
     loses only the name. */
  await db.delete(staff).where(eq(staff.id, id));

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    targetType: "staff",
    targetId: String(id),
    targetLabel: existing.name,
    action: "deleted",
    summary: `Deleted staff account ${existing.name} (${existing.email})`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
});

