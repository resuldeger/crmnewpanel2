import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { calls, locations } from "@/db/schema";
import { withAuth, requireScope } from "@/server/auth/guard";
import { vonageAccessToken } from "@/server/vonage/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROOT = () => path.resolve(process.env.RECORDINGS_DIR ?? "storage/recordings");

/* ── Playing a recording back ──────────────────────────────────────────
 * The recording lives at the carrier, behind the account's credentials,
 * and the call row only ever stores the link. That is deliberate: a link
 * leaking out of the database is not a recording leaking out. It also
 * means the browser cannot fetch it — an <audio src> pointed at Vonage
 * gets a 401 — so the audio comes through here, with the credentials
 * staying on the server and the caller checked for calls.view and for
 * access to the branch the call belongs to.
 *
 * The first request also keeps a copy. Streaming the carrier's response
 * straight through looked simpler and was wrong twice over: the upstream
 * response carries no Content-Length and no range support, so the browser
 * could not report a duration and could not seek at all — clicking a note
 * timestamp did nothing. And every replay went back to Vonage for a file
 * we had already paid to fetch.
 *
 * These are 8 kHz mono; a ten-minute call is under two megabytes. Holding
 * one in memory long enough to write it to disk is cheap, and afterwards
 * the file is served from disk with proper ranges, which is what makes
 * the scrub bar and the note timestamps work.
 * ────────────────────────────────────────────────────────────────── */

/** Serves a local file, honouring a Range request. */
async function serveFile(file: string, size: number, callId: number, req: Request): Promise<Response> {
  const type = file.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  const common = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="call-${callId}${path.extname(file)}"`,
  };

  const range = req.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    // A range that starts past the end is a 416, not an empty 206.
    if (Number.isNaN(start) || start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      status: 206,
      headers: { ...common, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return new Response(stream, { headers: { ...common, "Content-Length": String(size) } });
}

export const GET = withAuth("calls.view", async (user, req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const callId = Number(id);
  if (!Number.isInteger(callId)) {
    return Response.json({ message: "Not a call id" }, { status: 400 });
  }

  const [row] = await db
    .select({
      recordingUrl: calls.recordingUrl,
      recordingPath: calls.recordingPath,
      provider: calls.provider,
      locationId: calls.locationId,
      hasRecording: calls.hasRecording,
      twilio: locations.twilio,
    })
    .from(calls)
    .leftJoin(locations, eq(locations.id, calls.locationId))
    .where(eq(calls.id, callId))
    .limit(1);

  if (!row) return Response.json({ message: "Call not found" }, { status: 404 });
  // A branch manager may not listen to another branch's calls.
  if (row.locationId) requireScope(user, row.locationId);

  /* ── A copy we already hold ────────────────────────────────────────
   * Preferred over the carrier every time: it is faster, it still works
   * when the account or the permission changes, and it is the only copy
   * once Vonage ages the audio out. The stored path is resolved under the
   * recordings directory and checked to still be inside it, so a path
   * that walked upward cannot be used to read the rest of the disk. */
  if (row.recordingPath) {
    const root = ROOT();
    const file = path.resolve(root, row.recordingPath);
    if (!file.startsWith(root + path.sep)) {
      console.error(`calls/${callId}/recording: stored path escapes the recordings directory`);
      return Response.json({ message: "The recording could not be read" }, { status: 500 });
    }
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return serveFile(file, info.size, callId, req);
    console.warn(`calls/${callId}/recording: ${row.recordingPath} is on the row but not on disk`);
  }

  /* has_recording says the carrier made one; it does not say we can reach
     it. Voicemail is in exactly that state — it is kept somewhere this
     API does not serve — so this is an ordinary answer, not an error, and
     the console has to be able to tell the two apart. */
  if (!row.recordingUrl) {
    return Response.json(
      {
        message: row.hasRecording
          ? "The carrier recorded this call but has not given us a link to it"
          : "This call was not recorded",
        reason: row.hasRecording ? "no_link" : "not_recorded",
      },
      { status: 404 },
    );
  }

  const headers: Record<string, string> = {};
  if (row.provider === "twilio") {
    const sid = row.twilio?.accountSid ?? process.env.TWILIO_ACCOUNT_SID;
    const token = row.twilio?.authToken ?? process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      return Response.json({ message: "No Twilio credentials for this studio" }, { status: 502 });
    }
    headers.authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
  } else {
    const token = await vonageAccessToken();
    if (!token) return Response.json({ message: "Vonage is not reachable" }, { status: 502 });
    headers.authorization = `Bearer ${token}`;
  }

  const upstream = await fetch(row.recordingUrl, { headers }).catch(() => null);
  if (!upstream || !upstream.ok) {
    console.warn(`calls/${callId}/recording: carrier answered ${upstream?.status ?? "nothing"}`);
    return Response.json({ message: "The recording could not be fetched" }, { status: 502 });
  }

  const bytes = Buffer.from(await upstream.arrayBuffer());
  const type = upstream.headers.get("content-type") ?? "audio/mpeg";
  const ext = type.includes("wav") ? ".wav" : ".mp3";
  const stored = `${callId}${ext}`;

  /* Written through a temporary name: two operators opening the same call
     at the same moment would otherwise both write the file, and the
     second could be reading a half-written one. A rename is atomic. */
  try {
    const root = ROOT();
    await mkdir(root, { recursive: true });
    const tmp = path.join(root, `.${stored}.${process.pid}.part`);
    await writeFile(tmp, bytes);
    await rename(tmp, path.join(root, stored));
    await db.update(calls).set({ recordingPath: stored }).where(eq(calls.id, callId));
  } catch (err) {
    // Serving it still works; only the copy was lost.
    console.warn(`calls/${callId}/recording: could not cache — ${(err as Error).message}`);
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="call-${callId}${ext}"`,
    },
  });
});
