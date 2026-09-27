import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { calls, activityLog, extensions, realtimeEvents } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { normalizeNumber } from "@/server/twilio/resolve";
import { placeCall } from "@/server/vonage/telephony";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Placing a call from the browser, on a line you picked ─────────────
 * SPIKE (spike/web-dialer).
 *
 * What this actually does, because the phrase "call from the browser"
 * promises something it does not deliver: the browser only STARTS the call.
 * Vonage rings the chosen extension first — a desk phone or the VBC app —
 * and dials the customer when that is answered. No audio goes through this
 * tab, and closing it does not end the call. Audio in the browser is the
 * Vonage Client SDK and a WebRTC session, which is a different and much
 * larger piece of work.
 *
 * The practical consequence, worth knowing before pressing the button: the
 * extension you choose has to be one someone is sitting at. Pick a line
 * nobody is on and the call rings an empty desk until Vonage gives up.
 *
 * Real calls, really billed. Guarded by calls.manage, scoped to the
 * studios the person may act for, and every attempt is written to the
 * activity log with the line it went out on.
 * ────────────────────────────────────────────────────────────────── */
export const POST = withAuth("calls.manage", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    from_extension?: string;
    device_sip_id?: string | null;
    to?: string;
    name?: string;
  };

  const to = normalizeNumber(body.to);
  if (!to) return NextResponse.json({ message: "A number to call is required" }, { status: 422 });
  /* +1 plus ten digits is the shortest thing worth dialling here. A typo
     that leaves three digits would otherwise be handed to Vonage, which
     charges for the attempt and answers with something unhelpful. */
  if (to.replace(/\D/g, "").length < 10) {
    return NextResponse.json({ message: `${to} is too short to be a phone number` }, { status: 422 });
  }

  const fromExtension = String(body.from_extension ?? "").trim();
  if (!fromExtension) {
    return NextResponse.json({ message: "Pick the line to call from" }, { status: 422 });
  }

  /* Looked up rather than trusted. The extension arrives from a form, and
     an unchecked one would let someone dial out on another branch's line —
     which is also the number the customer sees and calls back. */
  const [line] = await db
    .select()
    .from(extensions)
    .where(eq(extensions.extension, fromExtension))
    .limit(1);

  if (!line) {
    return NextResponse.json({ message: `No such extension: ${fromExtension}` }, { status: 404 });
  }
  /* A call-centre seat belongs to no studio and is shared; a studio's line
     is not. requireScope throws for anyone outside it. */
  if (line.locationId !== null) requireScope(user, line.locationId);

  const started = Date.now();
  /* A named handset when one was chosen. Without it Vonage rings whichever
     of the extension's devices it likes, which is how a customer ended up
     connected to a desk nobody was at. */
  const placed = await placeCall(line.extension, to, body.device_sip_id ?? null);
  const ms = Date.now() - started;

  /* Recorded whether or not it connected. An attempt that Vonage refused is
     the single most useful row there is while this is being worked out, and
     "we tried and it failed" must not look like "we never tried". */
  const [row] = await db
    .insert(calls)
    .values({
      direction: "outbound",
      fromNumber: line.phoneNumber ?? line.extension,
      toNumber: to,
      fromName: line.displayName,
      toName: body.name ?? null,
      locationId: line.locationId,
      staffId: user.id,
      agentName: user.name,
      extension: line.extension,
      provider: placed.ok ? "vonage" : "console",
      // So the outcome webhook lands on THIS row instead of making a second.
      externalCallId: placed.ok ? placed.callId : null,
      startTime: new Date(),
      duration: 0,
      result: "Attempted",
      initiatedFromConsole: true,
    })
    .returning();

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: line.locationId,
    targetType: "call",
    targetId: String(row.id),
    targetLabel: to,
    action: "call_logged",
    summary: `Dialer: ${line.extension} → ${to} (${placed.ok ? "placed" : "refused"})`,
  });

  await db.insert(realtimeEvents).values({
    channel: "calls:live",
    topic: "call.attempted",
    locationId: line.locationId,
    requiredPermission: "calls.view",
    payload: { callId: row.id, to, agent: user.name, extension: line.extension },
  });

  /* Vonage's own answer is returned verbatim, status and all. This is the
     screen where someone is trying to find out what the API does; a tidied
     "could not place the call" would throw away the only useful part. */
  return NextResponse.json(
    {
      placed: placed.ok,
      callId: row.id,
      externalCallId: placed.ok ? placed.callId : null,
      line: {
        extension: line.extension,
        displayName: line.displayName,
        did: line.phoneNumber,
        locationId: line.locationId,
      },
      to,
      elapsedMs: ms,
      vonage: placed.ok ? { status: 200, detail: null } : { status: placed.status, detail: placed.detail },
    },
    { status: placed.ok ? 201 : 502 },
  );
});
