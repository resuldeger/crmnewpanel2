import { NextResponse, type NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { uploads, bookingSessions } from "@/db/schema";
import { storeUpload, MAX_BYTES, ALLOWED } from "@/server/booking/uploads";
import { clientIp } from "@/server/booking/attribution";
import { allow } from "@/server/redis";
import { currentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Reference artwork from the STORY step or admin assets (studios, avatars, etc.). */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers) ?? "unknown";
  if (!(await allow("upload", ip, 20, 600))) {
    return NextResponse.json({ message: "Too many uploads" }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "No file received" }, { status: 400 });
  }

  /* A signed-in staff member is uploading an admin asset (studio photo,
     avatar) and has no booking session to point at. Everything after this
     — size, magic-byte sniffing, the rate limit above — still applies. */
  const staffUser = await currentUser().catch(() => null);

  let sessionId: number | null = null;

  if (!staffUser) {
    /* ── Who is this ───────────────────────────────────────────────────
     * For public booking: The session must exist and must have reached the
     * point of leaving a phone or email.
     */
    const sessionUuidRaw = form?.get("session_uuid");
    const sessionUuid = typeof sessionUuidRaw === "string" ? sessionUuidRaw : "";
    if (!sessionUuid) {
      return NextResponse.json({ message: "Invalid or expired session" }, { status: 403 });
    }

    const [session] = await db
      .select({
        id: bookingSessions.id,
        phone: bookingSessions.phoneE164,
        email: bookingSessions.email,
      })
      .from(bookingSessions)
      .where(eq(bookingSessions.sessionUuid, sessionUuid))
      .limit(1);

    if (!session) {
      return NextResponse.json({ message: "Unknown session" }, { status: 403 });
    }
    if (!session.phone && !session.email) {
      return NextResponse.json(
        { message: "Add your contact details before uploading a reference image" },
        { status: 403 },
      );
    }

    sessionId = session.id;

    /* One reference image per session. Without this a single identified
       visitor could still fill the disk by uploading in a loop. */
    const [already] = await db
      .select({ n: count() })
      .from(uploads)
      .where(eq(uploads.sessionId, session.id));
    if (Number(already?.n ?? 0) >= 5) {
      return NextResponse.json({ message: "Too many images for one booking" }, { status: 429 });
    }
  }

  // Check the declared size before reading the body into memory.
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { message: `File must be ${Math.round(MAX_BYTES / 1024 / 1024)} MB or smaller` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ message: "File too large" }, { status: 413 });
  }

  let stored;
  try {
    stored = await storeUpload(buffer, file.type);
  } catch (err) {
    if ((err as Error).message === "unsupported_type") {
      return NextResponse.json(
        { message: `Only ${Object.values(ALLOWED).join(", ")} images are allowed` },
        { status: 415 },
      );
    }
    throw err;
  }

  await db.insert(uploads).values({
    /* Set for funnel uploads, so an abandoned booking still shows the desk
       the artwork the visitor had picked — and null for admin assets,
       which is what keeps the retention collector away from them. */
    sessionId,
    url: stored.url,
    storageKey: stored.storageKey,
    mimeType: stored.mimeType,
    bytes: stored.bytes,
    checksum: stored.checksum,
    ip,
  });

  return NextResponse.json({ status: "success", url: stored.url }, { status: 201 });
}
