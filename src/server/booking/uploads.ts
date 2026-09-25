import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, stat, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, resolve } from "node:path";
import { and, isNull, isNotNull, lt, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { uploads, locations, appointments, leads } from "@/db/schema";

export const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");
export const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024);

/** Allow-list, not a block-list: anything not named here is rejected. */
export const ALLOWED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

/** Magic-byte check — a .png that is really a script must not get through. */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  const ascii = (i: number, s: string) =>
    [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (["heic", "heix", "hevc", "mif1", "heim", "heis"].includes(brand)) return "image/heic";
  }
  return null;
}

export interface StoredFile {
  storageKey: string;
  url: string;
  mimeType: string;
  bytes: number;
  checksum: string;
}

export async function storeUpload(buffer: Buffer, declaredMime: string): Promise<StoredFile> {
  // Trust the bytes, never the Content-Type the browser sent. Falling back
  // to the declared type let a PHP file through by simply labelling itself
  // image/png; an unrecognised signature is now a hard reject.
  const mimeType = sniffMime(buffer);
  if (!mimeType) throw new Error("unsupported_type");

  const ext = ALLOWED[mimeType];
  if (!ext) throw new Error("unsupported_type");

  // A mismatch between the claim and the bytes is worth knowing about.
  if (declaredMime && ALLOWED[declaredMime] && declaredMime !== mimeType) {
    console.warn(`upload: declared ${declaredMime} but bytes are ${mimeType}`);
  }

  const storageKey = `${randomUUID()}${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, storageKey), buffer, { mode: 0o640 });

  return {
    storageKey,
    url: `/api/uploads/${storageKey}`,
    mimeType,
    bytes: buffer.byteLength,
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
}

const SAFE_NAME = /^[0-9a-f-]{36}\.(jpg|png|gif|webp|heic|heif)$/;

/** Resolves a stored file, refusing anything that is not a key we minted. */
export async function readUpload(name: string) {
  if (!SAFE_NAME.test(name)) return null;
  const path = join(UPLOAD_DIR, name);
  // Belt and braces: the regex already forbids separators, but verify the
  // resolved path never escapes the upload directory.
  if (!resolve(path).startsWith(UPLOAD_DIR)) return null;
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    const type = Object.entries(ALLOWED).find(([, e]) => e === extname(name))?.[0] ?? "application/octet-stream";
    return { stream: createReadStream(path), size: info.size, type };
  } catch {
    return null;
  }
}

/**
 * Removes one stored file. True means the file is gone — which includes it
 * having been gone already, since a row whose file no longer exists would
 * otherwise be retried by the collector on every run, forever.
 *
 * False is reserved for a real failure (permissions, a busy volume) so the
 * caller can keep the row and try again later.
 */
export async function deleteUploadFile(name: string): Promise<boolean> {
  if (!SAFE_NAME.test(name)) return false;
  const path = join(UPLOAD_DIR, name);
  if (!resolve(path).startsWith(UPLOAD_DIR)) return false;
  try {
    await unlink(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    console.error(`upload: failed to unlink ${name}`, err);
    return false;
  }
}

/**
 * Garbage collector for abandoned booking-funnel uploads.
 *
 * Only ever considers rows with a `sessionId` — files the public wizard
 * took while a visitor was filling the form. Enumerating every column that
 * might point at a file is the wrong shape for this job: staff avatars,
 * artist avatars and the wizard's own step-option images all live in
 * columns a future change can add without anyone remembering to register
 * it here, and a miss means the file is deleted out from under a live
 * page. An admin upload carries no session, so it is never a candidate and
 * cannot be lost that way.
 *
 * Within the funnel, a row is deleted only when all of these hold:
 *   1. no appointment linked
 *   2. no lead linked
 *   3. the URL/key appears in none of the columns checked below
 *   4. older than the retention threshold
 */
export async function cleanupOrphanUploads(olderThanDays = 7): Promise<{ deletedCount: number; deletedBytes: number }> {
  const threshold = new Date(Date.now() - olderThanDays * 86_400_000);

  const candidates = await db
    .select({
      id: uploads.id,
      storageKey: uploads.storageKey,
      url: uploads.url,
      bytes: uploads.bytes,
      sessionId: uploads.sessionId,
    })
    .from(uploads)
    .where(
      and(
        // Funnel drafts only — see the note above.
        isNotNull(uploads.sessionId),
        isNull(uploads.appointmentId),
        isNull(uploads.leadId),
        lt(uploads.createdAt, threshold),
      ),
    );

  if (candidates.length === 0) return { deletedCount: 0, deletedBytes: 0 };

  // Collect all active image references across the entire system
  const [usedLocations, usedAppointments, usedLeads] = await Promise.all([
    db.select({ imageUrl: locations.imageUrl }).from(locations).where(isNotNull(locations.imageUrl)),
    db.select({ refImage: appointments.referenceImageUrl }).from(appointments).where(isNotNull(appointments.referenceImageUrl)),
    db.select({ id: leads.id, meta: leads.meta }).from(leads),
  ]);

  const protectedUrls = new Set<string>();
  const protectedKeys = new Set<string>();

  for (const loc of usedLocations) {
    if (loc.imageUrl) {
      protectedUrls.add(loc.imageUrl);
      const match = loc.imageUrl.match(/([0-9a-f-]{36}\.[a-z0-9]+)/i);
      if (match) protectedKeys.add(match[1]);
    }
  }

  for (const appt of usedAppointments) {
    if (appt.refImage) {
      protectedUrls.add(appt.refImage);
      const match = appt.refImage.match(/([0-9a-f-]{36}\.[a-z0-9]+)/i);
      if (match) protectedKeys.add(match[1]);
    }
  }

  for (const lead of usedLeads) {
    const meta = lead.meta as { referenceImages?: string[] } | null;
    if (meta && Array.isArray(meta.referenceImages)) {
      for (const img of meta.referenceImages) {
        if (typeof img === "string") {
          protectedUrls.add(img);
          const match = img.match(/([0-9a-f-]{36}\.[a-z0-9]+)/i);
          if (match) protectedKeys.add(match[1]);
        }
      }
    }
  }

  // Filter candidates that are genuinely orphan and NOT referenced anywhere
  const toDelete = candidates.filter(
    (c) => !protectedUrls.has(c.url) && !protectedKeys.has(c.storageKey),
  );

  if (toDelete.length === 0) return { deletedCount: 0, deletedBytes: 0 };

  let deletedCount = 0;
  let deletedBytes = 0;
  const deletedIds: number[] = [];

  for (const item of toDelete) {
    /* deleteUploadFile swallows its own errors and reports false, so the
       try/catch this replaced could never fire and every row was counted
       as deleted — including ones whose file is still on disk because the
       unlink was refused. Dropping the row then loses the only record of
       the file. Keep the row when the unlink fails; the next run retries. */
    const removed = await deleteUploadFile(item.storageKey);
    if (!removed) {
      console.warn(`retention: could not unlink ${item.storageKey}, keeping its row`);
      continue;
    }
    deletedCount += 1;
    deletedBytes += item.bytes;
    deletedIds.push(item.id);
  }

  if (deletedIds.length > 0) {
    await db.delete(uploads).where(inArray(uploads.id, deletedIds));
  }

  return { deletedCount, deletedBytes };
}
