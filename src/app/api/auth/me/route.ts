import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Who am I, what may I do, which studios can I see. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
}
