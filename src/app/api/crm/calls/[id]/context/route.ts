import { NextResponse } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { calls, customers, leads, locations } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How many of this person's calls to list beside the recording. */
const RECENT = 25;

/* ── Who is on the other end ───────────────────────────────────────────
 * Listening to a call and not knowing whose it is means leaving the
 * dialog, searching the number, and losing your place in the recording.
 * The one thing you want while the audio plays is whether this person has
 * called before and what happened those times.
 *
 * Matched on the digits rather than the stored string, so a number written
 * "+1 (404) 555-0101" anywhere finds the same person.
 * ────────────────────────────────────────────────────────────────── */
export const GET = withAuth("calls.view", async (user, _req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const callId = Number(id);
  if (!Number.isInteger(callId)) {
    return NextResponse.json({ message: "Not a call id" }, { status: 400 });
  }

  const [call] = await db
    .select({
      id: calls.id,
      direction: calls.direction,
      fromNumber: calls.fromNumber,
      toNumber: calls.toNumber,
      customerId: calls.customerId,
      leadId: calls.leadId,
      locationId: calls.locationId,
      startTime: calls.startTime,
    })
    .from(calls)
    .where(eq(calls.id, callId))
    .limit(1);

  if (!call) return NextResponse.json({ message: "Call not found" }, { status: 404 });
  if (call.locationId) requireScope(user, call.locationId);

  /* The outside party: whoever is not us. On an inbound call that is the
     caller, on an outbound one the number we dialled. */
  const theirNumber = call.direction === "inbound" ? call.fromNumber : call.toNumber;
  const digits = (theirNumber ?? "").replace(/\D/g, "");

  if (digits.length < 7) {
    return NextResponse.json({ number: theirNumber, person: null, totalCalls: 1, isFirstCall: true, calls: [] });
  }

  const samePerson = sql`regexp_replace(
    case when ${calls.direction} = 'inbound' then ${calls.fromNumber} else ${calls.toNumber} end,
    '[^0-9]', '', 'g'
  ) = ${digits}`;

  /* Identity comes from the call row when the sync already linked it, and
     from the number when it did not — a customer created after the call
     was logged is not linked backwards. */
  const [customer] = call.customerId
    ? await db.select({ id: customers.id, name: customers.name, phone: customers.phoneE164 })
        .from(customers).where(eq(customers.id, call.customerId)).limit(1)
    : await db.select({ id: customers.id, name: customers.name, phone: customers.phoneE164 })
        .from(customers)
        .where(and(
          sql`regexp_replace(coalesce(${customers.phoneE164}, ''), '[^0-9]', '', 'g') = ${digits}`,
          isNull(customers.mergedInto),
        ))
        .limit(1);

  const [lead] = call.leadId
    ? await db.select({ id: leads.id, name: leads.name, status: leads.callStatus })
        .from(leads).where(eq(leads.id, call.leadId)).limit(1)
    : await db.select({ id: leads.id, name: leads.name, status: leads.callStatus })
        .from(leads)
        .where(and(
          sql`regexp_replace(coalesce(${leads.phoneE164}, ''), '[^0-9]', '', 'g') = ${digits}`,
          isNull(leads.mergedInto),
        ))
        .orderBy(desc(leads.createdAt))
        .limit(1);

  const [[totals], history] = await Promise.all([
    db.select({
        total: sql<number>`count(*)::int`,
        firstAt: sql<Date | null>`min(${calls.startTime})`,
        answered: sql<number>`count(*) filter (where ${calls.result} = 'Answered')::int`,
      })
      .from(calls)
      .where(samePerson),
    db.select({
        id: calls.id,
        startTime: calls.startTime,
        direction: calls.direction,
        result: calls.result,
        duration: calls.duration,
        agentName: calls.agentName,
        extension: calls.extension,
        hasAudio: sql<boolean>`(${calls.recordingUrl} is not null or ${calls.recordingPath} is not null)`,
        studio: locations.name,
      })
      .from(calls)
      .leftJoin(locations, eq(locations.id, calls.locationId))
      /* Every call with this person, INCLUDING the one being listened to.
         Leaving it out made the list depend on which call was open, so
         playing a second one from it rebuilt a different list and the row
         under the cursor moved. The set is the same whichever call the
         dialog is showing; the open one is simply marked. */
      .where(samePerson)
      .orderBy(desc(calls.startTime))
      .limit(RECENT),
  ]);

  const total = totals?.total ?? 1;

  return NextResponse.json(
    {
      number: theirNumber,
      person: customer
        ? { kind: "customer" as const, id: customer.id, name: customer.name }
        : lead
          ? { kind: "lead" as const, id: lead.id, name: lead.name, status: lead.status }
          : null,
      totalCalls: total,
      answeredCalls: totals?.answered ?? 0,
      /* "First time they have called" is worth saying plainly — it is the
         difference between a new enquiry and someone being chased. */
      isFirstCall: total <= 1,
      firstCallAt: totals?.firstAt ?? call.startTime,
      /* Newest first, always. The panel never re-sorts it. */
      calls: history,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});

