import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { callNotes, calls, staff } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import type { SessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── What people concluded from listening ──────────────────────────────
 * A recording is listened to by more than one person and what they made
 * of it had nowhere to go. These are a series on purpose: the second
 * listener disagreeing with the first is the part worth keeping, so
 * nothing here overwrites anything.
 *
 * Both directions re-check the branch the call belongs to. A note on a
 * call is about a named customer, so it is no less private than the call.
 * ────────────────────────────────────────────────────────────────── */

/** The call, if this user is allowed to see it at all. */
async function reachable(user: SessionUser, id: string) {
  const callId = Number(id);
  if (!Number.isInteger(callId)) return null;
  const [row] = await db
    .select({ id: calls.id, locationId: calls.locationId })
    .from(calls)
    .where(eq(calls.id, callId))
    .limit(1);
  if (!row) return null;
  if (row.locationId) requireScope(user, row.locationId);
  return row;
}

export const GET = withAuth("calls.view", async (user, _req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const call = await reachable(user, id);
  if (!call) return NextResponse.json({ message: "Call not found" }, { status: 404 });

  const rows = await db
    .select({
      id: callNotes.id,
      body: callNotes.body,
      authorId: callNotes.authorId,
      authorName: callNotes.authorName,
      atSeconds: callNotes.atSeconds,
      createdAt: callNotes.createdAt,
      edited: callNotes.edited,
      /* The stored name is what the note keeps when someone leaves; the
         live one is preferred while they are still here, so a rename
         shows everywhere rather than only on new notes. */
      currentName: staff.name,
    })
    .from(callNotes)
    .leftJoin(staff, eq(staff.id, callNotes.authorId))
    .where(eq(callNotes.callId, call.id))
    .orderBy(asc(callNotes.createdAt));

  return NextResponse.json(
    {
      notes: rows.map((r) => ({
        id: r.id,
        body: r.body,
        author: r.currentName ?? r.authorName,
        authorId: r.authorId,
        atSeconds: r.atSeconds,
        createdAt: r.createdAt,
        edited: r.edited,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});

export const POST = withAuth("calls.manage", async (user, req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const call = await reachable(user, id);
  if (!call) return NextResponse.json({ message: "Call not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { body?: string; atSeconds?: number };
  const text = String(body.body ?? "").trim();
  if (!text) return NextResponse.json({ message: "A note cannot be empty" }, { status: 422 });
  // Long enough for a real observation, short enough not to be a document.
  if (text.length > 4000) return NextResponse.json({ message: "That note is too long" }, { status: 422 });

  const at =
    typeof body.atSeconds === "number" && Number.isFinite(body.atSeconds) && body.atSeconds >= 0
      ? Math.round(body.atSeconds)
      : null;

  const [created] = await db
    .insert(callNotes)
    .values({
      callId: call.id,
      authorId: user.id,
      authorName: user.name,
      body: text,
      atSeconds: at,
    })
    .returning({ id: callNotes.id, createdAt: callNotes.createdAt });

  return NextResponse.json(
    {
      note: {
        id: created.id,
        body: text,
        author: user.name,
        authorId: user.id,
        atSeconds: at,
        createdAt: created.createdAt,
        edited: false,
      },
    },
    { status: 201 },
  );
});

export const DELETE = withAuth("calls.manage", async (user, req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const call = await reachable(user, id);
  if (!call) return NextResponse.json({ message: "Call not found" }, { status: 404 });

  const noteId = Number(new URL(req.url).searchParams.get("note"));
  if (!Number.isInteger(noteId)) return NextResponse.json({ message: "Which note?" }, { status: 400 });

  /* Your own, unless you are a super admin. A manager deleting the note a
     colleague left about a call is how a disagreement disappears. */
  const scoped =
    user.roleId === "super_admin"
      ? eq(callNotes.id, noteId)
      : and(eq(callNotes.id, noteId), eq(callNotes.authorId, user.id));

  const gone = await db
    .delete(callNotes)
    .where(and(scoped, eq(callNotes.callId, call.id)))
    .returning({ id: callNotes.id });

  if (gone.length === 0) return NextResponse.json({ message: "Not yours to delete" }, { status: 403 });
  return NextResponse.json({ ok: true });
});
