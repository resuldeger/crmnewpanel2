import { NextResponse } from "next/server";
import { systemHealth } from "@/server/integrations/systemHealth";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where every number on this console comes from, and whether it is still
 * arriving.
 *
 * Read with `reports.view` rather than `settings.manage`: the people who
 * notice the board has stopped moving are the managers watching it, and
 * only the owner account holds `settings.manage`. Nothing here is a
 * secret — credentials are reported as present or absent, never shown —
 * and the provider error strings are already on the halt banner that every
 * signed-in user sees. Clearing a halt stays privileged.
 */
export const GET = withAuth("reports.view", async () => {
  return NextResponse.json(await systemHealth(), {
    headers: { "Cache-Control": "no-store" },
  });
});
