import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { bookingSessions } from "@/db/schema";
import { clientIp } from "@/server/booking/attribution";
import { allow } from "@/server/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "I am still here."
 *
 * The live-visitor board needs to know who is on the booking form right
 * now. A socket on the public page would mean an open connection for every
 * anonymous visitor — a large attack surface for something a one-line
 * heartbeat answers. Step updates already touch last_seen_at; this covers
 * the visitor who is sitting and reading.
 *
 * It writes ONE column and returns nothing.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params;
  if (!UUID.test(uuid)) return new NextResponse(null, { status: 204 });

  const ip = clientIp(req.headers) ?? "unknown";
  // Generous but finite: a tab pinging every 20s needs 3/min.
  if (!(await allow("session:ping", ip, 30, 60))) {
    return new NextResponse(null, { status: 204 });
  }

  await db
    .update(bookingSessions)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(bookingSessions.sessionUuid, uuid));

  return new NextResponse(null, { status: 204 });
}
