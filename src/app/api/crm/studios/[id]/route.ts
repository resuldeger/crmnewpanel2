import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, locations } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { bustDictionary } from "@/server/booking/dictionary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Studio settings ───────────────────────────────────────────────────
 * The Studios screen showed "saved" and changed nothing: saveStudio() only
 * touched React state, so a maps link, a timezone or a booking rule was
 * gone on the next reload. Everything the booking engine reads per studio
 * comes from this table, so this is the write side of it.
 * ────────────────────────────────────────────────────────────────── */

type Ctx = { params: Promise<{ id: string }> };

/** Only fields the console is allowed to set. Secrets are handled elsewhere. */
interface StudioPatch {
  name?: string;
  slug?: string;
  address?: string;
  city?: string;
  country?: string;
  branch_phone?: string | null;
  email?: string | null;
  maps_url?: string | null;
  timezone?: string;
  booking_active?: boolean;
  booking_interval_min?: number;
  max_booking_days_ahead?: number;
  same_day_lead_hours?: number;
  slot_capacity?: number;
  gtm_country?: string | null;
  gtm_city_state?: string | null;
  lat?: number | null;
  lng?: number | null;
  display_order?: number;
  image_url?: string | null;
  hours?: Record<string, { enabled?: boolean; open?: string; close?: string }>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTP_URL = /^https?:\/\//i;

export const PATCH = withAuth("studios.edit", async (user, req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return NextResponse.json({ message: "Bad studio id" }, { status: 400 });
  }

  const [existing] = await db.select().from(locations).where(eq(locations.id, numericId)).limit(1);
  if (!existing) return NextResponse.json({ message: "Studio not found" }, { status: 404 });
  requireScope(user, existing.id);

  const body = (await req.json().catch(() => ({}))) as StudioPatch;
  const patch: Record<string, unknown> = {};
  const diff: Record<string, [unknown, unknown]> = {};

  const setIf = <T,>(key: keyof typeof locations.$inferSelect, next: T | undefined) => {
    if (next === undefined) return;
    const before = (existing as Record<string, unknown>)[key as string];
    if (before === next) return;
    patch[key as string] = next;
    diff[key as string] = [before, next];
  };

  if (body.image_url !== undefined) {
    setIf("imageUrl", body.image_url);
  }

  if (body.slug !== undefined) {
    const slug = body.slug.trim().toLowerCase();
    // The slug is the public booking URL; a bad one 404s the studio's page.
    if (!SLUG.test(slug)) {
      return NextResponse.json({ message: "Slug must be lowercase words joined by hyphens" }, { status: 422 });
    }
    const clash = await db.select({ id: locations.id }).from(locations).where(eq(locations.slug, slug)).limit(1);
    if (clash.length > 0 && clash[0].id !== numericId) {
      return NextResponse.json({ message: "Another studio already uses that slug" }, { status: 409 });
    }
    setIf("slug", slug);
  }

  if (body.maps_url !== undefined) {
    const url = (body.maps_url ?? "").trim();
    // Stored as given and opened in a new tab, so anything but http(s)
    // (javascript:, data:) must not get in.
    if (url && !HTTP_URL.test(url)) {
      return NextResponse.json({ message: "Maps URL must start with http:// or https://" }, { status: 422 });
    }
    setIf("mapsUrl", url || null);
  }

  if (body.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: body.timezone });
    } catch {
      return NextResponse.json({ message: `Unknown timezone: ${body.timezone}` }, { status: 422 });
    }
    setIf("timezone", body.timezone);
  }

  const posInt = (v: number | undefined, min: number, max: number, label: string) => {
    if (v === undefined) return { ok: true as const };
    if (!Number.isInteger(v) || v < min || v > max) {
      return { ok: false as const, message: `${label} must be a whole number between ${min} and ${max}` };
    }
    return { ok: true as const };
  };

  for (const [value, min, max, label, column] of [
    [body.booking_interval_min, 5, 240, "Booking interval", "bookingIntervalMin"],
    [body.max_booking_days_ahead, 1, 365, "Booking horizon", "maxBookingDaysAhead"],
    [body.same_day_lead_hours, 0, 72, "Same-day notice", "sameDayLeadHours"],
    [body.slot_capacity, 1, 12, "Slot capacity", "slotCapacity"],
    [body.display_order, 0, 9999, "Display order", "displayOrder"],
  ] as const) {
    const check = posInt(value, min, max, label);
    if (!check.ok) return NextResponse.json({ message: check.message }, { status: 422 });
    setIf(column as keyof typeof locations.$inferSelect, value);
  }

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length < 2) return NextResponse.json({ message: "Name is too short" }, { status: 422 });
    setIf("name", name);
  }

  setIf("address", body.address?.trim());
  setIf("city", body.city?.trim());
  setIf("countryCode", body.country?.trim().toUpperCase());
  setIf("branchPhone", body.branch_phone === undefined ? undefined : body.branch_phone?.trim() || null);
  setIf("email", body.email === undefined ? undefined : body.email?.trim() || null);
  setIf("bookingActive", body.booking_active);
  setIf("gtmCountry", body.gtm_country === undefined ? undefined : body.gtm_country?.trim() || null);
  setIf("gtmCityState", body.gtm_city_state === undefined ? undefined : body.gtm_city_state?.trim() || null);
  setIf("lat", body.lat === undefined ? undefined : body.lat === null ? null : String(body.lat));
  setIf("lng", body.lng === undefined ? undefined : body.lng === null ? null : String(body.lng));

  if (body.hours !== undefined) {
    /* Stored under the three-letter keys the availability engine looks up
       (dayKey() returns "mon"…). A long-form key would silently close the
       studio for that day, because the lookup would miss. */
    const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
    /* Merged onto what is stored, never replacing it: a caller sending only
       the day it changed would otherwise wipe the other six and close the
       studio for the rest of the week. */
    const next: Record<string, { enabled: boolean; open: string; close: string }> = {
      ...((existing.hours ?? {}) as Record<string, { enabled: boolean; open: string; close: string }>),
    };
    for (const [rawKey, value] of Object.entries(body.hours)) {
      const key = rawKey.slice(0, 3).toLowerCase();
      if (!(DAYS as readonly string[]).includes(key)) {
        return NextResponse.json({ message: `Unknown day: ${rawKey}` }, { status: 422 });
      }
      const current = next[key];
      const open = value?.open ?? current?.open ?? "10:00";
      const close = value?.close ?? current?.close ?? "19:00";
      if (!HHMM.test(open) || !HHMM.test(close)) {
        return NextResponse.json({ message: `${rawKey}: times must be HH:MM` }, { status: 422 });
      }
      if (value?.enabled && close <= open) {
        return NextResponse.json({ message: `${rawKey}: closing time must be after opening` }, { status: 422 });
      }
      next[key] = { enabled: value?.enabled ?? current?.enabled ?? false, open, close };
    }
    if (JSON.stringify(next) !== JSON.stringify(existing.hours)) {
      patch.hours = next;
      diff.hours = [existing.hours, next];
    }
  }

  if (Object.keys(diff).length === 0) {
    return NextResponse.json({ studio: existing, changed: false });
  }

  patch.updatedAt = new Date();
  const [updated] = await db
    .update(locations)
    .set(patch)
    .where(eq(locations.id, numericId))
    .returning();

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: numericId,
    targetType: "location",
    targetId: String(numericId),
    targetLabel: existing.name,
    action: "updated",
    diff,
    summary: `Updated ${Object.keys(diff).join(", ")}`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  // The public booking config is cached per studio; a stale cache would
  // keep serving the old slug, hours or timezone for the full TTL.
  await bustDictionary();

  return NextResponse.json({ studio: updated, changed: true });
});
