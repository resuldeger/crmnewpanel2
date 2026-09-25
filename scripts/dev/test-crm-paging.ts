/* Server-side paging, filtering, sorting, tab counts and CSV export.
 *
 * The console used to fetch page_size=100 and then search, tab, filter and
 * export over those rows in memory. With 9,000+ calls on file that is 1%
 * of them, with nothing on screen to say so. These are the guarantees the
 * list views now depend on.
 *
 *   npx tsx scripts/dev/test-crm-paging.ts
 */
import "../env";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { sessions, staff } from "../../src/db/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  /* A real session row, so the request goes through withAuth exactly as the
     console's would. Removed again at the end. */
  const [who] = await db
    .select({ id: staff.id, name: staff.name, roleId: staff.roleId })
    .from(staff)
    .where(eq(staff.roleId, "super_admin"))
    .limit(1);
  if (!who) throw new Error("no super_admin on file to authenticate as");

  const token = randomBytes(32).toString("hex");
  const id = createHash("sha256").update(token).digest("hex");
  await db.insert(sessions).values({
    id,
    staffId: who.id,
    expiresAt: new Date(Date.now() + 15 * 60_000),
    userAgent: "crm-paging-test",
  });
  const cookie = `cleo_session=${token}`;
  console.log(`\nauth: ${who.name} (${who.roleId})\n`);

  const get = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
    return { status: res.status, body: (await res.json()) as Record<string, never> };
  };

  try {
    // ── 1. total describes the table, not the page ──────────────────────
    console.log("1. toplam sayi sayfayi degil tabloyu anlatiyor");
    const first = await get("/api/crm/calls?page_size=25&days=36500");
    const total = Number(first.body.total);
    check("200", first.status === 200, String(first.status));
    check("sayfa 25 satir", (first.body.calls as unknown[]).length === 25);
    check("total >> sayfa", total > 100, `total=${total}`);

    // ── 2. paging actually walks the table ──────────────────────────────
    console.log("\n2. sayfalama gercekten ilerliyor");
    const p2 = await get("/api/crm/calls?page_size=25&page=2&days=36500");
    const idsA = new Set((first.body.calls as { id: number }[]).map((c) => c.id));
    const idsB = (p2.body.calls as { id: number }[]).map((c) => c.id);
    check("2. sayfa dolu", idsB.length === 25);
    check("satirlar ortusmuyor", idsB.every((x) => !idsA.has(x)));

    const lastPage = Math.ceil(total / 25);
    const deep = await get(`/api/crm/calls?page_size=25&page=${lastPage}&days=36500`);
    check("son sayfaya erisiliyor", (deep.body.calls as unknown[]).length > 0, `sayfa ${lastPage}`);

    // ── 3. tab counts cover the whole filtered set ──────────────────────
    console.log("\n3. sekme sayaclari tum kumeyi kapsiyor");
    const counts = first.body.counts as unknown as Record<string, number>;
    check("counts geldi", !!counts && typeof counts.all === "number");
    check("counts.all == total", counts.all === total, `${counts.all} vs ${total}`);
    const summed = Object.entries(counts).filter(([k]) => k !== "all").reduce((a, [, v]) => a + v, 0);
    check("parcalar toplami == all", summed === counts.all, `${summed} vs ${counts.all}`);

    // ── 4. a status filter narrows on the server ────────────────────────
    console.log("\n4. durum filtresi sunucuda daraltiyor");
    const oneResult = Object.entries(counts).find(([k, v]) => k !== "all" && v > 0)?.[0];
    if (oneResult) {
      const filtered = await get(`/api/crm/calls?page_size=25&days=36500&result=${encodeURIComponent(oneResult)}`);
      check(`result=${oneResult} total dogru`, Number(filtered.body.total) === counts[oneResult],
        `${filtered.body.total} vs ${counts[oneResult]}`);
      check("donen satirlar o durumda",
        (filtered.body.calls as { result: string }[]).every((c) => c.result === oneResult));
      const fc = filtered.body.counts as unknown as Record<string, number>;
      check("sayaclar daralmadi (diger sekmeler gorunur)", fc.all === total, `${fc.all} vs ${total}`);
    }

    // ── 5. sorting is server-side and whitelisted ───────────────────────
    console.log("\n5. siralama sunucuda, whitelist'li");
    const asc = await get("/api/crm/calls?page_size=5&days=36500&sort=start&dir=asc");
    const desc = await get("/api/crm/calls?page_size=5&days=36500&sort=start&dir=desc");
    const t0 = (asc.body.calls as { startTime: string }[])[0]?.startTime;
    const t1 = (desc.body.calls as { startTime: string }[])[0]?.startTime;
    check("asc ve desc farkli ilk satir", t0 !== t1, `${t0} vs ${t1}`);
    check("asc gercekten artan",
      (asc.body.calls as { startTime: string }[]).every((c, i, a) => i === 0 || +new Date(a[i - 1].startTime) <= +new Date(c.startTime)));
    const bogus = await get("/api/crm/calls?page_size=5&days=36500&sort=drop_table&dir=asc");
    check("bilinmeyen sort 500 degil varsayilana duser", bogus.status === 200, String(bogus.status));

    // ── 6. search runs on the server ────────────────────────────────────
    console.log("\n6. arama sunucuda");
    const sample = (first.body.calls as { fromNumber: string }[])[0]?.fromNumber ?? "";
    const needle = sample.replace(/\D/g, "").slice(-7);
    if (needle.length >= 7) {
      const found = await get(`/api/crm/calls?page_size=25&days=36500&q=${needle}`);
      check("eslesme var", Number(found.body.total) > 0, `q=${needle} total=${found.body.total}`);
      check("sonuc kumesi daraldi", Number(found.body.total) < total);
    }

    // ── 7. CSV exports every matching row, not the page ─────────────────
    console.log("\n7. CSV tum kumeyi veriyor");
    const csv = await fetch(`${BASE}/api/crm/calls?days=36500&format=csv`, { headers: { cookie } });
    const text = await csv.text();
    const lines = text.trimEnd().split("\r\n");
    check("content-type csv", (csv.headers.get("content-type") ?? "").includes("text/csv"));
    check("attachment olarak iniyor", (csv.headers.get("content-disposition") ?? "").includes("attachment"));
    check("satir sayisi = total + baslik", lines.length === total + 1, `${lines.length} vs ${total + 1}`);
    check("sayfa boyutuyla sinirli degil", lines.length > 101, `${lines.length} satir`);

    // ── 8. scope is still enforced ──────────────────────────────────────
    console.log("\n8. yetki hala gecerli");
    const noCookie = await fetch(`${BASE}/api/crm/calls?days=36500`);
    check("oturumsuz reddediliyor", noCookie.status === 401 || noCookie.status === 403, String(noCookie.status));
    const csvNoCookie = await fetch(`${BASE}/api/crm/calls?days=36500&format=csv`);
    check("CSV de oturumsuz reddediliyor", csvNoCookie.status === 401 || csvNoCookie.status === 403, String(csvNoCookie.status));
  } finally {
    await db.delete(sessions).where(eq(sessions.id, id));
  }

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
