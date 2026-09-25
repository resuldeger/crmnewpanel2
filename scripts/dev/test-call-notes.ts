/* Notes on a recording: a series, not a field.
 *
 * What someone concluded from listening had nowhere to go. The second
 * listener disagreeing with the first is the part worth keeping, so
 * nothing here overwrites anything, and a note carries who wrote it and
 * where in the recording they were.
 *
 *   npx tsx scripts/dev/test-call-notes.ts
 */
import "../env";
import { createHash, randomBytes } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { db } from "../../src/db/client";
import { callNotes, calls, sessions, staff } from "../../src/db/schema";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  const [who] = await db.select({ id: staff.id, name: staff.name }).from(staff).where(eq(staff.roleId, "super_admin")).limit(1);
  const [call] = await db.select({ id: calls.id }).from(calls).where(eq(calls.provider, "vonage")).limit(1);
  if (!who || !call) throw new Error("need a super_admin and a call");

  const token = randomBytes(32).toString("hex");
  const sessionId = createHash("sha256").update(token).digest("hex");
  await db.insert(sessions).values({
    id: sessionId, staffId: who.id, expiresAt: new Date(Date.now() + 15 * 60_000), userAgent: "notes-test",
  });
  const cookie = `cleo_session=${token}`;
  const url = `${BASE}/api/crm/calls/${call.id}/notes`;

  const post = (body: unknown) =>
    fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

  try {
    console.log("\n1. bir not ekleniyor");
    const a = await post({ body: "Ilk dinleyen: musteri Persembe istiyor.", atSeconds: 12 });
    const aBody = (await a.json()) as { note?: { id: number; author: string; atSeconds: number | null } };
    check("201", a.status === 201, String(a.status));
    check("yazari kaydedildi", aBody.note?.author === who.name, String(aBody.note?.author));
    check("saniye isareti durdu", aBody.note?.atSeconds === 12, String(aBody.note?.atSeconds));

    console.log("\n2. ikinci not birincinin uzerine YAZMIYOR");
    const b = await post({ body: "Ikinci dinleyen: aslinda Cuma dedi." });
    check("201", b.status === 201, String(b.status));
    const list = (await (await fetch(url, { headers: { cookie } })).json()) as { notes: { body: string; atSeconds: number | null }[] };
    check("iki not da duruyor", list.notes.length === 2, String(list.notes.length));
    check("sirali (eskiden yeniye)", list.notes[0].body.startsWith("Ilk"), list.notes[0].body.slice(0, 20));
    check("ikincisinde saniye yok", list.notes[1].atSeconds === null, String(list.notes[1].atSeconds));

    console.log("\n3. bos not reddediliyor");
    const empty = await post({ body: "   " });
    check("422", empty.status === 422, String(empty.status));

    console.log("\n4. cok uzun not reddediliyor");
    const huge = await post({ body: "x".repeat(4001) });
    check("422", huge.status === 422, String(huge.status));

    console.log("\n5. oturumsuz erisim yok");
    const anon = await fetch(url);
    check("401/403", anon.status === 401 || anon.status === 403, String(anon.status));
    const anonPost = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "sizinti" }) });
    check("yazma da reddediliyor", anonPost.status === 401 || anonPost.status === 403, String(anonPost.status));

    console.log("\n6. silme");
    const id = aBody.note!.id;
    const del = await fetch(`${url}?note=${id}`, { method: "DELETE", headers: { cookie } });
    check("200", del.status === 200, String(del.status));
    const after = (await (await fetch(url, { headers: { cookie } })).json()) as { notes: unknown[] };
    check("bir not kaldi", after.notes.length === 1, String(after.notes.length));

    console.log("\n7. olmayan cagriya not");
    const ghost = await fetch(`${BASE}/api/crm/calls/99999999/notes`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ body: "x" }),
    });
    check("404", ghost.status === 404, String(ghost.status));
  } finally {
    await db.delete(callNotes).where(eq(callNotes.callId, call.id));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    void like;
  }

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
