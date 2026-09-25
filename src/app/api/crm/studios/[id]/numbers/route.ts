import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, locations, numbers } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { bustDictionary } from "@/server/booking/dictionary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── A studio's phone numbers ──────────────────────────────────────────
 * Three kinds, and they are not interchangeable:
 *   branch — the shop's own line, what a customer is forwarded to
 *   twilio — the number SMS goes out from, and the one whose inbound call
 *            webhook forwards to the branch line
 *   vonage — the desk extension calls are placed from
 * These drove real routing and lived only in React state, so a number
 * added in the console never reached the webhook that needed it.
 * ────────────────────────────────────────────────────────────────── */

type Ctx = { params: Promise<{ id: string }> };

const KINDS = ["vonage", "twilio", "branch"] as const;
type Kind = (typeof KINDS)[number];

/** E.164: a plus, a non-zero country digit, up to 14 more. */
const E164 = /^\+[1-9]\d{6,14}$/;

type Studio = typeof locations.$inferSelect;
type Resolved = { studio: Studio; error?: undefined } | { studio?: undefined; error: NextResponse };

async function studioOf(user: Parameters<typeof requireScope>[0], id: string): Promise<Resolved> {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return { error: NextResponse.json({ message: "Bad studio id" }, { status: 400 }) };
  }
  const [studio] = await db.select().from(locations).where(eq(locations.id, numericId)).limit(1);
  if (!studio) return { error: NextResponse.json({ message: "Studio not found" }, { status: 404 }) };
  requireScope(user, studio.id);
  return { studio };
}

export const GET = withAuth("studios.view", async (user, _req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const found = await studioOf(user, id);
  if (found.error) return found.error;

  const rows = await db.select().from(numbers).where(eq(numbers.locationId, found.studio.id));
  return NextResponse.json({ numbers: rows });
});

export const POST = withAuth("studios.edit", async (user, req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const found = await studioOf(user, id);
  if (found.error) return found.error;
  const studio = found.studio;

  const body = (await req.json().catch(() => ({}))) as {
    id?: number;
    kind?: string;
    label?: string;
    number?: string;
    sms_capable?: boolean;
  };

  const kind = String(body.kind ?? "");
  if (!KINDS.includes(kind as Kind)) {
    return NextResponse.json({ message: `Kind must be one of: ${KINDS.join(", ")}` }, { status: 422 });
  }

  // Normalise before validating: operators paste "+1 (253) 555-0100".
  const raw = String(body.number ?? "").trim();
  const e164 = raw.startsWith("+") ? "+" + raw.slice(1).replace(/\D/g, "") : "+" + raw.replace(/\D/g, "");
  if (!E164.test(e164)) {
    return NextResponse.json(
      { message: "Number must be in international format, e.g. +12535550100" },
      { status: 422 },
    );
  }

  // A branch line cannot send SMS, and claiming it can would queue messages
  // against a number Twilio will reject.
  const smsCapable = kind === "branch" ? false : body.sms_capable === true;
  const label = String(body.label ?? "").trim().slice(0, 80) || kind;

  /* The same number on two studios means an inbound call forwards to the
     wrong shop, so it is rejected outright rather than silently shadowed. */
  const clash = await db
    .select({ id: numbers.id, locationId: numbers.locationId })
    .from(numbers)
    .where(eq(numbers.numberE164, e164))
    .limit(1);
  if (clash.length > 0 && clash[0].id !== body.id) {
    const message =
      clash[0].locationId === studio.id
        ? "This studio already has that number"
        : "Another studio already uses that number";
    return NextResponse.json({ message }, { status: 409 });
  }

  const values = {
    locationId: studio.id,
    kind: kind as Kind,
    label,
    numberE164: e164,
    smsCapable,
  };

  let row;
  if (body.id && body.id > 0) {
    const [existing] = await db.select().from(numbers).where(eq(numbers.id, body.id)).limit(1);
    if (!existing) return NextResponse.json({ message: "Number not found" }, { status: 404 });
    requireScope(user, existing.locationId);
    [row] = await db.update(numbers).set(values).where(eq(numbers.id, body.id)).returning();
  } else {
    [row] = await db.insert(numbers).values(values).returning();
  }

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: studio.id,
    targetType: "location",
    targetId: String(studio.id),
    targetLabel: studio.name,
    action: body.id ? "updated" : "created",
    toValue: `${kind} ${e164}`,
    summary: `${body.id ? "Updated" : "Added"} ${kind} number ${e164}`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  await bustDictionary();
  return NextResponse.json({ number: row }, { status: body.id ? 200 : 201 });
});

export const DELETE = withAuth("studios.edit", async (user, req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const found = await studioOf(user, id);
  if (found.error) return found.error;

  const numberId = Number(new URL(req.url).searchParams.get("number_id"));
  if (!Number.isInteger(numberId)) {
    return NextResponse.json({ message: "Missing number_id" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(numbers)
    .where(and(eq(numbers.id, numberId), eq(numbers.locationId, found.studio.id)))
    .limit(1);
  if (!existing) return NextResponse.json({ message: "Number not found" }, { status: 404 });

  await db.delete(numbers).where(eq(numbers.id, numberId));

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: found.studio.id,
    targetType: "location",
    targetId: String(found.studio.id),
    targetLabel: found.studio.name,
    action: "deleted",
    fromValue: `${existing.kind} ${existing.numberE164}`,
    summary: `Removed ${existing.kind} number ${existing.numberE164}`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  await bustDictionary();
  return NextResponse.json({ ok: true });
});
