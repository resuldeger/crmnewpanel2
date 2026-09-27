import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { webhookDeliveries } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── What happened to the browser call ─────────────────────────────────
 * SPIKE (spike/web-dialer).
 *
 * Vonage posts a row here for every state change: ringing, answered,
 * completed, and the reason when it was none of those. The browser sees
 * some of this over the SDK, but only while the tab is open — this is the
 * copy that survives.
 *
 * Recorded rather than acted on. These are Voice API calls on a different
 * account from VBC, so they are NOT the same calls the `calls` table holds
 * and writing them there would put two accounts' history in one place with
 * no way to tell them apart. The webhook inbox is the honest home for them
 * until we decide what a browser call should look like in the CRM.
 * ────────────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const uuid = typeof body.uuid === "string" ? body.uuid : null;
  const status = typeof body.status === "string" ? body.status : "unknown";

  console.log(
    `vonage/voice/events: ${status}` +
      (uuid ? ` uuid=${uuid}` : "") +
      (body.direction ? ` ${String(body.direction)}` : "") +
      (body.duration ? ` ${String(body.duration)}s` : "") +
      (body.reason ? ` reason=${String(body.reason)}` : ""),
  );

  await db
    .insert(webhookDeliveries)
    .values({
      provider: "vonage-voice",
      externalSid: uuid ?? `no-uuid-${Date.now()}`,
      eventType: status,
      /* Not signed today. Saying so in the row is better than a `true` that
         nobody checked — the column is read by the Settings screen, which
         calls an unsigned delivery out. */
      signatureValid: false,
      payload: body,
      processed: true,
      processedAt: new Date(),
    })
    /* Vonage retries, and a retry must not become a second row. */
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}
