import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, appointments, customers, leads, notes } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Notes on a lead, appointment or customer ──────────────────────────
 * "Called them, they'll confirm tomorrow" is the desk's working memory. It
 * lived in React state only, so the note vanished on reload and the next
 * person rang the same customer again.
 * ────────────────────────────────────────────────────────────────── */

const TARGETS = ["lead", "appointment", "customer"] as const;
type Target = (typeof TARGETS)[number];

/** The studio a note's subject belongs to, for scope checks. */
async function locationOf(type: Target, id: string): Promise<number | null | undefined> {
  if (type === "lead") {
    const [row] = await db.select({ l: leads.locationId }).from(leads).where(eq(leads.id, id)).limit(1);
    return row?.l;
  }
  if (type === "appointment") {
    const numeric = Number(id);
    if (!Number.isInteger(numeric)) return undefined;
    const [row] = await db
      .select({ l: appointments.locationId })
      .from(appointments)
      .where(eq(appointments.id, numeric))
      .limit(1);
    return row?.l;
  }
  const [row] = await db
    .select({ l: customers.locationId })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  return row?.l;
}

export const GET = withAuth("customers.view", async (user, req: NextRequest) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");

  if (type && id) {
    if (!TARGETS.includes(type as Target)) {
      return NextResponse.json({ message: "Unknown target type" }, { status: 422 });
    }
    const loc = await locationOf(type as Target, id);
    if (loc === undefined) return NextResponse.json({ message: "Not found" }, { status: 404 });
    requireScope(user, loc);

    const rows = await db
      .select()
      .from(notes)
      .where(and(eq(notes.notableType, type as Target), eq(notes.notableId, id)))
      .orderBy(desc(notes.createdAt));
    return NextResponse.json({ notes: rows });
  }

  /* No target: the console loads every note it may need up front. Scope is
     applied by resolving each subject's studio, because notes themselves
     carry no location. */
  const rows = await db.select().from(notes).orderBy(desc(notes.createdAt)).limit(1000);
  if (user.scopeAll) return NextResponse.json({ notes: rows });

  const apptIds = rows
    .filter((n) => n.notableType === "appointment")
    .map((n) => Number(n.notableId))
    .filter(Number.isInteger);
  const leadIds = rows.filter((n) => n.notableType === "lead").map((n) => n.notableId);
  const custIds = rows.filter((n) => n.notableType === "customer").map((n) => n.notableId);

  const [apptRows, leadRows, custRows] = await Promise.all([
    apptIds.length
      ? db.select({ id: appointments.id, l: appointments.locationId }).from(appointments).where(inArray(appointments.id, apptIds))
      : Promise.resolve([]),
    leadIds.length
      ? db.select({ id: leads.id, l: leads.locationId }).from(leads).where(inArray(leads.id, leadIds))
      : Promise.resolve([]),
    custIds.length
      ? db.select({ id: customers.id, l: customers.locationId }).from(customers).where(inArray(customers.id, custIds))
      : Promise.resolve([]),
  ]);

  const allowed = new Set(user.locationIds);
  const locOf = new Map<string, number | null>();
  for (const r of apptRows) locOf.set(`appointment:${r.id}`, r.l);
  for (const r of leadRows) locOf.set(`lead:${r.id}`, r.l);
  for (const r of custRows) locOf.set(`customer:${r.id}`, r.l);

  return NextResponse.json({
    notes: rows.filter((n) => {
      const l = locOf.get(`${n.notableType}:${n.notableId}`);
      // A subject with no studio is visible to everyone in scope terms;
      // one that resolved to a studio must be in the reader's list.
      return l === null || l === undefined ? false : allowed.has(l);
    }),
  });
});

export const POST = withAuth("customers.edit", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as {
    notable_type?: string;
    notable_id?: string;
    content?: string;
    pinned?: boolean;
  };

  const type = String(body.notable_type ?? "");
  const id = String(body.notable_id ?? "");
  const content = String(body.content ?? "").trim();

  if (!TARGETS.includes(type as Target) || !id) {
    return NextResponse.json({ message: "Unknown target" }, { status: 422 });
  }
  if (content.length < 1 || content.length > 5000) {
    return NextResponse.json({ message: "Note must be 1–5000 characters" }, { status: 422 });
  }

  const loc = await locationOf(type as Target, id);
  if (loc === undefined) return NextResponse.json({ message: "Not found" }, { status: 404 });
  requireScope(user, loc);

  const [row] = await db
    .insert(notes)
    .values({
      notableType: type as Target,
      notableId: id,
      authorStaffId: user.id,
      authorName: user.name,
      content,
      pinned: body.pinned === true,
    })
    .returning();

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    locationId: loc,
    targetType: type as Target,
    targetId: id,
    action: "note_added",
    summary: content.slice(0, 200),
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ note: row }, { status: 201 });
});
