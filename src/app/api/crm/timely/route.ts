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
import { TimelySession } from "@/server/timely/client";
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

/* ── One sign-in check, used by everything ────────────────────────────
 * The button, the save and the sync all have to agree about whether an
 * account works. Three copies of "is this password good" is three chances
 * to disagree, so there is one.
 *
 * The password is sealed in memory and handed to a throwaway session: it is
 * never written anywhere unless the check passes, which is the point — a
 * credential we know to be wrong should not be in the database at all.
 */
async function checkSignIn(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const { seal } = await import("@/server/crypto/secretBox");
  const probe = new TimelySession({
    id: 0,
    label: email,
    email,
    passwordEnc: seal(password),
    cookies: {},
  });
  return probe.login();
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
      /* Null until the staff page has been read once. False is the one that
         needs a human: the feed is off at Timely's end, not broken at ours. */
      calendarSyncEnabled: timelyStaff.calendarSyncEnabled,
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
      | "test_account"
      | "test_credentials"
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
    if (!secretsConfigured()) {
      return NextResponse.json(
        { message: "SECRET_KEY is not set — a Timely password cannot be stored safely" },
        { status: 500 },
      );
    }
    if (!password) {
      return NextResponse.json({ message: "A password is required" }, { status: 422 });
    }

    /* Verified BEFORE it is written. An account stored with a password that
       does not work fails every sweep from then on, and the failure turns up
       minutes later in a job log rather than here, in front of whoever typed
       it. Writing it and marking it verified — which is what this did until
       the check went in — is worse still: the sweep gate then believes it. */
    const signIn = await checkSignIn(email, password);
    if (!signIn.ok) {
      return NextResponse.json({ message: signIn.detail }, { status: 422 });
    }
    const passwordEnc = seal(password);

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

    /* The sign-in just succeeded, so record it: that is what lets the sweep
       run without asking again. */
    await db.update(timelyAccounts)
      .set({ lastLoginAt: new Date(), lastError: null })
      .where(eq(timelyAccounts.id, created.id));

    await logAccountChange(user, created.id, label, "created", "sign-in verified");

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
    /* A changed e-mail or password is a changed credential, so it is
       checked before it lands — including an e-mail change on its own,
       which is just as capable of breaking the sweep as a bad password. */
    const newPassword = data.password?.trim();
    const [before] = await db.select().from(timelyAccounts).where(eq(timelyAccounts.id, accId)).limit(1);
    if (!before) return NextResponse.json({ message: "Account not found" }, { status: 404 });

    const emailChanged = Boolean(patch.email && patch.email !== before.email);
    if (newPassword || emailChanged) {
      const { seal, open, secretsConfigured } = await import("@/server/crypto/secretBox");
      if (!secretsConfigured()) {
        return NextResponse.json({ message: "SECRET_KEY is not set" }, { status: 500 });
      }
      const email = (patch.email as string | undefined) ?? before.email;
      const password = newPassword ?? open(before.passwordEnc);
      if (!password) {
        return NextResponse.json({ message: "A password is required" }, { status: 422 });
      }
      const signIn = await checkSignIn(email, password);
      if (!signIn.ok) {
        return NextResponse.json({ message: signIn.detail }, { status: 422 });
      }
      if (newPassword) patch.passwordEnc = seal(newPassword);
      patch.lastLoginAt = new Date();
      patch.lastError = null;
      /* The session belonged to the old credentials. */
      patch.cookies = {};
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

  /* The credentials in the form, before anything is written. */
  if (action === "test_credentials") {
    const data = body.accountData ?? {};
    const email = data.email?.trim().toLowerCase();
    let password = data.password?.trim();

    /* Editing without retyping the password means testing the stored one —
       otherwise the button would only ever work on a fresh entry. */
    if (!password && data.id) {
      const [existing] = await db.select().from(timelyAccounts).where(eq(timelyAccounts.id, Number(data.id))).limit(1);
      const { open } = await import("@/server/crypto/secretBox");
      password = open(existing?.passwordEnc) ?? undefined;
    }

    if (!email || !password) {
      return NextResponse.json({ ok: false, detail: "An e-mail and a password are needed" });
    }

    const started = Date.now();
    const result = await checkSignIn(email, password);
    return NextResponse.json({
      ok: result.ok,
      detail: result.ok ? "Signed in" : result.detail,
      elapsedMs: Date.now() - started,
    });
  }

  /* ── Does this account actually sign in? ─────────────────────────
   * A roster sweep takes minutes and touches every studio and every member
   * of staff. Finding out at the end of it that the password was wrong is a
   * poor way to learn, so this does the sign-in and nothing else, and says
   * what came back. */
  if (action === "test_account") {
    const accId = Number(body.accountId ?? body.accountData?.id);
    if (!Number.isInteger(accId)) {
      return NextResponse.json({ message: "Account ID is required" }, { status: 422 });
    }

    const [acct] = await db.select().from(timelyAccounts).where(eq(timelyAccounts.id, accId)).limit(1);
    if (!acct) return NextResponse.json({ message: "Account not found" }, { status: 404 });

    if (!acct.passwordEnc) {
      return NextResponse.json({
        ok: false,
        detail: "No password stored for this account — edit it and enter one",
      });
    }

    const started = Date.now();
    const session = new TimelySession(acct as never);
    /* login(), not ensureLoggedIn(): a cached cookie answering means the
       LAST password worked, which is not the question being asked. */
    const result = await session.login();
    const elapsedMs = Date.now() - started;

    await db
      .update(timelyAccounts)
      .set({
        lastError: result.ok ? null : result.detail,
        lastLoginAt: result.ok ? new Date() : acct.lastLoginAt,
        updatedAt: new Date(),
      })
      .where(eq(timelyAccounts.id, accId));

    await logAccountChange(user, accId, acct.label, "updated",
      result.ok ? "sign-in tested — ok" : `sign-in tested — ${result.detail}`);

    return NextResponse.json({
      ok: result.ok,
      detail: result.ok ? "Signed in" : result.detail,
      elapsedMs,
    });
  }

  // 4. Trigger Discovery & Roster Sync
  if (action === "sync_roster") {
    /* ── An account that cannot sign in does not sweep ──────────────
     * A sweep on bad credentials is not a no-op: it is a few hundred
     * failed requests at a site that rate-limits and is shared with the
     * studios' own browsers, and it ends by overwriting lastError with the
     * same thing the test already said. */
    const targets = body.accountId
      ? await db.select().from(timelyAccounts).where(eq(timelyAccounts.id, Number(body.accountId)))
      : await db.select().from(timelyAccounts).where(eq(timelyAccounts.active, true));

    const unverified = targets.filter((a) => !a.lastLoginAt || a.lastError);
    if (unverified.length > 0 && unverified.length === targets.length) {
      return NextResponse.json(
        {
          message: unverified.length === 1
            ? `${unverified[0].label} has not signed in successfully — test it first`
            : "None of these accounts has signed in successfully — test them first",
        },
        { status: 409 },
      );
    }

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
