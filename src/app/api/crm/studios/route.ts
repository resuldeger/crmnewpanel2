import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, locations } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";
import { bustDictionary } from "@/server/booking/dictionary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Opening a branch ──────────────────────────────────────────────────
 * The console could edit a studio but not create one, so a new branch had
 * to be inserted by hand in SQL — which meant the timezone, the booking
 * rules and the slug were whatever somebody typed at the time.
 *
 * A studio is created CLOSED: booking_active is false regardless of what
 * was asked for. A branch with no phone number, no opening hours and no
 * Twilio sender that is immediately live on the public site takes real
 * bookings it cannot service. The Studios screen turns it on once it is
 * actually ready.
 * ────────────────────────────────────────────────────────────────── */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Mon–Sat 10:00–19:00, closed Sunday. A starting point, not a guess to keep. */
const DEFAULT_HOURS = {
  mon: { enabled: true, open: "10:00", close: "19:00" },
  tue: { enabled: true, open: "10:00", close: "19:00" },
  wed: { enabled: true, open: "10:00", close: "19:00" },
  thu: { enabled: true, open: "10:00", close: "19:00" },
  fri: { enabled: true, open: "10:00", close: "19:00" },
  sat: { enabled: true, open: "10:00", close: "19:00" },
  sun: { enabled: false, open: "12:00", close: "18:00" },
};

export const POST = withAuth("studios.edit", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    slug?: string;
    city?: string;
    country?: string;
    country_code?: string;
    address?: string;
    timezone?: string;
    branch_phone?: string | null;
    email?: string | null;
  };

  /* Creating a branch is a chain-wide act. A manager scoped to one studio
     can edit theirs but must not be able to add another. */
  if (!user.scopeAll) {
    return NextResponse.json(
      { message: "Only an account with access to every studio can open a new one" },
      { status: 403 },
    );
  }

  const name = String(body.name ?? "").trim();
  const city = String(body.city ?? "").trim();
  if (name.length < 2) return NextResponse.json({ message: "Name is too short" }, { status: 422 });
  if (city.length < 2) return NextResponse.json({ message: "City is required" }, { status: 422 });

  /* The slug is the public booking URL and cannot be changed casually once
     ads point at it, so it is validated hard at birth. */
  const slug = String(body.slug ?? "")
    .trim()
    .toLowerCase()
    || name.toLowerCase().replace(/^cleopatra ink\s*/i, "").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  if (!SLUG.test(slug)) {
    return NextResponse.json(
      { message: "Slug must be lowercase words joined by hyphens" },
      { status: 422 },
    );
  }

  const clash = await db.select({ id: locations.id }).from(locations).where(eq(locations.slug, slug)).limit(1);
  if (clash.length > 0) {
    return NextResponse.json({ message: `A studio already uses /${slug}` }, { status: 409 });
  }

  /* A wrong timezone is the one mistake here that silently books customers
     at the wrong hour, so it must be named and valid — no default. */
  const timezone = String(body.timezone ?? "").trim();
  if (!timezone) {
    return NextResponse.json({ message: "Pick the studio's timezone" }, { status: 422 });
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    return NextResponse.json({ message: `Unknown timezone: ${timezone}` }, { status: 422 });
  }

  const [created] = await db
    .insert(locations)
    .values({
      name: name.startsWith("Cleopatra Ink") ? name : `Cleopatra Ink ${name}`,
      slug,
      city,
      country: String(body.country ?? "USA").trim(),
      countryCode: String(body.country_code ?? "US").trim().toUpperCase().slice(0, 2),
      address: body.address?.trim() || null,
      timezone,
      branchPhone: body.branch_phone?.trim() || null,
      email: body.email?.trim() || null,
      hours: DEFAULT_HOURS,
      // Closed until somebody says otherwise. See the note at the top.
      bookingActive: false,
    })
    .returning();

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: created.id,
    targetType: "location",
    targetId: String(created.id),
    targetLabel: created.name,
    action: "created",
    toValue: slug,
    summary: `Studio created (${timezone}), not yet taking bookings`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  await bustDictionary();

  return NextResponse.json({ studio: created }, { status: 201 });
});
