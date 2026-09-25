import { NextResponse } from "next/server";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  locations, roles, permissions, rolePermissions, staff, locationScopes,
  leads, appointments, smsConversations, tasks, numbers, artists, artistLocations,
} from "@/db/schema";
import { withAuth, scopeFilter, can } from "@/server/auth/guard";
import { safeStudio } from "@/server/crm/mask";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Everything the console needs on load, in one round trip: the studios this
 * user may see, the RBAC tables, and the sidebar badge counts — all already
 * narrowed to the user's branch scope.
 */
export const GET = withAuth(null, async (user) => {
  const scope = scopeFilter(user);
  const scoped = <T extends { locationId: unknown }>(col: T["locationId"]) =>
    scope ? inArray(col as never, scope) : undefined;

  const [studioRows, roleRows, permRows, grantRows, numberRows, artistRows, artistLinks] = await Promise.all([
    db.select().from(locations)
      .where(scope ? inArray(locations.id, scope) : undefined)
      .orderBy(asc(locations.displayOrder), asc(locations.name)),
    db.select().from(roles).orderBy(asc(roles.sortOrder)),
    db.select().from(permissions).orderBy(asc(permissions.sortOrder)),
    db.select().from(rolePermissions),
    db.select().from(numbers).where(scope ? inArray(numbers.locationId, scope) : undefined),
    db.select().from(artists).orderBy(asc(artists.name)),
    db.select().from(artistLocations),
  ]);

  // The team list is staff-view only; everyone else gets just themselves.
  const staffRows = can(user, "staff.view")
    ? await db.select({
        id: staff.id, name: staff.name, email: staff.email, roleId: staff.roleId,
        scopeAll: staff.scopeAll, active: staff.active, lastActiveAt: staff.lastActiveAt,
      }).from(staff).orderBy(asc(staff.name))
    : [];

  const scopeRows = staffRows.length
    ? await db.select().from(locationScopes)
    : await db.select().from(locationScopes).where(eq(locationScopes.staffId, user.id));

  const [notCalled, pending, unread, openTasks] = await Promise.all([
    db.select({ n: count() }).from(leads)
      .where(and(eq(leads.callStatus, "not_called"), isNull(leads.mergedInto), isNull(leads.convertedAt), scoped(leads.locationId))),
    db.select({ n: count() }).from(appointments)
      .where(and(eq(appointments.status, "pending"), scoped(appointments.locationId))),
    db.select({ n: sql<number>`coalesce(sum(${smsConversations.unreadCount}), 0)::int` }).from(smsConversations)
      .where(scoped(smsConversations.locationId)),
    db.select({ n: count() }).from(tasks)
      .where(and(eq(tasks.status, "open"), scoped(tasks.locationId))),
  ]);

  const matrix: Record<string, string[]> = {};
  for (const g of grantRows) (matrix[g.roleId] ??= []).push(g.permissionId);

  return NextResponse.json(
    {
      user,
      // Masked: these rows carry live Twilio tokens and SMTP passwords.
      studios: studioRows.map(safeStudio),
      roles: roleRows,
      permissions: permRows,
      matrix,
      staff: staffRows.map((s) => ({
        ...s,
        locationIds: s.scopeAll ? "all" : scopeRows.filter((r) => r.staffId === s.id).map((r) => r.locationId),
      })),
      numbers: numberRows,
      artists: artistRows.map((a) => ({
        ...a,
        locationIds: artistLinks.filter((l) => l.artistId === a.id).map((l) => l.locationId),
      })),
      counters: {
        notCalledLeads: notCalled[0]?.n ?? 0,
        pendingAppointments: pending[0]?.n ?? 0,
        unreadSms: unread[0]?.n ?? 0,
        openTasks: openTasks[0]?.n ?? 0,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
