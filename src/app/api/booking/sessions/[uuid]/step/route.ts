import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { bookingSessions } from "@/db/schema";
import { clientIp } from "@/server/booking/attribution";
import { allow } from "@/server/redis";
import { checkPhone } from "@/server/booking/phone";
import { scheduleLeadRecovery } from "@/server/sms/schedule";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Wizard step index → the enum stored on the session. */
const STEP_BY_INDEX = [
  "welcome", "purpose", "style", "story", "body_area",
  "size", "timing", "contact", "success", "address",
] as const;

/**
 * Records progress and, once there is a usable phone or email, promotes the
 * session to a LEAD via capture_lead(). That function is idempotent, so the
 * debounced calls from the client update one lead instead of creating many.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params;
  if (!UUID.test(uuid)) return NextResponse.json({ message: "Bad session id" }, { status: 400 });

  const ip = clientIp(req.headers) ?? "unknown";
  if (!(await allow("session:step", ip, 240, 60))) {
    return NextResponse.json({ message: "Too many requests" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    step?: string;
    form_data?: Record<string, unknown>;
    landing_url?: string;
    locale?: string;
    _it?: boolean;
  };

  const index = Number(body.step ?? 0);
  const stepKey = STEP_BY_INDEX[index] ?? "welcome";
  const form = body.form_data ?? {};

  /* Validated here too, not only at booking: this is what creates the
     lead and starts the recovery SMS chase. An unreachable number becomes
     a lead the desk rings for days and a message billed every time. */
  const rawPhone = typeof form.phone === "string" ? form.phone : "";
  const phoneCheck = rawPhone ? checkPhone(rawPhone) : null;
  const phone = phoneCheck?.ok ? phoneCheck.e164! : null;
  const email = typeof form.email === "string" && form.email.includes("@") ? form.email : null;
  const fullName = typeof form.full_name === "string" && form.full_name.length >= 2 ? form.full_name : null;

  const [session] = await db
    .update(bookingSessions)
    .set({
      currentStep: stepKey,
      currentStepIndex: index,
      stepData: form,
      // never overwrite a captured value with null — a visitor stepping
      // backwards would otherwise erase their own contact details
      ...(fullName ? { fullName } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phoneE164: phone } : {}),
      ...(typeof form.sms_consent === "boolean" ? { smsConsent: form.sms_consent } : {}),
      ...(body.landing_url ? { landingUrl: body.landing_url } : {}),
      // The visitor can switch language mid-funnel; the recovery SMS must
      // follow them, not the language they started in.
      ...(body.locale ? { locale: body.locale.slice(0, 2) } : {}),
      isTrusted: body._it !== false,
      updatedAt: new Date(),
    })
    .where(eq(bookingSessions.sessionUuid, uuid))
    .returning({ id: bookingSessions.id, isCompleted: bookingSessions.isCompleted });

  if (!session) return NextResponse.json({ message: "Unknown session" }, { status: 404 });

  let leadId: string | null = null;
  if (!session.isCompleted && (phone || email)) {
    const result = await db.execute<{ capture_lead: string | null }>(
      sql`select capture_lead(${uuid}::uuid) as capture_lead`,
    );
    leadId = result.rows[0]?.capture_lead ?? null;

    // Once we have a number we can actually reach them on, start the
    // recovery ladder. Idempotent, so the debounced updates are harmless.
    if (phone) await scheduleLeadRecovery(uuid);
  }

  return NextResponse.json({ status: "success", lead_id: leadId });
}
