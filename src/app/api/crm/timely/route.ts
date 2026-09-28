import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityLog,
  artists,
  locations,
  timelyAccounts,
  timelyLocations,
  timelyStaff,
} from "@/db/schema";
import { AuthError, can, requireScope, withAuth } from "@/server/auth/guard";
import { syncTimelyRoster } from "@/server/timely/syncRoster";
import { timelySync } from "@/server/jobs/timelySync";

/** Every write here is worth a trail entry; none of them had one. */
async function logAccountChange(
  user: { id: number; name: string; roleId: string },
  accountId: number,
  label: string,
  action: "created" | "updated" | "deleted",
  detail: string,
): Promise<void> {
  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    targetType: "setting",
    targetId: `timely:${accountId}`,
    targetLabel: label,
    action: action === "created" ? "created" : action === "deleted" ? "deleted" : "updated",
    summary: `Timely account ${action} · ${detail}`,
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/crm/timely
 * Returns accounts, locations and staff mappings.
 */
export const GET = withAuth(null, async (user) => {
  /* `settings.view` and `settings.edit` do not exist. The real ids are
     settings.manage, studios.view and studios.edit, and `can()` answers
     false for anything else — so every gate in this file was asking a
     question with no answer. The GET fell through to studios.view, which a
     viewer holds, and handed them the account e-mail addresses. */
  if (!can(user, "settings.manage") && !can(user, "studios.edit")) {
    throw new AuthError(403, "Permission required · studios.edit");
  }

  const accounts = await db
    .select({
      id: timelyAccounts.id,
      label: timelyAccounts.label,
      email: timelyAccounts.email,
      active: timelyAccounts.active,
      lastLoginAt: timelyAccounts.lastLoginAt,
      lastSyncAt: timelyAccounts.lastSyncAt,
      lastError: timelyAccounts.lastError,
    })
    .from(timelyAccounts);

  const locs = await db
    .select({
      id: timelyLocations.id,
      accountId: timelyLocations.accountId,
      accountLabel: timelyAccounts.label,
      timelyId: timelyLocations.timelyId,
      name: timelyLocations.name,
      address: timelyLocations.address,
      slug: timelyLocations.slug,
      slotMinutes: timelyLocations.slotMinutes,
      locationId: timelyLocations.locationId,
      mappedStudioName: locations.name,
      linkedAt: timelyLocations.linkedAt,
      linkedByName: timelyLocations.linkedByName,
      seenAt: timelyLocations.seenAt,
    })
    .from(timelyLocations)
    .innerJoin(timelyAccounts, eq(timelyAccounts.id, timelyLocations.accountId))
    .leftJoin(locations, eq(locations.id, timelyLocations.locationId));

  const staff = await db
    .select({
      id: timelyStaff.id,
      accountId: timelyStaff.accountId,
      accountLabel: timelyAccounts.label,
      timelyId: timelyStaff.timelyId,
      name: timelyStaff.name,
      email: timelyStaff.email,
      status: timelyStaff.status,
      artistId: timelyStaff.artistId,
      mappedArtistName: artists.name,
      hasWebhook: isNotNull(timelyStaff.webhookUrl),
      webhookCheckedAt: timelyStaff.webhookCheckedAt,
      webhookError: timelyStaff.webhookError,
      linkedAt: timelyStaff.linkedAt,
      seenAt: timelyStaff.seenAt,
    })
    .from(timelyStaff)
    .innerJoin(timelyAccounts, eq(timelyAccounts.id, timelyStaff.accountId))
    .leftJoin(artists, eq(artists.id, timelyStaff.artistId));

  return NextResponse.json({ accounts, locations: locs, staff });
});

/**
 * POST /api/crm/timely
 * Dispatches mapping and sync actions.
 */
export const POST = withAuth(null, async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    action?:
      | "map_location"
      | "map_staff"
      | "sync_roster"
      | "sync_appointments"
      | "create_account"
      | "update_account"
      | "delete_account";
    timelyLocationId?: number;
    locationId?: number | null;
    timelyStaffId?: number;
    artistId?: number | null;
    accountId?: number;
    accountData?: {
      id?: number;
      label?: string;
      email?: string;
      password?: string;
      active?: boolean;
    };
  };

  const action = body.action;
  if (!action) {
    return NextResponse.json({ message: "action is required" }, { status: 422 });
  }

  // 1. Manual Studio Mapping
  if (action === "map_location") {
    if (!can(user, "studios.edit") && !can(user, "settings.manage")) {
      throw new AuthError(403, "Permission required · studios.edit");
    }

    const timelyLocId = Number(body.timelyLocationId);
    const locId = body.locationId === null || body.locationId === undefined ? null : Number(body.locationId);

    if (locId) {
      requireScope(user, locId);
    }

    if (!Number.isInteger(timelyLocId)) {
      return NextResponse.json({ message: "timelyLocationId is required" }, { status: 422 });
    }

    const [existing] = await db
      .select()
      .from(timelyLocations)
      .where(eq(timelyLocations.id, timelyLocId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ message: "Timely location not found" }, { status: 404 });
    }

    await db
      .update(timelyLocations)
      .set({
        locationId: locId,
        linkedAt: locId ? new Date() : null,
        linkedByName: locId ? user.name : null,
      })
      .where(eq(timelyLocations.id, timelyLocId));

    return NextResponse.json({ ok: true, timelyLocationId: timelyLocId, locationId: locId });
  }

  // 2. Manual Staff / Artist Mapping
  if (action === "map_staff") {
    if (!can(user, "staff.manage") && !can(user, "studios.edit") && !can(user, "settings.manage")) {
      throw new AuthError(403, "Permission required · staff.manage");
    }

    const timelyStaffId = Number(body.timelyStaffId);
    const artistId = body.artistId === null || body.artistId === undefined ? null : Number(body.artistId);

    if (!Number.isInteger(timelyStaffId)) {
      return NextResponse.json({ message: "timelyStaffId is required" }, { status: 422 });
    }

    const [existingStaff] = await db
      .select()
      .from(timelyStaff)
      .where(eq(timelyStaff.id, timelyStaffId))
      .limit(1);

    if (!existingStaff) {
      return NextResponse.json({ message: "Timely staff member not found" }, { status: 404 });
    }

    await db
      .update(timelyStaff)
      .set({
        artistId,
        linkedAt: artistId ? new Date() : null,
      })
      .where(eq(timelyStaff.id, timelyStaffId));

    // If linked to an artist and we have a webhookUrl, also attach it to the artist
    if (artistId && existingStaff.webhookUrl) {
      await db
        .update(artists)
        .set({ calendarFeedUrl: existingStaff.webhookUrl, feedError: null })
        .where(eq(artists.id, artistId));
    }

    return NextResponse.json({ ok: true, timelyStaffId, artistId });
  }

  // From here on: Settings / Multi-Account Administration actions
  /* Adding a Timely account means storing a password that we replay at
     their login form. That is the owner's decision, not a branch manager's. */
  if (!can(user, "settings.manage")) {
    throw new AuthError(403, "Permission required · settings.manage");
  }

  // 3. Timely Accounts Management (Create, Update, Delete, Toggle)
  if (action === "create_account") {
    const data = body.accountData ?? {};
    const label = data.label?.trim();
    const email = data.email?.trim().toLowerCase();
    const password = data.password?.trim();

    if (!label || !email) {
      return NextResponse.json({ message: "Label and email are required" }, { status: 422 });
    }

    const { seal, secretsConfigured } = await import("@/server/crypto/secretBox");
    const passwordEnc = password && secretsConfigured() ? seal(password) : null;

    /* Selected, not `returning()`. The whole row carries passwordEnc, and
       sealed or not that is material which has no business leaving the
       server — the browser cannot use it and cannot protect it. */
    const [created] = await db
      .insert(timelyAccounts)
      .values({
        label,
        email,
        passwordEnc,
        active: data.active ?? true,
      })
      .returning({
        id: timelyAccounts.id,
        label: timelyAccounts.label,
        email: timelyAccounts.email,
        active: timelyAccounts.active,
      });

    await logAccountChange(user, created.id, label, "created",
      passwordEnc ? "with a password" : "without a password — sync cannot sign in");

    return NextResponse.json({ ok: true, account: created });
  }

  if (action === "update_account") {
    const data = body.accountData ?? {};
    const accId = Number(data.id ?? body.accountId);
    if (!Number.isInteger(accId)) {
      return NextResponse.json({ message: "Account ID is required" }, { status: 422 });
    }

    const patch: Partial<typeof timelyAccounts.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (data.label) patch.label = data.label.trim();
    if (data.email) patch.email = data.email.trim().toLowerCase();
    if (data.active !== undefined) patch.active = Boolean(data.active);
    if (data.password && data.password.trim()) {
      const { seal, secretsConfigured } = await import("@/server/crypto/secretBox");
      if (secretsConfigured()) {
        patch.passwordEnc = seal(data.password.trim());
      }
    }

    const [updated] = await db
      .update(timelyAccounts)
      .set(patch)
      .where(eq(timelyAccounts.id, accId))
      .returning({
        id: timelyAccounts.id,
        label: timelyAccounts.label,
        email: timelyAccounts.email,
        active: timelyAccounts.active,
      });

    if (!updated) {
      return NextResponse.json({ message: "Account not found" }, { status: 404 });
    }

    /* Which fields moved, never their values — an audit trail is the last
       place a password should become searchable. */
    await logAccountChange(user, accId, updated.label, "updated",
      Object.keys(patch).filter((k) => k !== "updatedAt").map((k) => (k === "passwordEnc" ? "password" : k)).join(", "));

    return NextResponse.json({ ok: true, account: updated });
  }

  if (action === "delete_account") {
    const accId = Number(body.accountId ?? body.accountData?.id);
    if (!Number.isInteger(accId)) {
      return NextResponse.json({ message: "Account ID is required" }, { status: 422 });
    }

    /* Read first, so the trail can name what went. Deleting cascades to
       that account's studios, staff and their mappings — every link anyone
       made by hand goes with it. */
    const [doomed] = await db
      .select({ label: timelyAccounts.label, email: timelyAccounts.email })
      .from(timelyAccounts)
      .where(eq(timelyAccounts.id, accId))
      .limit(1);

    if (!doomed) {
      return NextResponse.json({ message: "Account not found" }, { status: 404 });
    }

    await db.delete(timelyAccounts).where(eq(timelyAccounts.id, accId));
    await logAccountChange(user, accId, doomed.label, "deleted", doomed.email);

    return NextResponse.json({ ok: true, deletedId: accId });
  }

  // 4. Trigger Discovery & Roster Sync
  if (action === "sync_roster") {
    const results = await syncTimelyRoster(body.accountId ? Number(body.accountId) : undefined);
    return NextResponse.json({ ok: true, results });
  }

  // 5. Trigger Appointments Sync
  if (action === "sync_appointments") {
    const res = await timelySync.run();
    return NextResponse.json({ ok: true, result: res });
  }

  return NextResponse.json({ message: "Unsupported action" }, { status: 422 });
});
