/* The pool and the pacer, on their own.
 *
 * The property that matters is a pair: several feeds in flight at once
 * (so one dead feed does not hold up the other 126), and requests still
 * leaving at the same steady rate (so Timely does not ban us and blind
 * every studio at once).
 *
 *   npx tsx scripts/dev/test-timely-pool.ts
 */
import "../env";
import { createPacer, pool } from "../../src/server/jobs/timelySync";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  // ── 1. One slow feed must not hold up the rest ──────────────────────
  console.log("1. bir olu feed digerlerini bekletmiyor");
  const latencies = [400, 10, 10, 10, 10, 10, 10, 10]; // first one is the dead feed
  const finished: number[] = [];
  const serialTotal = latencies.reduce((a, b) => a + b, 0);

  const startedAt = Date.now();
  await pool(latencies, 4, async (ms) => {
    await sleep(ms);
    finished.push(ms);
  });
  const elapsed = Date.now() - startedAt;

  check("hepsi tamamlandi", finished.length === latencies.length, `${finished.length}/${latencies.length}`);
  check("seri sureden hizli", elapsed < serialTotal, `${elapsed}ms < ${serialTotal}ms`);
  check("yavas olan digerlerini bloklamadi", finished[0] !== 400, `ilk biten: ${finished[0]}ms`);

  // ── 2. The request rate is unchanged ────────────────────────────────
  console.log("\n2. istek hizi degismiyor (kuresel aralik)");
  const GAP = 50;
  const gate = createPacer(GAP);
  const stamps: number[] = [];
  await pool(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
    await gate();
    stamps.push(Date.now());
    await sleep(5);
  });

  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
  const tooClose = gaps.filter((g) => g < GAP - 8);
  check("hicbir istek cifti aralik altinda degil", tooClose.length === 0,
    `${tooClose.length} ihlal, en kisa ${Math.min(...gaps)}ms`);
  check("toplam sure aralikla tutarli", stamps[stamps.length - 1] - stamps[0] >= GAP * 10,
    `${stamps[stamps.length - 1] - stamps[0]}ms`);

  // ── 3. Every item is handled exactly once ───────────────────────────
  console.log("\n3. her feed tam bir kez okunuyor");
  const seen = new Map<number, number>();
  await pool(Array.from({ length: 127 }, (_, i) => i), 4, async (i) => {
    seen.set(i, (seen.get(i) ?? 0) + 1);
  });
  check("127 feed", seen.size === 127, String(seen.size));
  check("tekrar yok", [...seen.values()].every((n) => n === 1));

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
