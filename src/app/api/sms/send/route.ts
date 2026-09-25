import { NextResponse, type NextRequest } from "next/server";
import { sendSms } from "@/server/sms/send";
import { requireInternalToken } from "@/server/auth/internal";
import { requirePermission, requireScope, AuthError } from "@/server/auth/guard";
import type { SessionUser } from "@/server/auth/session";
import { allow } from "@/server/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Send one SMS.
 *
 * Two callers, two credentials:
 *   · the worker and other server-side jobs carry INTERNAL_API_TOKEN
 *   · an operator in the console carries their session cookie
 *
 * Only the token was accepted, so every message sent from the console was
 * refused — the one path a human actually uses. Accepting both, and
 * attributing the message to whoever sent it rather than to "console".
 */
async function authorise(req: NextRequest): Promise<
  | { ok: true; user: SessionUser | null }
  | { ok: false; status: number; message: string }
> {
  // Machine callers first: no cookie, and the token is unambiguous.
  const token = requireInternalToken(req);
  if (token.ok) return { ok: true, user: null };

  try {
    const user = await requirePermission("sms.send");
    return { ok: true, user };
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, status: err.status, message: err.message };
    return { ok: false, status: 401, message: "Not signed in" };
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorise(req);
  if (!auth.ok) return NextResponse.json({ message: auth.message }, { status: auth.status });
  const user = auth.user;

  const body = (await req.json().catch(() => ({}))) as {
    to?: string;
    location_id?: number;
    body?: string;
    template_key?: string;
    vars?: Record<string, string>;
    locale?: string;
    lead_id?: string;
    sender_staff_id?: number;
    sender_name?: string;
  };

  if (!body.to || !body.location_id) {
    return NextResponse.json({ message: "to and location_id are required" }, { status: 422 });
  }
  if (!body.body && !body.template_key) {
    return NextResponse.json({ message: "body or template_key is required" }, { status: 422 });
  }

  /* A signed-in operator may only message from a studio they cover.
     Without this, branch scope stopped at reading. */
  if (user) requireScope(user, body.location_id);

  /* Attribution comes from the session, not the request body: a caller
     could otherwise post any colleague's id and the message would land on
     their record. Machine callers may still pass one, because a job sends
     on behalf of whoever scheduled it. */
  const senderStaffId = user ? user.id : (body.sender_staff_id ?? null);
  const senderName = user ? user.name : (body.sender_name ?? null);

  // Per-sender throttle: 5 a minute, matching the security checklist.
  const who = String(senderStaffId ?? "internal");
  if (!(await allow("sms:send", who, 5, 60))) {
    return NextResponse.json({ message: "Slow down — 5 messages per minute" }, { status: 429 });
  }

  const outcome = await sendSms({
    to: body.to,
    locationId: body.location_id,
    body: body.body,
    templateKey: body.template_key as never,
    vars: body.vars,
    locale: body.locale,
    kind: "manual",
    leadId: body.lead_id ?? null,
    senderStaffId,
    senderName,
  });

  if (!outcome.ok) {
    const status = outcome.reason === "opted_out" ? 409 : outcome.reason === "no_sender" ? 422 : 502;
    return NextResponse.json({ message: outcome.message, reason: outcome.reason }, { status });
  }

  return NextResponse.json(outcome, { status: 201 });
}
