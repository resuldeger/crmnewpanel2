import { NextResponse, type NextRequest } from "next/server";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db/client";
import { smsConversations, smsMessages, locations } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { scopeWhere, compact } from "@/server/crm/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SMS threads. Messages for one thread are loaded on demand rather than
 * for all of them at once — a busy studio has thousands.
 */
export const GET = withAuth("sms.view", async (user, req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const conversationId = p.get("id") ? Number(p.get("id")) : null;
  const q = p.get("q")?.trim();

  if (conversationId) {
    const [thread] = await db
      .select({ conversation: smsConversations, studio: { id: locations.id, name: locations.name } })
      .from(smsConversations)
      .leftJoin(locations, eq(locations.id, smsConversations.locationId))
      .where(and(...compact([eq(smsConversations.id, conversationId), scopeWhere(user, smsConversations.locationId)])))
      .limit(1);

    if (!thread) return NextResponse.json({ message: "Thread not found" }, { status: 404 });

    const messages = await db
      .select()
      .from(smsMessages)
      .where(eq(smsMessages.conversationId, conversationId))
      .orderBy(asc(smsMessages.createdAt))
      .limit(500);

    return NextResponse.json(
      { conversation: { ...thread.conversation, studio: thread.studio }, messages },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const rows = await db
    .select({ conversation: smsConversations, studio: { id: locations.id, city: locations.city } })
    .from(smsConversations)
    .leftJoin(locations, eq(locations.id, smsConversations.locationId))
    .where(
      and(
        ...compact([
          scopeWhere(user, smsConversations.locationId),
          q ? or(ilike(smsConversations.customerName, `%${q}%`), ilike(smsConversations.phoneE164, `%${q}%`)) : undefined,
        ]),
      ),
    )
    .orderBy(desc(smsConversations.lastMessageAt))
    .limit(200);

  return NextResponse.json(
    { conversations: rows.map((r) => ({ ...r.conversation, studio: r.studio })) },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/* Marking a thread read. It only changed React state, so the unread badge
 * came back on every reload and a colleague on another device never saw
 * that the message had been picked up. */
export const PATCH = withAuth("sms.view", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as { id?: number; unread?: boolean };

  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ message: "Bad conversation id" }, { status: 400 });

  const [existing] = await db
    .select({ id: smsConversations.id, locationId: smsConversations.locationId })
    .from(smsConversations)
    .where(eq(smsConversations.id, id))
    .limit(1);

  if (!existing) return NextResponse.json({ message: "Conversation not found" }, { status: 404 });
  requireScope(user, existing.locationId);

  await db
    .update(smsConversations)
    .set({ unreadCount: body.unread === true ? 1 : 0, updatedAt: new Date() })
    .where(eq(smsConversations.id, id));

  return NextResponse.json({ ok: true });
});
