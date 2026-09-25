/* ── Staff sessions ────────────────────────────────────────────────────
 * Database-backed, so an admin can revoke a session immediately — a JWT
 * would stay valid until it expired.
 * ────────────────────────────────────────────────────────────────── */
import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { sessions, staff, roles, rolePermissions, locationScopes } from "@/db/schema";

export const COOKIE_NAME = "cleo_session";
const TTL_MS = 12 * 60 * 60 * 1000; // a working day

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  active: boolean;
  scopeAll: boolean;
  locationIds: number[];
  permissions: string[];
  locale: string;
}

/** Cookies hold a random token; only its hash is stored. */
function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(staffId: number, req: Request): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.insert(sessions).values({
    id: tokenHash(token),
    staffId,
    expiresAt,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,                 // unreachable from JavaScript → XSS cannot steal it
    sameSite: "lax",                // blocks cross-site form CSRF
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  await db.update(staff).set({ lastLoginAt: new Date(), lastActiveAt: new Date() }).where(eq(staff.id, staffId));
  return token;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, tokenHash(token)));
  store.delete(COOKIE_NAME);
}

/** Resolves the caller, or null. Expired rows are cleaned up as we go. */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ staff, roleName: roles.name })
    .from(sessions)
    .innerJoin(staff, eq(staff.id, sessions.staffId))
    .innerJoin(roles, eq(roles.id, staff.roleId))
    .where(and(eq(sessions.id, tokenHash(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) return null;
  // A deactivated account must lose access immediately, not at expiry.
  if (!row.staff.active) return null;

  const [grants, scopes] = await Promise.all([
    db.select({ id: rolePermissions.permissionId }).from(rolePermissions).where(eq(rolePermissions.roleId, row.staff.roleId)),
    row.staff.scopeAll
      ? Promise.resolve([])
      : db.select({ id: locationScopes.locationId }).from(locationScopes).where(eq(locationScopes.staffId, row.staff.id)),
  ]);

  return {
    id: row.staff.id,
    name: row.staff.name,
    email: row.staff.email,
    roleId: row.staff.roleId,
    roleName: row.roleName,
    active: row.staff.active,
    scopeAll: row.staff.scopeAll,
    locationIds: scopes.map((s) => s.id),
    permissions: grants.map((g) => g.id),
    locale: row.staff.locale,
  };
}

/** Housekeeping — called opportunistically on login. */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
