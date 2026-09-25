/* ── Server-side authorisation ─────────────────────────────────────────
 * The console already hides buttons a role may not use, but that is
 * cosmetic: anyone can call the API directly. Permission and branch scope
 * are decided here, on the server, for every request.
 * ────────────────────────────────────────────────────────────────── */
import { NextResponse } from "next/server";
import { currentUser, type SessionUser } from "./session";

export class AuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
  }
}

/** super_admin holds every permission implicitly, present in the table or not. */
export function can(user: SessionUser, permission: string): boolean {
  return user.roleId === "super_admin" || user.permissions.includes(permission);
}

/** Is this studio inside the user's branch scope? */
export function inScope(user: SessionUser, locationId: number | null | undefined): boolean {
  if (user.scopeAll || user.roleId === "super_admin") return true;
  if (locationId == null) return false;
  return user.locationIds.includes(locationId);
}

/**
 * The studios this user may read, as a list.
 * `null` means "no restriction" — do not turn that into an empty IN ().
 */
export function scopeFilter(user: SessionUser): number[] | null {
  return user.scopeAll || user.roleId === "super_admin" ? null : user.locationIds;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthError(401, "Sign in required");
  return user;
}

export async function requirePermission(permission: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) throw new AuthError(403, `Permission required · ${permission}`);
  return user;
}

export function requireScope(user: SessionUser, locationId: number | null | undefined): void {
  if (!inScope(user, locationId)) throw new AuthError(403, "This studio is outside your access");
}

/** Wraps a route handler so auth failures become clean JSON responses. */
export function withAuth<A extends unknown[]>(
  permission: string | null,
  handler: (user: SessionUser, ...args: A) => Promise<NextResponse>,
) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      const user = permission ? await requirePermission(permission) : await requireUser();
      return await handler(user, ...args);
    } catch (err) {
      if (err instanceof AuthError) {
        return NextResponse.json({ message: err.message }, { status: err.status });
      }
      console.error("route failed:", err);
      return NextResponse.json({ message: "Internal error" }, { status: 500 });
    }
  };
}
