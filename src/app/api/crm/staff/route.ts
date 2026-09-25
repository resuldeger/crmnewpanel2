import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, locationScopes, roles, staff } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Staff accounts ────────────────────────────────────────────────────
 * Editing a colleague — their role, their branch access, whether they are
 * still active — only changed React state. A revoked account stayed able to
 * sign in, which is the one failure here that actually matters.
 *
 * Passwords are never set or returned through this route. A new account is
 * created without one and cannot sign in until a password is issued out of
 * band, so nobody is given a guessable default.
 * ────────────────────────────────────────────────────────────────── */

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

export const PATCH = withAuth("staff.manage", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    id?: number;
    name?: string;
    email?: string;
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

  /* Locking yourself out, or removing the last super admin, leaves nobody
     who can undo it. */
  if (body.active === false && id === user.id) {
    return NextResponse.json({ message: "You cannot deactivate your own account" }, { status: 409 });
  }
  if ((body.active === false || (body.role_id && body.role_id !== "super_admin")) && existing.roleId === "super_admin") {
    const others = await db
      .select({ id: staff.id })
      .from(staff)
      .where(eq(staff.roleId, "super_admin"));
    const remaining = others.filter((s) => s.id !== id && s.id !== undefined);
    if (remaining.length === 0) {
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
      await db.delete(locationScopes).where(eq(locationScopes.staffId, id));
      if (wanted.length > 0) {
        await db.insert(locationScopes).values(wanted.map((locationId) => ({ staffId: id, locationId })));
      }
      diff.locationIds = [currentIds, wanted];
    }
  }

  /* Every exit from here strips the hash — the no-change branch used to
     return the raw row, so asking for a no-op edit handed the caller the
     account's password hash. */
  const withoutHash = (row: typeof existing) => {
    const { passwordHash: _h, ...rest } = row;
    void _h;
    return rest;
  };

  if (Object.keys(diff).length === 0) {
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

  // Never leak the hash, even to an admin.
  return NextResponse.json({ staff: withoutHash(updated), changed: true });
});
