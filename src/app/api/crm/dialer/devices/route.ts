import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { extensions } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { vonageFetch } from "@/server/vonage/fetch";
import { vonageEndpoints } from "@/server/vonage/endpoints";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── The handsets an extension can ring on ─────────────────────────────
 * SPIKE (spike/web-dialer).
 *
 * An extension is not a phone; it is a number that several phones answer
 * to. 487 has three registered handsets — a desk app, a mobile app, a
 * stale registration — and asking Vonage to ring "the extension" let it
 * pick. It picked one nobody was looking at, so the customer was dialled
 * and heard silence.
 *
 * Vonage does not tell us what each handset IS: `source_device_name` comes
 * back empty and the provisioning record carries only the sip_id. So this
 * lists them and the person picks; there is nothing here to label them
 * with, and inventing a label would be worse than showing the id.
 * ────────────────────────────────────────────────────────────── */
export const GET = withAuth("calls.manage", async (user, req: NextRequest) => {
  const wanted = (req.nextUrl.searchParams.get("extension") ?? "").trim();
  if (!wanted) return NextResponse.json({ message: "Which extension?" }, { status: 422 });

  const [line] = await db.select().from(extensions).where(eq(extensions.extension, wanted)).limit(1);
  if (!line) return NextResponse.json({ message: `No such extension: ${wanted}` }, { status: 404 });
  if (line.locationId !== null) requireScope(user, line.locationId);

  const accountId = process.env.VONAGE_ACCOUNT_ID;
  if (!accountId) return NextResponse.json({ message: "VONAGE_ACCOUNT_ID is not set" }, { status: 500 });

  const res = await vonageFetch(`${vonageEndpoints.extensions(accountId)}?page_size=200`);
  if (!res.ok) {
    return NextResponse.json(
      { message: `Vonage answered ${res.status}`, devices: [] },
      { status: 502 },
    );
  }

  const body = (await res.json()) as {
    _embedded?: { extensions?: { extension_number?: string; extension_handsets?: { sip_id?: string }[] }[] };
  };
  const record = (body._embedded?.extensions ?? []).find(
    (e) => String(e.extension_number ?? "") === wanted,
  );

  const devices = (record?.extension_handsets ?? [])
    .map((h) => h.sip_id)
    .filter((id): id is string => Boolean(id));

  return NextResponse.json(
    { extension: wanted, devices },
    { headers: { "Cache-Control": "no-store" } },
  );
});
