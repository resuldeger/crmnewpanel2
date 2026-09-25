import { NextResponse, type NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, appointments, calls, leads, tasks } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Merging duplicate leads ───────────────────────────────────────────
 * The same person filling the form twice produces two leads. Merging used
 * to drop the extras from React state — the rows stayed in the database, so
 * they came back on reload and the desk rang the customer twice.
 *
 * Nothing is deleted here. The losers keep their history and are marked
 * merged_into the survivor, so the call log and the messages still point
 * somewhere real and the merge itself can be audited.
 * ────────────────────────────────────────────────────────────────── */

export const POST = withAuth("leads.merge", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    primary_id?: string;
    other_ids?: string[];
    take?: Record<string, unknown>;
  };

  const primaryId = String(body.primary_id ?? "");
  const otherIds = Array.isArray(body.other_ids) ? body.other_ids.map(String).filter(Boolean) : [];

  if (!primaryId || otherIds.length === 0) {
    return NextResponse.json({ message: "Pick a lead to keep and at least one to merge" }, { status: 422 });
  }
  if (otherIds.includes(primaryId)) {
    return NextResponse.json({ message: "A lead cannot be merged into itself" }, { status: 422 });
  }

  const [primary] = await db.select().from(leads).where(eq(leads.id, primaryId)).limit(1);
  if (!primary) return NextResponse.json({ message: "Lead to keep not found" }, { status: 404 });
  requireScope(user, primary.locationId);

  const losers = await db.select().from(leads).where(inArray(leads.id, otherIds));
  if (losers.length !== otherIds.length) {
    return NextResponse.json({ message: "One of the leads no longer exists" }, { status: 404 });
  }
  // Merging across branches would move another studio's lead out of sight.
  for (const l of losers) requireScope(user, l.locationId);

  /* A lead already merged into something else must not be merged again, or
     the chain of survivors forks and the history stops resolving. */
  const alreadyMerged = losers.find((l) => l.mergedInto);
  if (alreadyMerged) {
    return NextResponse.json(
      { message: `${alreadyMerged.id} was already merged into ${alreadyMerged.mergedInto}` },
      { status: 409 },
    );
  }
  if (primary.mergedInto) {
    return NextResponse.json(
      { message: `${primary.id} is itself merged into ${primary.mergedInto}` },
      { status: 409 },
    );
  }

  // Only fields an operator may carry over from a duplicate.
  const TAKEABLE = ["name", "email", "phoneE164", "locale"] as const;
  const carried: Record<string, unknown> = {};
  for (const key of TAKEABLE) {
    const value = body.take?.[key];
    if (typeof value === "string" && value.trim()) carried[key] = value.trim();
  }

  const result = await db.transaction(async (tx) => {
    if (Object.keys(carried).length > 0) {
      await tx.update(leads).set({ ...carried, updatedAt: new Date() }).where(eq(leads.id, primaryId));
    }

    /* Reattach everything that pointed at a loser, so the survivor carries
       the full history — that is the whole point of merging rather than
       deleting. Call counts and SLA timings are read off these rows. */
    await tx.update(calls).set({ leadId: primaryId }).where(inArray(calls.leadId, otherIds));
    await tx.update(tasks).set({ leadId: primaryId }).where(inArray(tasks.leadId, otherIds));
    await tx.update(appointments).set({ leadId: primaryId }).where(inArray(appointments.leadId, otherIds));

    await tx
      .update(leads)
      .set({
        mergedInto: primaryId,
        lifecycleStatus: "done",
        callStatus: "double_lead",
        updatedAt: new Date(),
      })
      .where(inArray(leads.id, otherIds));

    // The survivor inherits the earliest first-contact time; otherwise a
    // merge could make the SLA clock look better than it was.
    const earliest = losers
      .map((l) => l.firstCalledAt)
      .concat(primary.firstCalledAt)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (earliest && (!primary.firstCalledAt || earliest < primary.firstCalledAt)) {
      await tx.update(leads).set({ firstCalledAt: earliest }).where(eq(leads.id, primaryId));
    }

    const [survivor] = await tx.select().from(leads).where(eq(leads.id, primaryId)).limit(1);
    return survivor;
  });

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: primary.locationId,
    targetType: "lead",
    targetId: primaryId,
    targetLabel: primary.name,
    action: "merged",
    fromValue: otherIds.join(", "),
    toValue: primaryId,
    diff: { mergedFrom: [otherIds.join(", "), primaryId] },
    summary: `Merged ${otherIds.length} duplicate(s) into ${primaryId}`,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ lead: result, merged: otherIds });
});
