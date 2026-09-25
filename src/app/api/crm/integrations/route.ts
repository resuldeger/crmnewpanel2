import { NextResponse } from "next/server";
import { healthReport } from "@/server/integrations/health";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Read with a permission every signed-in role holds: a halted integration
   is why the phones or the calendar stopped, and the person looking at an
   empty screen should be told, not left guessing. Clearing one is the
   privileged act, and that is guarded separately. */
export const GET = withAuth(null, async () => {
  return NextResponse.json(
    { integrations: await healthReport() },
    { headers: { "Cache-Control": "no-store" } },
  );
});
