/* ── Socket authentication ─────────────────────────────────────────────
 * The socket carries the SAME httpOnly session cookie the console uses.
 * No token in a query string (query strings end up in logs, proxies and
 * Referer headers), and no separate socket credential to leak or forget to
 * revoke.
 *
 * This resolves the cookie ONCE, for the handshake. That is not by itself
 * enough: a console left open on a desk holds its socket for a whole
 * shift, so signing out, deactivating the account or narrowing someone's
 * branches would not have touched the feed already streaming to that tab.
 * The header here used to claim it did. The gateway now re-runs this on a
 * timer for every open socket and disconnects the ones that no longer
 * resolve — see REAUTH_INTERVAL_MS in server.ts.
 * ────────────────────────────────────────────────────────────────── */
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions, staff, roles, rolePermissions, locationScopes } from "@/db/schema";

export const COOKIE_NAME = "cleo_session";

export interface SocketUser {
  id: number;
  name: string;
  roleId: string;
  scopeAll: boolean;
  locationIds: number[];
  permissions: string[];
}

/** Parses one cookie out of a raw Cookie header. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/** Resolves a session cookie to a user, or null. Never throws. */
export async function authenticate(cookieHeader: string | undefined): Promise<SocketUser | null> {
  const token = readCookie(cookieHeader, COOKIE_NAME);
  if (!token) return null;

  const id = createHash("sha256").update(token).digest("hex");

  try {
    const [row] = await db
      .select({ staff, roleId: roles.id })
      .from(sessions)
      .innerJoin(staff, eq(staff.id, sessions.staffId))
      .innerJoin(roles, eq(roles.id, staff.roleId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (!row || !row.staff.active) return null;

    const [grants, scopes] = await Promise.all([
      db.select({ id: rolePermissions.permissionId }).from(rolePermissions)
        .where(eq(rolePermissions.roleId, row.staff.roleId)),
      row.staff.scopeAll
        ? Promise.resolve([] as { id: number }[])
        : db.select({ id: locationScopes.locationId }).from(locationScopes)
            .where(eq(locationScopes.staffId, row.staff.id)),
    ]);

    return {
      id: row.staff.id,
      name: row.staff.name,
      roleId: row.staff.roleId,
      scopeAll: row.staff.scopeAll,
      locationIds: scopes.map((s) => s.id),
      permissions: grants.map((g) => g.id),
    };
  } catch {
    return null;
  }
}

export const can = (user: SocketUser, permission: string): boolean =>
  user.roleId === "super_admin" || user.permissions.includes(permission);

export const inScope = (user: SocketUser, locationId: number | null | undefined): boolean =>
  user.scopeAll || user.roleId === "super_admin"
    ? true
    : locationId != null && user.locationIds.includes(locationId);

export const scopeOf = (user: SocketUser): number[] | null =>
  user.scopeAll || user.roleId === "super_admin" ? null : user.locationIds;

/* ── Channel rules ─────────────────────────────────────────────────────
 * One place that decides what a channel name means and who may hear it.
 * A channel the table below does not describe is refused — a typo must
 * not become an open feed.
 * ────────────────────────────────────────────────────────────────── */
export interface ChannelRule {
  permission: string;
  /** Studio the channel belongs to, parsed from its name. */
  locationOf?: (channel: string) => number | null;
  /** Readable without signing in. Only for feeds that carry no personal
   *  data and duplicate something a public endpoint already serves. */
  public?: boolean;
}

const RULES: { match: RegExp; rule: ChannelRule }[] = [
  { match: /^presence$/, rule: { permission: "reports.view" } },
  { match: /^calls:live$/, rule: { permission: "calls.view" } },
  /* Bookings changing under the desk's feet: a customer moving or dropping
     their own slot from /b/{uuid}, and staff confirming one. Events carry a
     locationId, which the gateway re-checks against the subscriber's scope
     on delivery, so a branch manager never sees another branch's. */
  { match: /^appointments:live$/, rule: { permission: "appts.view" } },
  /* One room for every studio's leads, not one room per studio. A super
     admin with 46 branches needed 46 subscriptions and hit the per-socket
     cap, so the live board simply said "too many subscriptions". Each event
     carries its own locationId and the gateway re-checks it against the
     subscriber's scope on delivery, so a branch manager still only ever
     receives their own. */
  { match: /^leads:live$/, rule: { permission: "leads.view" } },
  /* Kept for anything still addressing a single studio directly. */
  {
    match: /^leads:location:(\d+)$/,
    rule: { permission: "leads.view", locationOf: (c) => Number(c.split(":")[2]) },
  },
  { match: /^sms:thread:(\d+)$/, rule: { permission: "sms.view" } },
  { match: /^notifications$/, rule: { permission: "" } }, // any signed-in user

  /* The one channel a visitor on the booking page may hear. It says only
     "something at studio N changed, at this time" — the same facts the
     public availability endpoint already returns — so that two people
     racing for the same slot see it disappear instead of finding out
     after filling in the whole form. No names, no bookings, no ids. */
  {
    match: /^availability:location:(\d+)$/,
    rule: { permission: "", public: true },
  },
];

export function authorizeChannel(
  user: SocketUser | null,
  channel: string,
): { ok: true } | { ok: false; reason: string } {
  const found = RULES.find((r) => r.match.test(channel));
  if (!found) return { ok: false, reason: "unknown channel" };

  /* An anonymous socket gets the public feeds and nothing else — not even
     a channel whose permission happens to be the empty string, which is
     shorthand for "any signed-in user". */
  if (!user) {
    return found.rule.public ? { ok: true } : { ok: false, reason: "sign in required" };
  }

  if (found.rule.permission && !can(user, found.rule.permission)) {
    return { ok: false, reason: `permission required: ${found.rule.permission}` };
  }

  const locationId = found.rule.locationOf?.(channel) ?? null;
  if (locationId !== null && !inScope(user, locationId)) {
    return { ok: false, reason: "studio outside your access" };
  }

  return { ok: true };
}
