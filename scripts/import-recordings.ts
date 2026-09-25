/* ── Bringing recordings in from files ─────────────────────────────────
 * The audio also exists outside Vonage: exported from the previous system,
 * or copied off the live server. This walks a directory, works out which
 * call each file belongs to, copies it under the recordings directory and
 * points the call row at it.
 *
 * A local copy is the one that lasts. The carrier ages recordings out, the
 * API needs a permission this account does not have yet, and neither is
 * true of a file on disk.
 *
 * Matching, in order of confidence — the same rule the API job uses,
 * because the same mistake is possible either way and a recording on the
 * wrong customer's timeline is worse than no recording:
 *   1. the call's external id appears in the filename;
 *   2. the call's database id appears as `call-<id>`;
 *   3. an extension and a timestamp in the filename, matched within a
 *      tolerance — and skipped if two calls both fit.
 *
 *   npx tsx scripts/import-recordings.ts <directory> [--apply]
 *
 * Without --apply it only reports what it would do.
 */
import "./env";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "../src/db/client";
import { calls } from "../src/db/schema";

const AUDIO = /\.(mp3|wav|m4a|ogg)$/i;
const ROOT = path.resolve(process.env.RECORDINGS_DIR ?? "storage/recordings");
const TOLERANCE_MS = Number(process.env.VONAGE_RECORDING_MATCH_MS ?? 90_000);

/** Every audio file under `dir`, recursively. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (AUDIO.test(entry.name)) out.push(full);
  }
  return out;
}

/** A timestamp written into a filename, in the shapes exporters use. */
function timestampIn(name: string): Date | null {
  const iso = name.match(/(\d{4})-?(\d{2})-?(\d{2})[T_ -]?(\d{2})[:-]?(\d{2})[:-]?(\d{2})/);
  if (iso) {
    const [, y, mo, d, h, mi, sec] = iso;
    const at = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}Z`);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  const epoch = name.match(/\b(\d{10,13})\b/);
  if (epoch) {
    const n = Number(epoch[1]);
    const at = new Date(epoch[1].length >= 13 ? n : n * 1000);
    return Number.isNaN(at.getTime()) ? null : at;
  }
  return null;
}

type Outcome = "external-id" | "call-id" | "extension+time" | "ambiguous" | "unmatched";

async function resolveCall(file: string): Promise<{ id: number; how: Outcome } | { how: Outcome }> {
  const name = path.basename(file);

  // 1. The carrier's own id, written into the name.
  const uuid = name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) {
    const [row] = await db
      .select({ id: calls.id }).from(calls)
      .where(eq(calls.externalCallId, uuid[0])).limit(1);
    if (row) return { id: row.id, how: "external-id" };
  }

  // 2. Our own id.
  const ours = name.match(/\bcall-(\d+)\b/i);
  if (ours) {
    const [row] = await db
      .select({ id: calls.id }).from(calls)
      .where(eq(calls.id, Number(ours[1]))).limit(1);
    if (row) return { id: row.id, how: "call-id" };
  }

  // 3. Extension plus a timestamp.
  const ext = name.match(/\b(\d{3,5})\b/);
  const at = timestampIn(name);
  if (ext && at) {
    const candidates = await db
      .select({ id: calls.id }).from(calls)
      .where(
        and(
          eq(calls.extension, ext[1]),
          gte(calls.startTime, new Date(at.getTime() - TOLERANCE_MS)),
          lte(calls.startTime, new Date(at.getTime() + TOLERANCE_MS)),
          isNull(calls.recordingPath),
        ),
      )
      .limit(2);
    if (candidates.length === 1) return { id: candidates[0].id, how: "extension+time" };
    if (candidates.length > 1) return { how: "ambiguous" };
  }

  return { how: "unmatched" };
}

async function main() {
  const dir = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!dir) {
    console.error("kullanim: npx tsx scripts/import-recordings.ts <klasor> [--apply]");
    process.exit(1);
  }
  const source = path.resolve(dir);
  if (!(await stat(source).catch(() => null))?.isDirectory()) {
    console.error(`${source} bir klasor degil`);
    process.exit(1);
  }

  const files = await walk(source);
  console.log(`\n${files.length} ses dosyasi bulundu${apply ? "" : "  (KURU CALISMA — --apply ile yaz)"}\n`);

  const tally: Record<Outcome, number> = {
    "external-id": 0, "call-id": 0, "extension+time": 0, ambiguous: 0, unmatched: 0,
  };

  for (const file of files) {
    const match = await resolveCall(file);
    tally[match.how] += 1;
    if (!("id" in match)) continue;

    if (!apply) continue;
    const stored = `${match.id}${path.extname(file)}`;
    await mkdir(ROOT, { recursive: true });
    await copyFile(file, path.join(ROOT, stored));
    await db
      .update(calls)
      .set({ recordingPath: stored, hasRecording: true })
      .where(eq(calls.id, match.id));
  }

  console.log("── eslesme ──");
  for (const [how, n] of Object.entries(tally)) console.log(`  ${how.padEnd(16)} ${n}`);
  if (!apply) console.log("\nhicbir sey yazilmadi. yazmak icin --apply ekleyin.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
