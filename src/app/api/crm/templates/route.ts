import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, messageTemplates } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { segmentCount } from "@/server/sms/templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Message templates ─────────────────────────────────────────────────
 * Every template carries all four languages. The console used to hold its
 * own hardcoded, English-only list, so an operator choosing "Booking
 * Confirmation" for a customer whose whole funnel had been in Turkish sent
 * them English — the one place the language has to follow the person.
 *
 * Read here with every translation, so the compose box can show the body
 * in the recipient's own language before it is sent.
 * ────────────────────────────────────────────────────────────────── */

export const GET = withAuth("sms.view", async () => {
  const rows = await db.select().from(messageTemplates).where(eq(messageTemplates.isActive, true));

  return NextResponse.json({
    templates: rows.map((r) => ({
      id: r.id,
      key: r.key,
      channel: r.channel,
      locationId: r.locationId,
      bodies: r.bodyTranslations as Record<string, string>,
      mergeFields: r.mergeFields,
    })),
  });
});

export const PATCH = withAuth("sms.campaign", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    key?: string;
    location_id?: number | null;
    bodies?: Record<string, string>;
  };

  const key = String(body.key ?? "").trim();
  if (!key) return NextResponse.json({ message: "Which template?" }, { status: 422 });

  const bodies = body.bodies ?? {};
  const locales = Object.keys(bodies);
  if (locales.length === 0) {
    return NextResponse.json({ message: "Nothing to save" }, { status: 422 });
  }

  /* English is the fallback every other language falls back TO, so losing
     it would leave a recipient whose language is not translated with no
     message at all. */
  if (!bodies.en?.trim()) {
    return NextResponse.json({ message: "The English wording is the fallback and cannot be empty" }, { status: 422 });
  }

  for (const [locale, text] of Object.entries(bodies)) {
    if (!text.trim()) {
      return NextResponse.json({ message: `${locale}: the wording is empty` }, { status: 422 });
    }
    /* Carriers bill per segment and split long messages. Telling the
       operator here beats discovering it on the invoice. */
    const segments = segmentCount(text);
    if (segments > 4) {
      return NextResponse.json(
        { message: `${locale}: ${segments} SMS segments — shorten it to 4 or fewer` },
        { status: 422 },
      );
    }
  }

  const locationId = body.location_id ?? null;
  if (locationId !== null) requireScope(user, locationId);

  const [existing] = await db
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.key, key),
        locationId === null
          ? isNull(messageTemplates.locationId)
          : eq(messageTemplates.locationId, locationId),
      ),
    )
    .limit(1);

  let saved;
  if (existing) {
    // Merge: editing Turkish must not drop the other three.
    const merged = { ...(existing.bodyTranslations as Record<string, string>), ...bodies };
    [saved] = await db
      .update(messageTemplates)
      .set({ bodyTranslations: merged, updatedAt: new Date() })
      .where(eq(messageTemplates.id, existing.id))
      .returning();
  } else {
    [saved] = await db
      .insert(messageTemplates)
      .values({
        key,
        channel: "sms",
        locationId,
        bodyTranslations: bodies,
        subjectTranslations: {},
        mergeFields: [],
        isActive: true,
      })
      .returning();
  }

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId,
    targetType: "translation",
    targetId: key,
    targetLabel: key,
    action: "updated",
    summary: `Template ${key} edited (${locales.join(", ")})`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ template: saved });
});
