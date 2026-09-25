/* ── Which slots are free, and why ─────────────────────────────────────
 * Prints a studio's day exactly as the booking form computes it, with the
 * reason for every closed slot. The point is to be able to check a shop's
 * real diary against what a customer is offered.
 *
 *   npx tsx scripts/slot-report.ts <slug> [YYYY-MM-DD] [viewer-timezone]
 * ────────────────────────────────────────────────────────────────── */
import "./env";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../src/db/client";
import { artists, availabilityBlocks, locations } from "../src/db/schema";
import { computeAvailability, loadStudio } from "../src/server/booking/availability";

const pad = (s: string, n: number) => s.padEnd(n);

/** Same instant, rendered as wall-clock in a named zone. */
const inZone = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);

const dayInZone = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(d);

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("kullanim: npx tsx scripts/slot-report.ts <slug> [YYYY-MM-DD] [izleyici-tz]");
    process.exit(1);
  }

  const studio = await loadStudio(slug);
  if (!studio) {
    console.error(`şube bulunamadı: ${slug}`);
    process.exit(1);
  }

  const [row] = await db
    .select({ name: locations.name, capacity: locations.slotCapacity })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);

  const day =
    process.argv[3] ??
    new Intl.DateTimeFormat("en-CA", { timeZone: studio.timezone }).format(new Date());
  const viewerTz = process.argv[4] ?? studio.timezone;
  const month = day.slice(0, 7);

  const availability = await computeAvailability(studio, month);
  const today = availability[day];

  console.log(`\n${row?.name ?? slug}  ·  ${day}`);
  console.log(`  stüdyo saati : ${studio.timezone}`);
  console.log(`  izleyici     : ${viewerTz}`);
  console.log(`  kapasite     : ${row?.capacity ?? 2} randevu/slot   aralık: ${studio.bookingIntervalMin} dk`);
  console.log(`  aynı gün     : en az ${studio.sameDayLeadHours} saat önceden\n`);

  if (!today) {
    console.log("  bu tarih ufkun dışında veya ay eşleşmiyor.");
    process.exit(0);
  }
  if (today.slots.length === 0) {
    console.log("  şube bu gün kapalı.");
    process.exit(0);
  }

  /* Why each slot is closed has to come from the same rows the computation
     used, or the explanation would be a guess. */
  const dayStart = new Date(`${day}T00:00:00Z`);
  const blocks = await db
    .select({
      startsAt: availabilityBlocks.startsAt,
      endsAt: availabilityBlocks.endsAt,
      source: availabilityBlocks.source,
      artistId: availabilityBlocks.artistId,
      note: availabilityBlocks.note,
      artistName: artists.name,
    })
    .from(availabilityBlocks)
    .leftJoin(artists, eq(artists.id, availabilityBlocks.artistId))
    .where(
      and(
        eq(availabilityBlocks.locationId, studio.id),
        gte(availabilityBlocks.endsAt, new Date(dayStart.getTime() - 86_400_000)),
        lte(availabilityBlocks.startsAt, new Date(dayStart.getTime() + 2 * 86_400_000)),
      ),
    );

  const now = Date.now();
  const leadUntil = now + studio.sameDayLeadHours * 3_600_000;
  const isToday = day === new Intl.DateTimeFormat("en-CA", { timeZone: studio.timezone }).format(new Date());

  console.log(`  ${pad("stüdyo", 8)}${pad("izleyici", 10)}${pad("durum", 9)}neden`);
  console.log(`  ${"─".repeat(64)}`);

  for (const slot of today.slots) {
    const start = new Date(slot.startsAt);
    const end = new Date(start.getTime() + studio.bookingIntervalMin * 60_000);

    const hits = blocks.filter((b) => start < b.endsAt && end > b.startsAt);
    const ours = hits.filter((b) => b.source === "appointment").length;
    const timely = new Set(hits.filter((b) => b.source === "timely").map((b) => b.artistId)).size;
    const other = hits.filter((b) => b.source !== "appointment" && b.source !== "timely").length;

    let why = "";
    if (slot.booked) {
      if (isToday && start.getTime() < leadUntil) {
        why = `${studio.sameDayLeadHours} saat kuralı`;
      } else {
        const parts: string[] = [];
        if (ours) parts.push(`${ours} bizden`);
        if (timely) parts.push(`${timely} Timely`);
        if (other) parts.push(`${other} diğer`);
        why = parts.length > 0 ? `dolu — ${parts.join(" + ")}` : "kapalı";
      }
    } else if (hits.length > 0) {
      const parts: string[] = [];
      if (ours) parts.push(`${ours} bizden`);
      if (timely) parts.push(`${timely} Timely`);
      why = `${parts.join(" + ")} var, yer kaldı`;
    }

    const viewer = inZone(start, viewerTz);
    const crosses = dayInZone(start, viewerTz) !== dayInZone(start, studio.timezone) ? "*" : " ";

    console.log(
      `  ${pad(slot.time, 8)}${pad(viewer + crosses, 10)}${pad(slot.booked ? "DOLU" : "boş", 9)}${why}`,
    );
  }

  const open = today.slots.filter((s) => !s.booked).length;
  console.log(`\n  ${open}/${today.slots.length} slot açık`);
  if (viewerTz !== studio.timezone) console.log("  * izleyicinin takviminde başka bir güne düşüyor");

  const names = [...new Set(blocks.filter((b) => b.source === "timely" && b.artistName).map((b) => b.artistName))];
  if (names.length > 0) console.log(`\n  Timely takvimi olan sanatçılar: ${names.join(", ")}`);

  process.exit(0);
}

void main();
